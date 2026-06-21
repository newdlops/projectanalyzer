//! React and Next.js semantic relation extraction helpers.
//!
//! Adds conservative render edges by re-reading source files and resolving JSX
//! component tags against already-created units.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use crate::model::{FrameworkUnit, FrameworkUnitEdge};

const MAX_RELATION_FILE_SIZE_BYTES: u64 = 1024 * 1024;
const MAX_UNIT_SOURCE_LINES: usize = 400;

/// Infers React/Next.js relation edges from already-created framework units.
///
/// Resolution prefers same-file candidates, then same route segment candidates,
/// and only falls back to a global match when a single target unit exists.
pub(super) fn relation_edges(units: &[FrameworkUnit]) -> Vec<FrameworkUnitEdge> {
    let contents_by_file = read_relation_source_files(units);
    let catalog = UnitCatalog::from_units(units, &contents_by_file);
    let mut edges = EdgeAccumulator::default();

    add_jsx_render_edges(units, &catalog, &contents_by_file, &mut edges);
    add_next_default_component_edges(units, &catalog, &mut edges);

    edges.into_edges()
}

/// Name and locality indexes used to resolve source references conservatively.
struct UnitCatalog<'a> {
    targets_by_name: BTreeMap<String, Vec<&'a FrameworkUnit>>,
    units_by_file: BTreeMap<String, Vec<&'a FrameworkUnit>>,
    default_targets_by_segment: BTreeMap<String, Vec<&'a FrameworkUnit>>,
}

impl<'a> UnitCatalog<'a> {
    fn from_units(units: &'a [FrameworkUnit], contents_by_file: &BTreeMap<String, String>) -> Self {
        let mut catalog = Self {
            targets_by_name: BTreeMap::new(),
            units_by_file: BTreeMap::new(),
            default_targets_by_segment: BTreeMap::new(),
        };

        for unit in units {
            catalog
                .units_by_file
                .entry(unit.file_path.clone())
                .or_default()
                .push(unit);

            if is_render_target(unit) {
                catalog
                    .targets_by_name
                    .entry(unit.name.clone())
                    .or_default()
                    .push(unit);

                if let Some(content) = contents_by_file.get(&unit.file_path) {
                    if default_export_targets_unit(content, unit) {
                        catalog
                            .default_targets_by_segment
                            .entry(segment_key(&unit.file_path))
                            .or_default()
                            .push(unit);
                    }
                }
            }
        }

        catalog
    }

    /// Resolves a JSX tag or default export name to an existing target unit.
    fn resolve_named_target(
        &self,
        source: &FrameworkUnit,
        name: &str,
    ) -> Option<&'a FrameworkUnit> {
        let candidates = self.targets_by_name.get(name)?;
        resolve_local_candidate(source, candidates.iter().copied())
    }

    /// Finds a default component/provider in the same route segment.
    fn resolve_segment_default(&self, source: &FrameworkUnit) -> Option<&'a FrameworkUnit> {
        let candidates = self
            .default_targets_by_segment
            .get(&segment_key(&source.file_path))?;
        resolve_local_candidate(source, candidates.iter().copied())
    }

    fn file_units(&self, file_path: &str) -> Vec<&'a FrameworkUnit> {
        self.units_by_file
            .get(file_path)
            .cloned()
            .unwrap_or_default()
    }
}

/// Edge builder with a stable source-target-kind dedupe key.
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

/// Adds `renders` edges from JSX tag usage in route/layout/component sources.
fn add_jsx_render_edges(
    units: &[FrameworkUnit],
    catalog: &UnitCatalog<'_>,
    contents_by_file: &BTreeMap<String, String>,
    edges: &mut EdgeAccumulator,
) {
    for source in units.iter().filter(|unit| is_render_source(unit)) {
        let Some(content) = contents_by_file.get(&source.file_path) else {
            continue;
        };

        let file_units = catalog.file_units(&source.file_path);
        let source_text = source_text_for_unit(content, source, &file_units);
        for tag_name in jsx_tag_names(&source_text) {
            if let Some(target) = catalog.resolve_named_target(source, &tag_name) {
                edges.push(source, target, "renders");
            }
        }
    }
}

