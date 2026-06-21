//! Deeper Django configuration and URL include relation extraction.
//!
//! This helper consumes existing Django semantic units and infers only
//! source-evidenced edges that can be resolved to a unique app unit.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use crate::model::{FrameworkUnit, FrameworkUnitEdge};

const MAX_RELATION_FILE_SIZE_BYTES: u64 = 1024 * 1024;

/// Infers Django config and route include edges from already-created units.
pub(super) fn relation_edges(units: &[FrameworkUnit]) -> Vec<FrameworkUnitEdge> {
    let catalog = AppCatalog::from_units(units);
    let contents_by_file = read_relation_source_files(units);
    let mut edges = EdgeAccumulator::default();

    add_installed_app_edges(units, &catalog, &contents_by_file, &mut edges);
    add_url_include_edges(units, &catalog, &contents_by_file, &mut edges);

    edges.into_edges()
}

/// App unit indexes used for conservative dotted module resolution.
struct AppCatalog<'a> {
    by_name: BTreeMap<String, Vec<&'a FrameworkUnit>>,
    by_qualified_name: BTreeMap<String, Vec<&'a FrameworkUnit>>,
}

impl<'a> AppCatalog<'a> {
    /// Builds app lookups while preserving ambiguous candidates for later checks.
    fn from_units(units: &'a [FrameworkUnit]) -> Self {
        let mut catalog = Self {
            by_name: BTreeMap::new(),
            by_qualified_name: BTreeMap::new(),
        };

        for unit in units.iter().filter(|unit| unit.kind == "app") {
            catalog
                .by_name
                .entry(unit.name.clone())
                .or_default()
                .push(unit);
            catalog
                .by_qualified_name
                .entry(unit.qualified_name.clone())
                .or_default()
                .push(unit);
        }

        catalog
    }

    /// Resolves an `INSTALLED_APPS` or `include("app.urls")` reference to one app.
    fn resolve_app_reference(
        &self,
        source: &FrameworkUnit,
        reference: &str,
    ) -> Option<&'a FrameworkUnit> {
        for candidate in qualified_app_candidates(reference) {
            if let Some(app) = resolve_unique_unit(&self.by_qualified_name, source, &candidate) {
                return Some(app);
            }
        }

        for candidate in app_name_candidates(reference) {
            if let Some(app) = resolve_unique_unit(&self.by_name, source, &candidate) {
                return Some(app);
            }
        }

        None
    }
}

/// Edge builder with a stable source-target-kind dedupe key.
#[derive(Default)]
struct EdgeAccumulator {
    seen: BTreeSet<(String, String, String)>,
    edges: Vec<FrameworkUnitEdge>,
}

impl EdgeAccumulator {
    /// Adds one inferred relation edge using the source unit location as evidence.
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

/// Adds `configuration -> app` edges from simple `INSTALLED_APPS` literals.
fn add_installed_app_edges(
    units: &[FrameworkUnit],
    catalog: &AppCatalog<'_>,
    contents_by_file: &BTreeMap<String, String>,
    edges: &mut EdgeAccumulator,
) {
    for unit in units.iter().filter(|unit| {
        unit.kind == "configuration" && has_file_name(&unit.file_path, "settings.py")
    }) {
        let Some(content) = contents_by_file.get(&unit.file_path) else {
            continue;
        };

        for reference in installed_app_references(content) {
            if let Some(app) = catalog.resolve_app_reference(unit, &reference) {
                edges.push(unit, app, "configures");
            }
        }
    }
}

/// Adds `route include -> app` edges from URLConf `include("app.urls")` calls.
fn add_url_include_edges(
    units: &[FrameworkUnit],
    catalog: &AppCatalog<'_>,
    contents_by_file: &BTreeMap<String, String>,
    edges: &mut EdgeAccumulator,
) {
    for unit in units
        .iter()
        .filter(|unit| unit.kind == "route" && has_file_name(&unit.file_path, "urls.py"))
    {
        let Some(content) = contents_by_file.get(&unit.file_path) else {
            continue;
        };

        let source_text = unit_source_text(content, unit);
        for reference in include_module_references(&source_text) {
            if let Some(app) = catalog.resolve_app_reference(unit, &reference) {
                edges.push(unit, app, "configures");
            }
        }
    }
}

/// Reads unique settings and URLConf files needed by this relation helper.
fn read_relation_source_files(units: &[FrameworkUnit]) -> BTreeMap<String, String> {
    let mut contents = BTreeMap::new();

    for unit in units
        .iter()
        .filter(|unit| matches!(unit.kind.as_str(), "configuration" | "route"))
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

/// Extracts dotted strings from `INSTALLED_APPS = [...]` assignment blocks.
fn installed_app_references(content: &str) -> BTreeSet<String> {
    let lines = source_lines(content);
    let mut references = BTreeSet::new();
    let mut index = 0usize;

    while index < lines.len() {
        let Some((block, end_index)) = installed_apps_assignment_block(&lines, index) else {
            index += 1;
            continue;
        };

        for literal in python_string_literals(&block) {
            if is_dotted_reference(&literal) {
                references.insert(literal);
            }
        }
        index = end_index.saturating_add(1);
    }

    references
}

/// Returns the source block for one `INSTALLED_APPS` assignment.
fn installed_apps_assignment_block(lines: &[&str], start: usize) -> Option<(String, usize)> {
    let code = code_before_comment(lines[start]);
    let token_index = find_identifier_token(code, "INSTALLED_APPS")?;
    let mut remainder = code[token_index + "INSTALLED_APPS".len()..].trim_start();

    if let Some(after_plus) = remainder.strip_prefix('+') {
        remainder = after_plus.trim_start();
    }
    if !remainder.starts_with('=') {
        return None;
    }

    let mut block = String::new();
    let mut balance = 0isize;
    let mut saw_collection = false;

    for (offset, line) in lines[start..].iter().enumerate() {
        if offset > 0 {
            block.push('\n');
        }
        block.push_str(line);

        balance += bracket_delta_outside_strings(line);
        saw_collection |= has_collection_open_outside_strings(line);

        if offset == 0 && !saw_collection {
            return Some((block, start));
        }
        if saw_collection && balance <= 0 {
            return Some((block, start + offset));
        }
    }

    Some((block, lines.len().saturating_sub(1)))
}

/// Extracts module strings from conservative URLConf `include(...)` calls.
fn include_module_references(source_text: &str) -> BTreeSet<String> {
    let bytes = source_text.as_bytes();
    let mut references = BTreeSet::new();
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'#' => index = skip_line_comment(bytes, index),
            b'\'' | b'"' => index = skip_python_string(bytes, index),
            byte if is_identifier_start(byte) => {
                let start = index;
                index += 1;
                while index < bytes.len() && is_identifier_continue(bytes[index]) {
                    index += 1;
                }

                if &source_text[start..index] != "include" {
                    continue;
                }

                let open_index = skip_ascii_whitespace(bytes, index);
                if bytes.get(open_index) != Some(&b'(') {
                    continue;
                }

                if let Some((arguments, end_index)) = call_arguments_at(source_text, open_index) {
                    for literal in python_string_literals(first_top_level_argument(arguments)) {
                        if literal.ends_with(".urls") && is_dotted_reference(&literal) {
                            references.insert(literal);
                        }
                    }
                    index = end_index;
                }
            }
            _ => index += 1,
        }
    }

