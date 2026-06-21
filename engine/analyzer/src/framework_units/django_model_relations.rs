//! Django model inheritance relation extraction.
//!
//! Django model units are discovered from `models.py` classes by the base
//! adapter. This helper re-reads those model declarations and connects child
//! models to project-local base model units without resolving external Django
//! or dependency classes.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;

use crate::model::{FrameworkUnit, FrameworkUnitEdge};

const MAX_RELATION_FILE_SIZE_BYTES: u64 = 1024 * 1024;
const MAX_CLASS_HEADER_LINES: usize = 40;

/// Infers `child model -> base model` inheritance edges for Django models.
pub(super) fn relation_edges(units: &[FrameworkUnit]) -> Vec<FrameworkUnitEdge> {
    let catalog = ModelCatalog::from_units(units);
    let contents_by_file = read_model_source_files(units);
    let mut edges = EdgeAccumulator::default();

    for model in units.iter().filter(|unit| unit.kind == "model") {
        let Some(content) = contents_by_file.get(&model.file_path) else {
            continue;
        };
        let Some(header) = class_header_text(content, model) else {
            continue;
        };

        for base_name in base_model_names(&header) {
            let Some(base_model) = catalog.resolve_model(model, &base_name) else {
                continue;
            };
            edges.push(model, base_model, "extends");
        }
    }

    edges.into_edges()
}

/// Model lookup preserving ambiguous names for scoped resolution.
struct ModelCatalog<'a> {
    models_by_name: BTreeMap<String, Vec<&'a FrameworkUnit>>,
}

impl<'a> ModelCatalog<'a> {
    /// Indexes existing model units by declaration name.
    fn from_units(units: &'a [FrameworkUnit]) -> Self {
        let mut catalog = Self {
            models_by_name: BTreeMap::new(),
        };

        for unit in units.iter().filter(|unit| unit.kind == "model") {
            catalog
                .models_by_name
                .entry(unit.name.clone())
                .or_default()
                .push(unit);
        }

        catalog
    }

    /// Resolves a base class name to a single model unit.
    fn resolve_model(&self, source: &FrameworkUnit, name: &str) -> Option<&'a FrameworkUnit> {
        resolve_unit_by_name(&self.models_by_name, source, name)
    }
}

/// Accumulates inferred edges while preserving deterministic IDs.
#[derive(Default)]
struct EdgeAccumulator {
    seen: BTreeSet<(String, String, String)>,
    edges: Vec<FrameworkUnitEdge>,
}

impl EdgeAccumulator {
    /// Adds one source-backed model relation edge.
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

    fn into_edges(self) -> Vec<FrameworkUnitEdge> {
        self.edges
    }
}

/// Reads each model source file once, skipping large files for latency.
fn read_model_source_files(units: &[FrameworkUnit]) -> BTreeMap<String, String> {
    let mut contents = BTreeMap::new();

    for unit in units.iter().filter(|unit| unit.kind == "model") {
        if contents.contains_key(&unit.file_path) {
            continue;
        }
        if let Some(content) = read_small_text_file(&unit.file_path) {
            contents.insert(unit.file_path.clone(), content);
        }
    }

    contents
}

fn read_small_text_file(file_path: &str) -> Option<String> {
    let metadata = fs::metadata(file_path).ok()?;
    if metadata.len() > MAX_RELATION_FILE_SIZE_BYTES {
        return None;
    }

    fs::read_to_string(file_path).ok()
}

/// Returns the complete class header for a model unit.
fn class_header_text(content: &str, unit: &FrameworkUnit) -> Option<String> {
    let lines = source_lines(content);
    if lines.is_empty() {
        return None;
    }

    let start = unit.range.start_line.min(lines.len() - 1);
    let first_line = lines[start];
    if class_declaration_name(first_line).as_deref() != Some(unit.name.as_str()) {
        return None;
    }

    let mut header = String::new();
    let mut balance = 0isize;
    let max_end = lines.len().min(start + MAX_CLASS_HEADER_LINES);

    for line in lines.iter().take(max_end).skip(start) {
        if !header.is_empty() {
            header.push('\n');
        }
        header.push_str(line);
        balance += paren_delta_outside_strings(line);

        if header_has_terminal_colon(line, balance) {
            return Some(header);
        }
    }

    Some(header)
}

/// Extracts project-local base model names from a Python class header.
fn base_model_names(header: &str) -> BTreeSet<String> {
    let Some(arguments) = class_base_arguments(header) else {
        return BTreeSet::new();
    };

    split_top_level_arguments(arguments)
        .into_iter()
        .filter_map(|argument| reference_leaf_name(argument.trim()))
        .filter(|name| name != "Model")
        .collect()
}

