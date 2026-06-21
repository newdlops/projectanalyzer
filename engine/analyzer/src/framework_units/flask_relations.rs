//! Flask semantic relation extraction helpers.
//!
//! This module adds source-evidenced edges between already discovered Flask
//! units without executing project code.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;

use crate::model::{FrameworkUnit, FrameworkUnitEdge, SourceRange};

const MAX_RELATION_FILE_SIZE_BYTES: u64 = 1024 * 1024;
const MAX_CALL_STATEMENT_LINES: usize = 24;

/// Infers conservative Flask relation edges from existing framework units.
pub(super) fn relation_edges(units: &[FrameworkUnit]) -> Vec<FrameworkUnitEdge> {
    let catalog = UnitCatalog::from_units(units);
    let contents_by_file = read_relation_source_files(units);
    let mut edges = EdgeAccumulator::default();

    add_blueprint_registration_edges(units, &catalog, &contents_by_file, &mut edges);
    add_middleware_call_edges(units, &catalog, &contents_by_file, &mut edges);

    edges.into_edges()
}

/// Name indexes for Flask units that can be targets of inferred edges.
struct UnitCatalog<'a> {
    blueprints_by_name: BTreeMap<String, Vec<&'a FrameworkUnit>>,
    middlewares_by_name: BTreeMap<String, Vec<&'a FrameworkUnit>>,
}

impl<'a> UnitCatalog<'a> {
    fn from_units(units: &'a [FrameworkUnit]) -> Self {
        let mut catalog = Self {
            blueprints_by_name: BTreeMap::new(),
            middlewares_by_name: BTreeMap::new(),
        };

        for unit in units {
            match unit.kind.as_str() {
                "module" if unit.parent_id.is_some() => {
                    push_unique_unit(&mut catalog.blueprints_by_name, &unit.name, unit)
                }
                "middleware" => {
                    for name in middleware_reference_names(unit) {
                        push_unique_unit(&mut catalog.middlewares_by_name, &name, unit);
                    }
                }
                _ => {}
            }
        }

        catalog
    }

    fn resolve_blueprint(&self, source: &FrameworkUnit, name: &str) -> Option<&'a FrameworkUnit> {
        resolve_unit_by_name(&self.blueprints_by_name, source, name)
    }

    fn resolve_middleware(&self, source: &FrameworkUnit, name: &str) -> Option<&'a FrameworkUnit> {
        resolve_unit_by_name(&self.middlewares_by_name, source, name)
    }
}

/// Edge builder with stable source-target-kind deduplication.
#[derive(Default)]
struct EdgeAccumulator {
    seen: BTreeSet<(String, String, String)>,
    edges: Vec<FrameworkUnitEdge>,
}

impl EdgeAccumulator {
    fn push(
        &mut self,
        source: &FrameworkUnit,
        target: &FrameworkUnit,
        kind: &str,
        range: SourceRange,
    ) {
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
            range,
            confidence: "inferred".to_string(),
        });
    }

    fn into_edges(self) -> Vec<FrameworkUnitEdge> {
        self.edges
    }
}

/// Adds `app -> blueprint module` edges from `app.register_blueprint(bp, ...)`.
fn add_blueprint_registration_edges(
    units: &[FrameworkUnit],
    catalog: &UnitCatalog<'_>,
    contents_by_file: &BTreeMap<String, String>,
    edges: &mut EdgeAccumulator,
) {
    for app in units.iter().filter(|unit| unit.kind == "app") {
        let Some(content) = contents_by_file.get(&app.file_path) else {
            continue;
        };

        for (blueprint_name, range) in blueprint_registrations(content, &app.name) {
            let Some(blueprint) = catalog.resolve_blueprint(app, &blueprint_name) else {
                continue;
            };
            edges.push(app, blueprint, "configures", range);
        }
    }
}

/// Adds route/controller `calls` edges when middleware references are explicit.
fn add_middleware_call_edges(
    units: &[FrameworkUnit],
    catalog: &UnitCatalog<'_>,
    contents_by_file: &BTreeMap<String, String>,
    edges: &mut EdgeAccumulator,
) {
    for source in units
        .iter()
        .filter(|unit| matches!(unit.kind.as_str(), "route" | "controller"))
    {
        let Some(content) = contents_by_file.get(&source.file_path) else {
            continue;
        };

        for name in middleware_references_in_source(&unit_source_text(content, source)) {
            let Some(middleware) = catalog.resolve_middleware(source, &name) else {
                continue;
            };
            edges.push(source, middleware, "calls", source.range.clone());
        }
    }
}

