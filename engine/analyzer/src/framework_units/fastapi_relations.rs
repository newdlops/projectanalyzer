//! FastAPI semantic relation extraction helpers.
//!
//! This module only consumes existing `FrameworkUnit` records and small source
//! snippets. The parent adapter can attach these inferred edges without changing
//! the core framework unit model.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;

use crate::model::{FrameworkUnit, FrameworkUnitEdge};

const MAX_RELATION_FILE_SIZE_BYTES: u64 = 1024 * 1024;

/// Infers FastAPI relation edges from route/controller source evidence.
///
/// Ambiguous references are skipped unless they resolve to a single target in
/// the same local scope, preserving a conservative graph for large projects.
pub(super) fn relation_edges(units: &[FrameworkUnit]) -> Vec<FrameworkUnitEdge> {
    let catalog = UnitCatalog::from_units(units);
    let contents_by_file = read_relation_source_files(units);
    let mut edges = EdgeAccumulator::default();

    add_route_response_model_edges(units, &catalog, &contents_by_file, &mut edges);
    add_controller_dependency_edges(units, &catalog, &contents_by_file, &mut edges);

    edges.into_edges()
}

/// Name indexes for resolving source references to already-created units.
struct UnitCatalog<'a> {
    schemas_by_name: BTreeMap<String, Vec<&'a FrameworkUnit>>,
    dependencies_by_name: BTreeMap<String, Vec<&'a FrameworkUnit>>,
}

impl<'a> UnitCatalog<'a> {
    /// Builds lookup tables while retaining duplicate candidates for later
    /// same-file and same-parent disambiguation.
    fn from_units(units: &'a [FrameworkUnit]) -> Self {
        let mut catalog = Self {
            schemas_by_name: BTreeMap::new(),
            dependencies_by_name: BTreeMap::new(),
        };

        for unit in units {
            match unit.kind.as_str() {
                "schema" => catalog
                    .schemas_by_name
                    .entry(unit.name.clone())
                    .or_default()
                    .push(unit),
                "dependency" => catalog
                    .dependencies_by_name
                    .entry(unit.name.clone())
                    .or_default()
                    .push(unit),
                _ => {}
            }
        }

        catalog
    }

    /// Resolves a Pydantic schema reference by exact unit name.
    fn resolve_schema(&self, source: &FrameworkUnit, name: &str) -> Option<&'a FrameworkUnit> {
        resolve_unit_by_name(&self.schemas_by_name, source, name)
    }

    /// Resolves a dependency callable reference by exact unit name.
    fn resolve_dependency(&self, source: &FrameworkUnit, name: &str) -> Option<&'a FrameworkUnit> {
        resolve_unit_by_name(&self.dependencies_by_name, source, name)
    }
}

/// Edge builder with deterministic source-target-kind de-duplication.
#[derive(Default)]
struct EdgeAccumulator {
    /// Stable identity key for inferred relation edges.
    seen: BTreeSet<(String, String, String)>,
    edges: Vec<FrameworkUnitEdge>,
}

impl EdgeAccumulator {
    /// Adds one inferred edge using the source unit location as evidence.
    fn push(&mut self, source: &FrameworkUnit, target: &FrameworkUnit, kind: &str) {
        if source.id == target.id {
            return;
        }

        let key = (source.id.clone(), target.id.clone(), kind.to_string());
        if !self.seen.insert(key) {
            return;
        }

        self.edges.push(FrameworkUnitEdge {
            id: format!("framework-unit-edge::{kind}::{}::{}", source.id, target.id),
            kind: kind.to_string(),
            source_id: source.id.clone(),
            target_id: target.id.clone(),
            file_path: source.file_path.clone(),
            range: source.range.clone(),
            confidence: "inferred".to_string(),
        });
    }

    /// Returns collected edges in deterministic discovery order.
    fn into_edges(self) -> Vec<FrameworkUnitEdge> {
        self.edges
    }
}

/// Adds `route -> schema` edges from decorator `response_model=Schema` values.
fn add_route_response_model_edges(
    units: &[FrameworkUnit],
    catalog: &UnitCatalog<'_>,
    contents_by_file: &BTreeMap<String, String>,
    edges: &mut EdgeAccumulator,
) {
    for unit in units.iter().filter(|unit| unit.kind == "route") {
        let Some(content) = contents_by_file.get(&unit.file_path) else {
            continue;
        };

        let source_text = unit_source_text(content, unit);
        for schema_name in response_model_names(&source_text) {
            if let Some(schema) = catalog.resolve_schema(unit, &schema_name) {
                edges.push(unit, schema, "usesModel");
            }
        }
    }
}