fn class_base_arguments(header: &str) -> Option<&str> {
    let class_index = find_identifier_token(header, "class")?;
    let name_start = skip_ascii_whitespace(header.as_bytes(), class_index + "class".len());
    let name_end = identifier_end(header.as_bytes(), name_start)?;
    let open_index = skip_ascii_whitespace(header.as_bytes(), name_end);

    if header.as_bytes().get(open_index) != Some(&b'(') {
        return None;
    }

    let close_index = matching_close_paren(header.as_bytes(), open_index)?;
    Some(&header[open_index + 1..close_index])
}

fn split_top_level_arguments(arguments: &str) -> Vec<&str> {
    let bytes = arguments.as_bytes();
    let mut parts = Vec::new();
    let mut depth = 0isize;
    let mut start = 0usize;
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'\'' | b'"' => index = skip_python_string(bytes, index),
            b'(' | b'[' | b'{' => {
                depth += 1;
                index += 1;
            }
            b')' | b']' | b'}' => {
                depth -= 1;
                index += 1;
            }
            b',' if depth == 0 => {
                let part = arguments[start..index].trim();
                if !part.is_empty() {
                    parts.push(part);
                }
                start = index + 1;
                index += 1;
            }
            _ => index += 1,
        }
    }

    let part = arguments[start..].trim();
    if !part.is_empty() {
        parts.push(part);
    }

    parts
}

fn reference_leaf_name(value: &str) -> Option<String> {
    let reference = read_reference(value)?;
    let leaf = reference.rsplit('.').next()?;
    is_identifier(leaf).then(|| leaf.to_string())
}

/// Resolves by same Django app first, then same file, then globally unique name.
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
            .filter(|candidate| candidate.parent_id == source.parent_id),
    )
    .or_else(|| {
        unique_candidate(
            candidates
                .iter()
                .copied()
                .filter(|candidate| candidate.file_path == source.file_path),
        )
    })
    .or_else(|| unique_candidate(candidates.iter().copied()))
}

fn unique_candidate<'a>(
    mut candidates: impl Iterator<Item = &'a FrameworkUnit>,
) -> Option<&'a FrameworkUnit> {
    let first = candidates.next()?;
    candidates.next().is_none().then_some(first)
}

fn source_lines(content: &str) -> Vec<&str> {
    content
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .collect()
}

fn class_declaration_name(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let remainder = trimmed.strip_prefix("class")?;
    if !remainder
        .chars()
        .next()
        .map(|character| character.is_whitespace())
        .unwrap_or(false)
    {
        return None;
    }

    read_identifier(remainder.trim_start()).map(str::to_string)
}

fn header_has_terminal_colon(line: &str, balance: isize) -> bool {
    balance <= 0 && code_before_comment(line).trim_end().ends_with(':')
}

fn paren_delta_outside_strings(line: &str) -> isize {
    let bytes = line.as_bytes();
    let mut delta = 0isize;
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'#' => break,
            b'\'' | b'"' => index = skip_python_string(bytes, index),
            b'(' => {
                delta += 1;
                index += 1;
            }
            b')' => {
                delta -= 1;
                index += 1;
            }
            _ => index += 1,
        }
    }

    delta
}

fn matching_close_paren(bytes: &[u8], open_index: usize) -> Option<usize> {
    let mut depth = 0isize;
    let mut index = open_index;

    while index < bytes.len() {
        match bytes[index] {
            b'#' => break,
            b'\'' | b'"' => index = skip_python_string(bytes, index),
            b'(' => {
                depth += 1;
                index += 1;
            }
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(index);
                }
                index += 1;
            }
            _ => index += 1,
        }
    }

    None
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

fn find_identifier_token(source: &str, expected: &str) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        if !is_identifier_start(bytes[index]) {
            index += 1;
            continue;
        }

        let start = index;
        index += 1;
        while index < bytes.len() && is_identifier_continue(bytes[index]) {
            index += 1;
        }
        if &source[start..index] == expected {
            return Some(start);
        }
    }

    None
}

fn read_reference(value: &str) -> Option<&str> {
    let bytes = value.as_bytes();
    if bytes.is_empty() || !is_identifier_start(bytes[0]) {
        return None;
    }

    let mut end = 1usize;
    while end < bytes.len() && (is_identifier_continue(bytes[end]) || bytes[end] == b'.') {
        end += 1;
    }

    Some(&value[..end])
}

fn read_identifier(value: &str) -> Option<&str> {
    let bytes = value.as_bytes();
    let end = identifier_end(bytes, 0)?;
    Some(&value[..end])
}

fn identifier_end(bytes: &[u8], start: usize) -> Option<usize> {
    if bytes.get(start).copied().map(is_identifier_start) != Some(true) {
        return None;
    }

    let mut end = start + 1;
    while end < bytes.len() && is_identifier_continue(bytes[end]) {
        end += 1;
    }

    Some(end)
}

fn skip_ascii_whitespace(bytes: &[u8], start: usize) -> usize {
    let mut index = start;
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    index
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