fn read_relation_source_files(units: &[FrameworkUnit]) -> BTreeMap<String, String> {
    let mut contents = BTreeMap::new();

    for unit in units.iter().filter(|unit| {
        matches!(
            unit.kind.as_str(),
            "app" | "module" | "middleware" | "route" | "controller"
        )
    }) {
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

fn blueprint_registrations(content: &str, app_name: &str) -> Vec<(String, SourceRange)> {
    let lines = content.lines().collect::<Vec<_>>();
    let mut registrations = Vec::new();

    for (line_index, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') || !trimmed.contains("register_blueprint") {
            continue;
        }

        let Some((statement, range)) = call_statement_from(&lines, line_index) else {
            continue;
        };
        if !has_qualified_call(&statement, app_name, "register_blueprint") {
            continue;
        }

        let Some(arguments) = call_arguments(&statement) else {
            continue;
        };
        let Some(blueprint_name) = first_identifier_argument(arguments) else {
            continue;
        };
        registrations.push((blueprint_name, range));
    }

    registrations
}

fn call_statement_from(lines: &[&str], start_line: usize) -> Option<(String, SourceRange)> {
    let mut text = String::new();
    let mut balance = 0isize;
    let mut saw_open = false;
    let max_end = lines.len().min(start_line + MAX_CALL_STATEMENT_LINES);

    for (line_index, line) in lines.iter().enumerate().take(max_end).skip(start_line) {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(line);
        balance += delimiter_delta(line);
        saw_open |= line.contains('(');

        if saw_open && balance <= 0 {
            return Some((
                text,
                SourceRange {
                    start_line,
                    start_character: indentation_width(lines[start_line]),
                    end_line: line_index,
                    end_character: line.chars().count(),
                },
            ));
        }
    }

    None
}

fn has_qualified_call(statement: &str, owner: &str, method: &str) -> bool {
    let target = format!("{owner}.{method}");
    let mut search_start = 0usize;

    while let Some(relative_index) = statement[search_start..].find(&target) {
        let start = search_start + relative_index;
        let end = start + target.len();
        let before = statement[..start].chars().next_back();
        let call_follows = statement[end..]
            .chars()
            .find(|character| !character.is_whitespace())
            == Some('(');

        if !is_identifier_character(before) && before != Some('.') && call_follows {
            return true;
        }
        search_start = end;
    }

    false
}

fn call_arguments(statement: &str) -> Option<&str> {
    let open = statement.find('(')?;
    let close = statement.rfind(')')?;
    (close > open).then_some(&statement[open + 1..close])
}

fn first_identifier_argument(arguments: &str) -> Option<String> {
    let mut last_identifier = None;

    for part in arguments.split(',').next()?.trim().split('.') {
        let name = part.trim();
        if !is_python_identifier(name) {
            return None;
        }
        last_identifier = Some(name.to_string());
    }

    last_identifier
}

fn middleware_reference_names(unit: &FrameworkUnit) -> Vec<String> {
    let mut names = vec![unit.name.clone()];

    if let Some(name) = unit.name.split_whitespace().last() {
        if name != unit.name && is_python_identifier(name) {
            names.push(name.to_string());
        }
    }

    names
}

fn middleware_references_in_source(source_text: &str) -> BTreeSet<String> {
    let mut names = BTreeSet::new();

    for line in source_text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('@') {
            if let Some(name) = decorator_reference_name(trimmed) {
                names.insert(name);
            }
            continue;
        }
        if is_python_declaration(trimmed) {
            continue;
        }
        for name in call_names_in_line(line) {
            names.insert(name);
        }
    }

    names
}

fn is_python_declaration(trimmed_line: &str) -> bool {
    trimmed_line.starts_with("def ")
        || trimmed_line.starts_with("async def ")
        || trimmed_line.starts_with("class ")
}

fn decorator_reference_name(trimmed_line: &str) -> Option<String> {
    let decorator = trimmed_line.strip_prefix('@')?.trim_start();
    let call_target_end = decorator
        .find(|character: char| character == '(' || character.is_whitespace())
        .unwrap_or(decorator.len());
    let call_target = decorator[..call_target_end].trim();
    let name = call_target.rsplit('.').next().unwrap_or(call_target);

    is_python_identifier(name).then(|| name.to_string())
}