    references
}

/// Builds exact and normalized dotted candidates for app module resolution.
fn qualified_app_candidates(reference: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    push_unique(&mut candidates, reference.trim());

    if let Some(base) = reference.trim().strip_suffix(".urls") {
        push_unique(&mut candidates, base);
    }

    if let Some((base, _)) = reference.trim().split_once(".apps.") {
        push_unique(&mut candidates, base);
    }

    candidates
}

/// Builds app display-name candidates from a dotted app reference.
fn app_name_candidates(reference: &str) -> Vec<String> {
    let mut candidates = Vec::new();

    for candidate in qualified_app_candidates(reference) {
        if let Some(name) = candidate.rsplit('.').next() {
            push_unique(&mut candidates, name);
        }
    }

    candidates
}

/// Resolves by matching Django root first, then by globally unique candidate.
fn resolve_unique_unit<'a>(
    units_by_key: &BTreeMap<String, Vec<&'a FrameworkUnit>>,
    source: &FrameworkUnit,
    key: &str,
) -> Option<&'a FrameworkUnit> {
    let candidates = units_by_key.get(key)?;
    let same_root = candidates
        .iter()
        .copied()
        .filter(|candidate| candidate.root_path == source.root_path)
        .collect::<Vec<_>>();

    if same_root.len() == 1 {
        return Some(same_root[0]);
    }
    if candidates.len() == 1 {
        return Some(candidates[0]);
    }

    None
}

/// Returns the source text covered by one framework unit range.
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

/// Splits source into lines without trailing carriage returns.
fn source_lines(content: &str) -> Vec<&str> {
    content
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .collect()
}

/// Returns code before an inline Python comment, ignoring comments in strings.
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

/// Finds an exact Python identifier token in a source line.
fn find_identifier_token(line: &str, expected: &str) -> Option<usize> {
    let bytes = line.as_bytes();
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
        if &line[start..index] == expected {
            return Some(start);
        }
    }

    None
}

/// Collects simple Python string literal contents from source text.
fn python_string_literals(source: &str) -> Vec<String> {
    let bytes = source.as_bytes();
    let mut literals = Vec::new();
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'#' => index = skip_line_comment(bytes, index),
            b'\'' | b'"' => {
                if let Some((literal, end_index)) = parse_python_string(source, index) {
                    literals.push(literal);
                    index = end_index;
                } else {
                    index = skip_python_string(bytes, index);
                }
            }
            _ => index += 1,
        }
    }

    literals
}