/// Adds `controller -> dependency` edges from `Depends(callable)` signature use.
fn add_controller_dependency_edges(
    units: &[FrameworkUnit],
    catalog: &UnitCatalog<'_>,
    contents_by_file: &BTreeMap<String, String>,
    edges: &mut EdgeAccumulator,
) {
    for unit in units.iter().filter(|unit| unit.kind == "controller") {
        let Some(content) = contents_by_file.get(&unit.file_path) else {
            continue;
        };

        let source_text = unit_source_text(content, unit);
        for dependency_name in depends_target_names(&source_text) {
            if let Some(dependency) = catalog.resolve_dependency(unit, &dependency_name) {
                edges.push(unit, dependency, "injects");
            }
        }
    }
}

/// Reads unique source files needed by route/controller relation rules.
fn read_relation_source_files(units: &[FrameworkUnit]) -> BTreeMap<String, String> {
    let mut contents = BTreeMap::new();

    for unit in units
        .iter()
        .filter(|unit| matches!(unit.kind.as_str(), "route" | "controller"))
    {
        if contents.contains_key(&unit.file_path) {
            continue;
        }

        if let Some(content) = read_small_text_file(&unit.file_path) {
            contents.insert(unit.file_path.clone(), content);
        }
    }

    contents
}

/// Reads a UTF-8 source file, skipping unusually large files for latency safety.
fn read_small_text_file(file_path: &str) -> Option<String> {
    let metadata = fs::metadata(file_path).ok()?;
    if metadata.len() > MAX_RELATION_FILE_SIZE_BYTES {
        return None;
    }

    fs::read_to_string(file_path).ok()
}

/// Returns the exact source covered by a framework unit range.
fn unit_source_text(content: &str, unit: &FrameworkUnit) -> String {
    let lines = source_lines(content);
    if lines.is_empty() {
        return String::new();
    }

    let start = unit.range.start_line.min(lines.len() - 1);
    let end = unit
        .range
        .end_line
        .saturating_add(1)
        .min(lines.len())
        .max(start + 1);

    lines[start..end].join("\n")
}

/// Collects schema names from FastAPI route decorator `response_model` values.
fn response_model_names(source_text: &str) -> BTreeSet<String> {
    let mut names = BTreeSet::new();

    for line in source_text.lines() {
        let code = code_before_comment(line);
        let mut search_start = 0usize;

        while let Some(relative_index) = code[search_start..].find("response_model") {
            let start = search_start + relative_index;
            let end = start + "response_model".len();
            if is_identifier_boundary(code, start, end) {
                if let Some(value) = keyword_argument_value(&code[end..]) {
                    for name in reference_leaf_names(value) {
                        names.insert(name);
                    }
                }
            }

            search_start = end;
        }
    }

    names
}

/// Extracts dependency callable names from `Depends(name)` expressions.
fn depends_target_names(source_text: &str) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    let mut search_start = 0usize;

    while let Some(relative_index) = source_text[search_start..].find("Depends(") {
        let start = search_start + relative_index + "Depends(".len();
        let argument = source_text[start..].trim_start();
        let end = argument
            .find(|character: char| {
                !(character == '_' || character == '.' || character.is_ascii_alphanumeric())
            })
            .unwrap_or(argument.len());

        if end > 0 {
            if let Some(name) = argument[..end].rsplit('.').next() {
                if is_identifier(name) {
                    names.insert(name.to_string());
                }
            }
        }

        search_start = start;
    }

    names
}

/// Reads the value portion after a keyword argument marker such as `=Item`.
fn keyword_argument_value(remainder: &str) -> Option<&str> {
    let value = remainder.trim_start().strip_prefix('=')?.trim_start();
    if value.is_empty() {
        return None;
    }

    let end = top_level_value_end(value);
    Some(value[..end].trim())
}

