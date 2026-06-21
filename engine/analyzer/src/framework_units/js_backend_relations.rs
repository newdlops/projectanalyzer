//! Express/NestJS semantic relation extraction helpers.
//!
//! This module adds conservative edges between already discovered backend
//! framework units. It never creates units or follows ambiguous references.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;

use crate::model::{FrameworkUnit, FrameworkUnitEdge};

use super::js_backend_support::{
    delimiter_delta, find_member_call_open, is_identifier_character, is_js_identifier,
    read_string_literal_value, split_top_level_arguments,
};

const MAX_RELATION_FILE_SIZE_BYTES: u64 = 1024 * 1024;
const MAX_STATEMENT_LINES: usize = 40;
const NEST_CLASS_LOOKAHEAD_LINES: usize = 24;

/// Infers source-backed Express/NestJS relation edges from existing units.
pub(super) fn relation_edges(units: &[FrameworkUnit]) -> Vec<FrameworkUnitEdge> {
    let catalog = UnitCatalog::from_units(units);
    let contents = read_relation_source_files(units);
    let mut edges = EdgeAccumulator::default();

    for controller in units
        .iter()
        .filter(|unit| unit.framework == "NestJS" && unit.kind == "controller")
    {
        let Some(content) = contents.get(&controller.file_path) else {
            continue;
        };
        let source_text = nest_controller_source_text(content, controller);
        for type_name in constructor_type_names(&source_text) {
            if let Some(target) = catalog.resolve_injectable(controller, &type_name) {
                edges.push(controller, target, "injects");
            }
        }
    }

    for source in units.iter().filter(|unit| {
        unit.framework == "Express" && matches!(unit.kind.as_str(), "route" | "controller")
    }) {
        let Some(content) = contents.get(&source.file_path) else {
            continue;
        };
        let source_text = statement_source_text(content, source);
        for handler_name in express_handler_names(&source_text) {
            if let Some(middleware) = catalog.resolve_middleware(source, &handler_name) {
                edges.push(source, middleware, "calls");
            }
        }
    }

    edges.into_edges()
}

/// Name indexes for scoped relation resolution.
struct UnitCatalog<'a> {
    injectables: BTreeMap<String, Vec<&'a FrameworkUnit>>,
    middleware: BTreeMap<String, Vec<&'a FrameworkUnit>>,
}

impl<'a> UnitCatalog<'a> {
    fn from_units(units: &'a [FrameworkUnit]) -> Self {
        let mut catalog = Self {
            injectables: BTreeMap::new(),
            middleware: BTreeMap::new(),
        };

        for unit in units {
            match unit.kind.as_str() {
                "service" | "provider" => catalog
                    .injectables
                    .entry(unit.name.clone())
                    .or_default()
                    .push(unit),
                "middleware" => catalog
                    .middleware
                    .entry(unit.name.clone())
                    .or_default()
                    .push(unit),
                _ => {}
            }
        }

        catalog
    }

    fn resolve_injectable(&self, source: &FrameworkUnit, name: &str) -> Option<&'a FrameworkUnit> {
        resolve_unit_by_name(&self.injectables, source, name)
    }

    fn resolve_middleware(&self, source: &FrameworkUnit, name: &str) -> Option<&'a FrameworkUnit> {
        resolve_unit_by_name(&self.middleware, source, name)
    }
}

/// Stable edge accumulator with source-target-kind dedupe.
#[derive(Default)]
struct EdgeAccumulator {
    seen: BTreeSet<(String, String, String)>,
    edges: Vec<FrameworkUnitEdge>,
}