/// Adds route/layout render edges to default component units in the same file or segment.
fn add_next_default_component_edges(
    units: &[FrameworkUnit],
    catalog: &UnitCatalog<'_>,
    edges: &mut EdgeAccumulator,
) {
    for source in units
        .iter()
        .filter(|unit| matches!(unit.kind.as_str(), "route" | "layout"))
    {
        let Some(target) = catalog.resolve_segment_default(source) else {
            continue;
        };

        if source.kind == "route" && source.file_path == target.file_path {
            continue;
        }

        edges.push(source, target, "renders");
    }
}

fn read_relation_source_files(units: &[FrameworkUnit]) -> BTreeMap<String, String> {
    let mut contents = BTreeMap::new();

    for unit in units
        .iter()
        .filter(|unit| is_render_source(unit) || is_render_target(unit))
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

fn read_small_text_file(file_path: &str) -> Option<String> {
    let metadata = fs::metadata(file_path).ok()?;
    if metadata.len() > MAX_RELATION_FILE_SIZE_BYTES {
        return None;
    }

    fs::read_to_string(file_path).ok()
}

fn is_render_source(unit: &FrameworkUnit) -> bool {
    matches!(
        unit.kind.as_str(),
        "component" | "provider" | "route" | "layout"
    )
}

fn is_render_target(unit: &FrameworkUnit) -> bool {
    matches!(unit.kind.as_str(), "component" | "provider" | "layout")
}

fn resolve_local_candidate<'a>(
    source: &FrameworkUnit,
    candidates: impl Iterator<Item = &'a FrameworkUnit>,
) -> Option<&'a FrameworkUnit> {
    let candidates = candidates
        .filter(|candidate| candidate.id != source.id)
        .collect::<Vec<_>>();

    let same_file = candidates
        .iter()
        .copied()
        .filter(|candidate| candidate.file_path == source.file_path)
        .collect::<Vec<_>>();
    if same_file.len() == 1 {
        return same_file.first().copied();
    }

    let source_segment = segment_key(&source.file_path);
    let same_segment = candidates
        .iter()
        .copied()
        .filter(|candidate| segment_key(&candidate.file_path) == source_segment)
        .collect::<Vec<_>>();
    if same_segment.len() == 1 {
        return same_segment.first().copied();
    }

    (candidates.len() == 1).then(|| candidates[0])
}

fn source_text_for_unit(
    content: &str,
    unit: &FrameworkUnit,
    file_units: &[&FrameworkUnit],
) -> String {
    if matches!(unit.kind.as_str(), "route" | "layout") {
        return strip_js_comments(content);
    }

    let lines = content.lines().collect::<Vec<_>>();
    if lines.is_empty() {
        return String::new();
    }

    let start = unit.range.start_line.min(lines.len() - 1);
    let ceiling = next_unit_start_line(unit, file_units).unwrap_or(lines.len());
    let end = declaration_end_line(&lines, start, ceiling);
    strip_js_comments(&lines[start..=end].join("\n"))
}

fn next_unit_start_line(unit: &FrameworkUnit, file_units: &[&FrameworkUnit]) -> Option<usize> {
    file_units
        .iter()
        .filter(|candidate| candidate.id != unit.id && candidate.kind != "module")
        .map(|candidate| candidate.range.start_line)
        .filter(|line| *line > unit.range.start_line)
        .min()
}

fn declaration_end_line(lines: &[&str], start: usize, ceiling: usize) -> usize {
    let max_end = lines.len().min(ceiling).min(start + MAX_UNIT_SOURCE_LINES);
    let mut depth = 0isize;
    let mut saw_block = false;
    let mut saw_arrow = false;

    for (line_index, line) in lines.iter().enumerate().take(max_end).skip(start) {
        let source = line.split("//").next().unwrap_or(line);
        saw_arrow |= source.contains("=>");
        saw_block |= source.contains('{');
        depth += brace_delta(source);

        if saw_block && line_index > start && depth <= 0 {
            return line_index;
        }
        if !saw_block && saw_arrow && source.contains(';') {
            return line_index;
        }
    }

    max_end.saturating_sub(1).max(start)
}

fn brace_delta(source: &str) -> isize {
    source.chars().fold(0, |delta, character| match character {
        '{' => delta + 1,
        '}' => delta - 1,
        _ => delta,
    })
}