/// Parses a single or triple quoted Python string literal from a quote index.
fn parse_python_string(source: &str, quote_index: usize) -> Option<(String, usize)> {
    let bytes = source.as_bytes();
    let quote = bytes[quote_index];
    let triple = is_triple_quote(bytes, quote_index, quote);
    let content_start = quote_index + if triple { 3 } else { 1 };
    let mut index = content_start;

    while index < bytes.len() {
        if bytes[index] == b'\\' {
            index = index.saturating_add(2);
            continue;
        }
        if triple && is_triple_quote(bytes, index, quote) {
            return Some((source[content_start..index].to_string(), index + 3));
        }
        if !triple && bytes[index] == quote {
            return Some((source[content_start..index].to_string(), index + 1));
        }
        index += 1;
    }

    None
}

/// Skips a Python string literal without allocating.
fn skip_python_string(bytes: &[u8], quote_index: usize) -> usize {
    let quote = bytes[quote_index];
    let triple = is_triple_quote(bytes, quote_index, quote);
    let mut index = quote_index + if triple { 3 } else { 1 };

    while index < bytes.len() {
        if bytes[index] == b'\\' {
            index = index.saturating_add(2);
        } else if triple && is_triple_quote(bytes, index, quote) {
            return index + 3;
        } else if !triple && bytes[index] == quote {
            return index + 1;
        } else {
            index += 1;
        }
    }

    bytes.len()
}

/// Returns whether a quote index starts a triple quoted literal.
fn is_triple_quote(bytes: &[u8], index: usize, quote: u8) -> bool {
    bytes.get(index) == Some(&quote)
        && bytes.get(index + 1) == Some(&quote)
        && bytes.get(index + 2) == Some(&quote)
}

/// Counts bracket balance outside simple strings and comments.
fn bracket_delta_outside_strings(line: &str) -> isize {
    let bytes = line.as_bytes();
    let mut delta = 0isize;
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'#' => break,
            b'\'' | b'"' => index = skip_python_string(bytes, index),
            b'[' | b'(' | b'{' => {
                delta += 1;
                index += 1;
            }
            b']' | b')' | b'}' => {
                delta -= 1;
                index += 1;
            }
            _ => index += 1,
        }
    }

    delta
}

/// Returns whether a line opens a collection outside simple strings and comments.
fn has_collection_open_outside_strings(line: &str) -> bool {
    let bytes = line.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'#' => return false,
            b'\'' | b'"' => index = skip_python_string(bytes, index),
            b'[' | b'(' | b'{' => return true,
            _ => index += 1,
        }
    }

    false
}

/// Returns the inside of a call whose opening parenthesis is at `open_index`.
fn call_arguments_at(source: &str, open_index: usize) -> Option<(&str, usize)> {
    let close_index = matching_close_paren(source.as_bytes(), open_index)?;
    Some((&source[open_index + 1..close_index], close_index + 1))
}

/// Finds the matching close parenthesis for a call, skipping strings and comments.
fn matching_close_paren(bytes: &[u8], open_index: usize) -> Option<usize> {
    let mut depth = 0isize;
    let mut index = open_index;

    while index < bytes.len() {
        match bytes[index] {
            b'#' => index = skip_line_comment(bytes, index),
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

/// Returns the first top-level argument from a comma-separated call argument list.
fn first_top_level_argument(arguments: &str) -> &str {
    let bytes = arguments.as_bytes();
    let mut depth = 0isize;
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'#' => index = skip_line_comment(bytes, index),
            b'\'' | b'"' => index = skip_python_string(bytes, index),
            b'(' | b'[' | b'{' => {
                depth += 1;
                index += 1;
            }
            b')' | b']' | b'}' => {
                depth -= 1;
                index += 1;
            }
            b',' if depth == 0 => return arguments[..index].trim(),
            _ => index += 1,
        }
    }

    arguments.trim()
}

/// Skips from a comment marker to the next line.
fn skip_line_comment(bytes: &[u8], start: usize) -> usize {
    let mut index = start;
    while index < bytes.len() && bytes[index] != b'\n' {
        index += 1;
    }
    index
}

/// Skips ASCII whitespace from a byte index.
fn skip_ascii_whitespace(bytes: &[u8], start: usize) -> usize {
    let mut index = start;
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    index
}

/// Pushes a non-empty candidate while preserving candidate priority order.
fn push_unique(candidates: &mut Vec<String>, value: &str) {
    if value.is_empty() || candidates.iter().any(|candidate| candidate == value) {
        return;
    }

    candidates.push(value.to_string());
}

/// Returns whether a string is a conservative dotted Python module reference.
fn is_dotted_reference(value: &str) -> bool {
    !value.is_empty() && value.split('.').all(is_identifier)
}

/// Returns whether a path has the provided file name.
fn has_file_name(file_path: &str, expected: &str) -> bool {
    Path::new(file_path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(|name| name == expected)
        .unwrap_or(false)
}

/// Returns whether a full string is an ASCII Python identifier.
fn is_identifier(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || !is_identifier_start(bytes[0]) {
        return false;
    }

    bytes[1..].iter().all(|byte| is_identifier_continue(*byte))
}

/// Returns whether a byte can start an ASCII Python identifier.
fn is_identifier_start(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphabetic()
}

/// Returns whether a byte can continue an ASCII Python identifier.
fn is_identifier_continue(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphanumeric()
}