impl EdgeAccumulator {
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

fn read_relation_source_files(units: &[FrameworkUnit]) -> BTreeMap<String, String> {
    let mut contents = BTreeMap::new();

    for unit in units.iter().filter(|unit| {
        matches!(
            unit.kind.as_str(),
            "controller" | "route" | "service" | "provider" | "middleware"
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
    (metadata.len() <= MAX_RELATION_FILE_SIZE_BYTES)
        .then(|| fs::read_to_string(file_path).ok())
        .flatten()
}

fn nest_controller_source_text(content: &str, unit: &FrameworkUnit) -> String {
    let lines = source_lines(content);
    if lines.is_empty() {
        return String::new();
    }

    let search_start = unit.range.start_line.min(lines.len() - 1);
    let search_end = unit
        .range
        .end_line
        .saturating_add(NEST_CLASS_LOOKAHEAD_LINES)
        .min(lines.len() - 1);

    for line_index in search_start..=search_end {
        if class_declaration_name(lines[line_index]).as_deref() == Some(unit.name.as_str()) {
            let end = brace_block_end(&lines, line_index);
            return lines[line_index..end].join("\n");
        }
    }

    statement_source_text(content, unit)
}

fn statement_source_text(content: &str, unit: &FrameworkUnit) -> String {
    let lines = source_lines(content);
    if lines.is_empty() {
        return String::new();
    }

    let start = unit.range.start_line.min(lines.len() - 1);
    let mut end = unit.range.end_line.min(lines.len() - 1);
    let mut balance = 0isize;
    let mut opened = false;

    for (line_index, line) in lines.iter().enumerate().skip(start) {
        opened |= line.contains('(');
        balance += delimiter_delta(line);
        end = line_index;

        if opened && balance <= 0 {
            break;
        }
        if line_index.saturating_sub(start) >= MAX_STATEMENT_LINES {
            break;
        }
    }

    lines[start..=end].join("\n")
}

fn constructor_type_names(source_text: &str) -> Vec<String> {
    let Some(open_index) = keyword_call_open(source_text, "constructor") else {
        return Vec::new();
    };
    let Some(close_index) = matching_close(source_text, open_index, '(', ')') else {
        return Vec::new();
    };

    split_top_level_arguments(&source_text[open_index + 1..close_index])
        .into_iter()
        .filter_map(|parameter| parameter_type_name(&parameter))
        .collect()
}

fn keyword_call_open(source: &str, keyword: &str) -> Option<usize> {
    let mut search_start = 0usize;

    while let Some(relative) = source[search_start..].find(keyword) {
        let start = search_start + relative;
        let end = start + keyword.len();
        let before = source[..start].chars().next_back();
        let remainder = &source[end..];
        let whitespace = remainder.len() - remainder.trim_start().len();

        if !is_identifier_character(before) && remainder[whitespace..].starts_with('(') {
            return Some(end + whitespace);
        }

        search_start = end;
    }

    None
}

fn parameter_type_name(parameter: &str) -> Option<String> {
    let parameter = parameter.split('=').next()?.trim_end();
    let type_source = parameter.rsplit_once(':')?.1.trim_start();
    read_type_identifier(type_source)
}

fn read_type_identifier(source: &str) -> Option<String> {
    let trimmed = source
        .trim_start_matches("readonly ")
        .trim_start_matches("public ")
        .trim_start_matches("private ")
        .trim_start_matches("protected ")
        .trim_start();
    let source = trimmed
        .strip_prefix("typeof ")
        .unwrap_or(trimmed)
        .trim_start();
    let end = source
        .find(|character: char| {
            !(character == '_' || character == '$' || character.is_ascii_alphanumeric())
        })
        .unwrap_or(source.len());
    let name = &source[..end];

    is_js_identifier(name).then(|| name.to_string())
}

fn express_handler_names(source_text: &str) -> Vec<String> {
    let Some(arguments) = express_route_arguments(source_text) else {
        return Vec::new();
    };

    arguments
        .iter()
        .skip(1)
        .filter_map(|argument| handler_name(argument))
        .collect()
}

fn express_route_arguments(source: &str) -> Option<Vec<String>> {
    let mut selected_open = None;
    for owner in ["app", "router"] {
        for method in ["get", "post", "put", "delete", "patch"] {
            if let Some(open_index) = find_member_call_open(source, owner, method) {
                if selected_open
                    .map(|current| open_index < current)
                    .unwrap_or(true)
                {
                    selected_open = Some(open_index);
                }
            }
        }
    }

    let open_index = selected_open?;
    let close_index = matching_close(source, open_index, '(', ')')?;
    let arguments = split_top_level_arguments(&source[open_index + 1..close_index]);
    read_string_literal_value(arguments.first()?)?;
    Some(arguments)
}

fn handler_name(argument: &str) -> Option<String> {
    let mut source = argument.trim();
    source = source.strip_prefix("async ").unwrap_or(source).trim_start();
    if source.contains("=>") {
        return None;
    }

    if let Some(name) = named_function_name(source) {
        return Some(name);
    }
    if let Some(as_index) = source.find(" as ") {
        source = source[..as_index].trim_end();
    }
    if let Some(bind_index) = source.find(".bind(") {
        source = source[..bind_index].trim_end();
    }
    if let Some(open_index) = source.find('(') {
        source = source[..open_index].trim_end();
    }
    if !source.chars().all(|character| {
        character == '.'
            || character == '_'
            || character == '$'
            || character.is_ascii_alphanumeric()
    }) {
        return None;
    }

    let name = source.rsplit('.').next().unwrap_or("");
    is_js_identifier(name).then(|| name.to_string())
}

fn named_function_name(source: &str) -> Option<String> {
    let remainder = source.trim_start().strip_prefix("function")?;
    let name = remainder.trim_start().split('(').next()?.trim();
    is_js_identifier(name).then(|| name.to_string())
}

fn resolve_unit_by_name<'a>(
    units_by_name: &BTreeMap<String, Vec<&'a FrameworkUnit>>,
    source: &FrameworkUnit,
    name: &str,
) -> Option<&'a FrameworkUnit> {
    let candidates = units_by_name.get(name)?;

    unique_match(candidates, |candidate| {
        source.parent_id.is_some() && candidate.parent_id == source.parent_id
    })
    .or_else(|| {
        unique_match(candidates, |candidate| {
            candidate.file_path == source.file_path
        })
    })
    .or_else(|| {
        let parent = source.qualified_name.rsplit_once('.')?.0;
        unique_match(candidates, |candidate| {
            candidate
                .qualified_name
                .rsplit_once('.')
                .map(|(candidate_parent, _)| candidate_parent == parent)
                .unwrap_or(false)
        })
    })
    .or_else(|| (candidates.len() == 1).then_some(candidates[0]))
}

fn unique_match<'a>(
    candidates: &[&'a FrameworkUnit],
    predicate: impl Fn(&FrameworkUnit) -> bool,
) -> Option<&'a FrameworkUnit> {
    let mut matches = candidates.iter().copied().filter(|unit| predicate(unit));
    let first = matches.next()?;
    matches.next().is_none().then_some(first)
}

fn source_lines(content: &str) -> Vec<&str> {
    content
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .collect()
}

fn class_declaration_name(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let class_index = trimmed.find("class ")?;
    let candidate = trimmed[class_index + "class ".len()..]
        .split(|character: char| {
            !(character == '_' || character == '$' || character.is_ascii_alphanumeric())
        })
        .next()?;
    is_js_identifier(candidate).then(|| candidate.to_string())
}

fn brace_block_end(lines: &[&str], start_line: usize) -> usize {
    let mut balance = 0isize;
    let mut opened = false;

    for (line_index, line) in lines.iter().enumerate().skip(start_line) {
        opened |= line.contains('{');
        balance += delimiter_delta(line);
        if opened && line_index > start_line && balance <= 0 {
            return (line_index + 1).min(lines.len());
        }
    }

    lines.len()
}

fn matching_close(source: &str, open_index: usize, open: char, close: char) -> Option<usize> {
    let mut depth = 0isize;
    let mut in_string: Option<char> = None;
    let mut escaped = false;

    for (index, character) in source
        .char_indices()
        .skip_while(|(index, _)| *index < open_index)
    {
        if let Some(quote) = in_string {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == quote {
                in_string = None;
            }
            continue;
        }

        match character {
            '\'' | '"' | '`' => in_string = Some(character),
            value if value == open => depth += 1,
            value if value == close => {
                depth -= 1;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }

    None
}