fn call_names_in_line(line: &str) -> BTreeSet<String> {
    let bytes = line.as_bytes();
    let mut names = BTreeSet::new();
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'#' => break,
            b'\'' | b'"' => index = skip_python_string(bytes, index),
            byte if is_identifier_start(byte) => {
                let start = index;
                index += 1;
                while index < bytes.len() && is_identifier_continue(bytes[index]) {
                    index += 1;
                }

                let mut next = index;
                while next < bytes.len() && bytes[next].is_ascii_whitespace() {
                    next += 1;
                }
                if next < bytes.len() && bytes[next] == b'(' {
                    names.insert(line[start..index].to_string());
                }
            }
            _ => index += 1,
        }
    }

    names
}

fn unit_source_text(content: &str, unit: &FrameworkUnit) -> String {
    let lines = content.lines().collect::<Vec<_>>();
    if lines.is_empty() {
        return String::new();
    }

    let start = unit.range.start_line.min(lines.len() - 1);
    let search_end = unit.range.end_line.saturating_add(1).min(lines.len());
    let declaration = function_declaration_line(&lines, start, search_end).unwrap_or(start);
    let source_start = first_attached_decorator_line(&lines, start.min(declaration));
    let end = python_block_end(&lines, declaration, indentation_width(lines[declaration]))
        .max(search_end)
        .min(lines.len());

    lines[source_start..end].join("\n")
}

fn function_declaration_line(lines: &[&str], start: usize, end: usize) -> Option<usize> {
    (start..end).find(|line_index| is_function_declaration(lines[*line_index].trim_start()))
}

fn is_function_declaration(trimmed_line: &str) -> bool {
    trimmed_line.starts_with("def ") || trimmed_line.starts_with("async def ")
}

fn first_attached_decorator_line(lines: &[&str], declaration_or_start: usize) -> usize {
    let mut current = declaration_or_start;

    while current > 0 && lines[current - 1].trim_start().starts_with('@') {
        current -= 1;
    }

    current
}

fn python_block_end(lines: &[&str], start: usize, base_indent: usize) -> usize {
    let mut index = start + 1;

    while index < lines.len() {
        let trimmed = lines[index].trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            index += 1;
            continue;
        }
        if indentation_width(lines[index]) <= base_indent {
            break;
        }
        index += 1;
    }

    index
}

fn resolve_unit_by_name<'a>(
    units_by_name: &BTreeMap<String, Vec<&'a FrameworkUnit>>,
    source: &FrameworkUnit,
    name: &str,
) -> Option<&'a FrameworkUnit> {
    let candidates = units_by_name.get(name)?;
    let same_file = candidates
        .iter()
        .copied()
        .filter(|candidate| candidate.file_path == source.file_path)
        .collect::<Vec<_>>();

    if same_file.len() == 1 {
        return Some(same_file[0]);
    }
    if candidates.len() == 1 {
        return Some(candidates[0]);
    }

    None
}

fn push_unique_unit<'a>(
    units_by_name: &mut BTreeMap<String, Vec<&'a FrameworkUnit>>,
    name: &str,
    unit: &'a FrameworkUnit,
) {
    let units = units_by_name.entry(name.to_string()).or_default();
    if !units.iter().any(|candidate| candidate.id == unit.id) {
        units.push(unit);
    }
}

fn indentation_width(line: &str) -> usize {
    line.len().saturating_sub(line.trim_start().len())
}

fn delimiter_delta(line: &str) -> isize {
    line.chars().fold(0, |delta, character| match character {
        '(' | '[' | '{' => delta + 1,
        ')' | ']' | '}' => delta - 1,
        _ => delta,
    })
}

fn skip_python_string(bytes: &[u8], start: usize) -> usize {
    let quote = bytes[start];
    let mut index = start + 1;

    while index < bytes.len() {
        if bytes[index] == b'\\' {
            index += 2;
            continue;
        }
        if bytes[index] == quote {
            return index + 1;
        }
        index += 1;
    }

    bytes.len()
}

fn is_python_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };

    (first == '_' || first.is_ascii_alphabetic())
        && characters.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn is_identifier_character(character: Option<char>) -> bool {
    character
        .map(|value| value == '_' || value.is_ascii_alphanumeric())
        .unwrap_or(false)
}

fn is_identifier_start(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphabetic()
}

fn is_identifier_continue(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphanumeric()
}