/// Finds the end of one Python call argument without crossing to sibling args.
fn top_level_value_end(value: &str) -> usize {
    let bytes = value.as_bytes();
    let mut index = 0usize;
    let mut depth = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'\'' | b'"' => index = skip_python_string(bytes, index),
            b'[' | b'{' | b'(' => {
                depth += 1;
                index += 1;
            }
            b']' | b'}' => {
                depth = depth.saturating_sub(1);
                index += 1;
            }
            b')' if depth == 0 => break,
            b')' => {
                depth = depth.saturating_sub(1);
                index += 1;
            }
            b',' if depth == 0 => break,
            _ => index += 1,
        }
    }

    index
}

/// Collects dotted-reference leaf names from a keyword argument value.
fn reference_leaf_names(value: &str) -> BTreeSet<String> {
    let bytes = value.as_bytes();
    let mut names = BTreeSet::new();
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'#' => break,
            b'\'' | b'"' => index = skip_python_string(bytes, index),
            byte if is_identifier_start(byte) => {
                let start = index;
                index += 1;
                while index < bytes.len()
                    && (is_identifier_continue(bytes[index]) || bytes[index] == b'.')
                {
                    index += 1;
                }

                if let Some(name) = value[start..index].rsplit('.').next() {
                    if is_identifier(name) {
                        names.insert(name.to_string());
                    }
                }
            }
            _ => index += 1,
        }
    }

    names
}

/// Resolves by same range/file first, then same qualified parent, then globally unique name.
fn resolve_unit_by_name<'a>(
    units_by_name: &BTreeMap<String, Vec<&'a FrameworkUnit>>,
    source: &FrameworkUnit,
    name: &str,
) -> Option<&'a FrameworkUnit> {
    let candidates = units_by_name.get(name)?;

    unique_candidate(
        candidates
            .iter()
            .copied()
            .filter(|candidate| has_same_file_and_range(source, candidate)),
    )
    .or_else(|| {
        unique_candidate(
            candidates
                .iter()
                .copied()
                .filter(|candidate| candidate.file_path == source.file_path),
        )
    })
    .or_else(|| {
        unique_candidate(
            candidates
                .iter()
                .copied()
                .filter(|candidate| has_same_qualified_parent(source, candidate)),
        )
    })
    .or_else(|| unique_candidate(candidates.iter().copied()))
}

/// Returns the only candidate from an iterator, or `None` if ambiguous.
fn unique_candidate<'a>(
    mut candidates: impl Iterator<Item = &'a FrameworkUnit>,
) -> Option<&'a FrameworkUnit> {
    let first = candidates.next()?;
    candidates.next().is_none().then_some(first)
}

fn has_same_file_and_range(left: &FrameworkUnit, right: &FrameworkUnit) -> bool {
    left.file_path == right.file_path
        && left.range.start_line == right.range.start_line
        && left.range.start_character == right.range.start_character
}

fn has_same_qualified_parent(left: &FrameworkUnit, right: &FrameworkUnit) -> bool {
    qualified_parent(&left.qualified_name)
        .zip(qualified_parent(&right.qualified_name))
        .map(|(left_parent, right_parent)| left_parent == right_parent)
        .unwrap_or(false)
}

fn qualified_parent(qualified_name: &str) -> Option<&str> {
    qualified_name.rsplit_once('.').map(|(parent, _)| parent)
}

fn source_lines(content: &str) -> Vec<&str> {
    content
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .collect()
}

fn code_before_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'#' => return &line[..index],
            b'\'' | b'"' => index = skip_python_string(bytes, index),
            _ => index += 1,
        }
    }

    line
}

fn skip_python_string(bytes: &[u8], start: usize) -> usize {
    let quote = bytes[start];
    let mut index = start + 1;

    while index < bytes.len() {
        if bytes[index] == b'\\' {
            index = (index + 2).min(bytes.len());
            continue;
        }
        if bytes[index] == quote {
            return index + 1;
        }
        index += 1;
    }

    bytes.len()
}

fn is_identifier_boundary(source: &str, start: usize, end: usize) -> bool {
    !is_identifier_character(source[..start].chars().next_back())
        && !is_identifier_character(source[end..].chars().next())
}

fn is_identifier(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || !is_identifier_start(bytes[0]) {
        return false;
    }

    bytes[1..].iter().all(|byte| is_identifier_continue(*byte))
}

fn is_identifier_start(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphabetic()
}

fn is_identifier_continue(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphanumeric()
}

fn is_identifier_character(character: Option<char>) -> bool {
    character
        .map(|value| value == '_' || value.is_ascii_alphanumeric())
        .unwrap_or(false)
}