fn jsx_tag_names(source: &str) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    let mut search_start = 0usize;

    while let Some(relative) = source[search_start..].find('<') {
        let tag_start = search_start + relative + 1;
        let tag_source = &source[tag_start..];
        search_start = tag_start;

        if tag_source.starts_with('/')
            || tag_source.starts_with('>')
            || tag_source.starts_with('!')
            || tag_source.starts_with('?')
        {
            continue;
        }

        let Some(name) = read_js_identifier(tag_source) else {
            continue;
        };
        if name.len() < 2 || !is_pascal_case_identifier(&name) {
            continue;
        }

        let after = tag_source[name.len()..].chars().next();
        let has_tag_boundary = after
            .map(|character| character.is_whitespace() || matches!(character, '/' | '>'))
            .unwrap_or(false);
        if has_tag_boundary {
            names.insert(name);
        }
    }

    names
}

fn default_export_targets_unit(content: &str, unit: &FrameworkUnit) -> bool {
    default_export_name(content, &unit.file_path)
        .map(|name| name == unit.name)
        .unwrap_or(false)
}

fn default_export_name(content: &str, file_path: &str) -> Option<String> {
    let source = strip_js_comments(content);

    for line in source.lines() {
        let trimmed = line.trim_start();
        if let Some(name) = declaration_default_export(trimmed, file_path) {
            return Some(name);
        }
        if let Some(name) = identifier_default_export(trimmed) {
            return Some(name);
        }
    }

    None
}

fn declaration_default_export(source: &str, file_path: &str) -> Option<String> {
    let rest = source.strip_prefix("export default")?.trim_start();
    let rest = rest.strip_prefix("async").unwrap_or(rest).trim_start();

    if let Some(after_keyword) = keyword_remainder(rest, "function") {
        return read_js_identifier(after_keyword)
            .or_else(|| Some(default_component_name(file_path)));
    }
    if let Some(after_keyword) = keyword_remainder(rest, "class") {
        return read_js_identifier(after_keyword)
            .or_else(|| Some(default_component_name(file_path)));
    }

    None
}

fn identifier_default_export(source: &str) -> Option<String> {
    let rest = source.strip_prefix("export default")?.trim_start();
    let name = read_js_identifier(rest)?;
    let after = rest[name.len()..].trim_start();

    matches!(after.chars().next(), Some(';') | None).then_some(name)
}

fn keyword_remainder<'a>(source: &'a str, keyword: &str) -> Option<&'a str> {
    let remainder = source.strip_prefix(keyword)?;
    let next = remainder.chars().next();
    if !next
        .map(|character| character.is_whitespace() || matches!(character, '(' | '<'))
        .unwrap_or(true)
    {
        return None;
    }
    Some(remainder.trim_start())
}

fn read_js_identifier(source: &str) -> Option<String> {
    let mut end = 0usize;

    for (index, character) in source.char_indices() {
        let valid = if index == 0 {
            character == '_' || character == '$' || character.is_ascii_alphabetic()
        } else {
            character == '_' || character == '$' || character.is_ascii_alphanumeric()
        };

        if !valid {
            break;
        }

        end = index + character.len_utf8();
    }

    (end > 0).then(|| source[..end].to_string())
}

fn is_pascal_case_identifier(name: &str) -> bool {
    name.chars()
        .next()
        .map(|character| character.is_ascii_uppercase())
        .unwrap_or(false)
}

fn default_component_name(file_path: &str) -> String {
    let stem = Path::new(file_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("DefaultExport");
    let mut name = String::new();
    let mut uppercase_next = true;

    for character in stem.chars() {
        if character.is_ascii_alphanumeric() {
            if uppercase_next {
                name.push(character.to_ascii_uppercase());
            } else {
                name.push(character);
            }
            uppercase_next = false;
        } else {
            uppercase_next = true;
        }
    }

    if name.is_empty() {
        "DefaultExport".to_string()
    } else {
        name
    }
}

fn segment_key(file_path: &str) -> String {
    Path::new(file_path)
        .parent()
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

fn strip_js_comments(source: &str) -> String {
    let mut output = String::with_capacity(source.len());
    let mut characters = source.chars().peekable();

    while let Some(character) = characters.next() {
        if character == '/' && characters.peek() == Some(&'/') {
            characters.next();
            for next in characters.by_ref() {
                if next == '\n' {
                    output.push('\n');
                    break;
                }
            }
            continue;
        }

        if character == '/' && characters.peek() == Some(&'*') {
            characters.next();
            let mut previous = '\0';
            for next in characters.by_ref() {
                if next == '\n' {
                    output.push('\n');
                }
                if previous == '*' && next == '/' {
                    break;
                }
                previous = next;
            }
            continue;
        }

        output.push(character);
    }

    output
}
