//! Django semantic relation extraction helpers.
//!
//! This module keeps relation inference separate from Django unit discovery. It
//! only uses serialized `FrameworkUnit` fields plus conservative source reads so
//! the parent adapter can attach the returned edges without new model metadata.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;

use crate::model::{FrameworkUnit, FrameworkUnitEdge};

const MAX_RELATION_FILE_SIZE_BYTES: u64 = 1024 * 1024;

/// Infers Django relation edges from already-created framework units.
///
/// The extractor is intentionally conservative: ambiguous duplicate target
/// names are skipped unless a single unit in the same parent app can be found.
pub(super) fn relation_edges(units: &[FrameworkUnit]) -> Vec<FrameworkUnitEdge> {
    let catalog = UnitCatalog::from_units(units);
    let contents_by_file = read_relation_source_files(units);
    let mut edges = EdgeAccumulator::default();

    add_serializer_model_edges(units, &catalog, &contents_by_file, &mut edges);
    add_view_relation_edges(units, &catalog, &contents_by_file, &mut edges);

    edges.into_edges()
}

/// Name indexes for resolving source references to existing units.
struct UnitCatalog<'a> {
    models_by_name: BTreeMap<String, Vec<&'a FrameworkUnit>>,
    serializers_by_name: BTreeMap<String, Vec<&'a FrameworkUnit>>,
}

impl<'a> UnitCatalog<'a> {
    /// Builds lookup tables from unit names while preserving all ambiguous
    /// candidates for later app-scoped resolution.
    fn from_units(units: &'a [FrameworkUnit]) -> Self {
        let mut catalog = Self {
            models_by_name: BTreeMap::new(),
            serializers_by_name: BTreeMap::new(),
        };

        for unit in units {
            match unit.kind.as_str() {
                "model" => catalog
                    .models_by_name
                    .entry(unit.name.clone())
                    .or_default()
                    .push(unit),
                "serializer" => catalog
                    .serializers_by_name
                    .entry(unit.name.clone())
                    .or_default()
                    .push(unit),
                _ => {}
            }
        }

        catalog
    }

    /// Resolves a model reference by exact model unit name.
    fn resolve_model(&self, source: &FrameworkUnit, name: &str) -> Option<&'a FrameworkUnit> {
        resolve_unit_by_name(&self.models_by_name, source, name)
    }

    /// Resolves a serializer constructor reference by exact serializer unit name.
    fn resolve_serializer(&self, source: &FrameworkUnit, name: &str) -> Option<&'a FrameworkUnit> {
        resolve_unit_by_name(&self.serializers_by_name, source, name)
    }
}

/// Edge builder with a stable source-target-kind dedupe key.
#[derive(Default)]
struct EdgeAccumulator {
    /// Cache key preserving the graph identity invariant for relation edges.
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

/// Adds `serializer -> model` edges from `ModelSerializer.Meta.model`.
fn add_serializer_model_edges(
    units: &[FrameworkUnit],
    catalog: &UnitCatalog<'_>,
    contents_by_file: &BTreeMap<String, String>,
    edges: &mut EdgeAccumulator,
) {
    for unit in units.iter().filter(|unit| {
        unit.kind == "serializer" && has_file_name(&unit.file_path, "serializers.py")
    }) {
        let Some(content) = contents_by_file.get(&unit.file_path) else {
            continue;
        };
        let Some(model_name) = serializer_meta_model_name(content, unit) else {
            continue;
        };
        let Some(model) = catalog.resolve_model(unit, &model_name) else {
            continue;
        };

        edges.push(unit, model, "usesModel");
    }
}

/// Adds `view -> model` and `view -> serializer` edges from view source blocks.
fn add_view_relation_edges(
    units: &[FrameworkUnit],
    catalog: &UnitCatalog<'_>,
    contents_by_file: &BTreeMap<String, String>,
    edges: &mut EdgeAccumulator,
) {
    for unit in units
        .iter()
        .filter(|unit| unit.kind == "view" && has_file_name(&unit.file_path, "views.py"))
    {
        let Some(content) = contents_by_file.get(&unit.file_path) else {
            continue;
        };

        let source_text = unit_source_text(content, unit);
        for model_name in objects_model_names(&source_text) {
            if let Some(model) = catalog.resolve_model(unit, &model_name) {
                edges.push(unit, model, "usesModel");
            }
        }

        for serializer_name in constructor_call_names(&source_text) {
            if let Some(serializer) = catalog.resolve_serializer(unit, &serializer_name) {
                edges.push(unit, serializer, "renders");
            }
        }
    }
}

/// Reads unique serializer/view files needed by relation rules.
fn read_relation_source_files(units: &[FrameworkUnit]) -> BTreeMap<String, String> {
    let mut contents = BTreeMap::new();

    for unit in units
        .iter()
        .filter(|unit| matches!(unit.kind.as_str(), "serializer" | "view"))
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

/// Extracts the model name from a simple `class Meta: model = Post` block.
fn serializer_meta_model_name(content: &str, unit: &FrameworkUnit) -> Option<String> {
    let lines = source_lines(content);
    let start = unit.range.start_line.min(lines.len().checked_sub(1)?);
    let class_line = lines[start];
    let class_indent = indentation_width(class_line);

    if class_declaration_name(class_line).as_deref() != Some(unit.name.as_str()) {
        return None;
    }
    if !contains_identifier(class_line, "ModelSerializer") {
        return None;
    }

    let class_end = python_block_end(&lines, start, class_indent);
    let mut index = start + 1;
    while index < class_end {
        let line = lines[index];
        if is_meta_class_line(line, class_indent) {
            if let Some(model_name) = inline_meta_model_name(line) {
                return Some(model_name);
            }

            let meta_indent = indentation_width(line);
            let meta_end = python_block_end(&lines, index, meta_indent).min(class_end);

            for meta_line in &lines[index + 1..meta_end] {
                if let Some(model_name) = model_assignment_name(meta_line) {
                    return Some(model_name);
                }
            }
        }

        index += 1;
    }

    None
}

/// Returns the source text owned by a unit range or declaration block.
fn unit_source_text(content: &str, unit: &FrameworkUnit) -> String {
    let lines = source_lines(content);
    if lines.is_empty() {
        return String::new();
    }

    let start = unit.range.start_line.min(lines.len() - 1);
    let end = if is_unit_declaration_line(lines[start], unit) {
        python_block_end(&lines, start, indentation_width(lines[start]))
    } else {
        unit.range
            .end_line
            .saturating_add(1)
            .min(lines.len())
            .max(start + 1)
    };

    lines[start..end].join("\n")
}

/// Collects model names used through Django's `Model.objects` manager syntax.
fn objects_model_names(source_text: &str) -> BTreeSet<String> {
    let mut names = BTreeSet::new();

    for line in source_text.lines() {
        for name in objects_model_names_in_line(line) {
            names.insert(name);
        }
    }

    names
}

/// Collects simple constructor call identifiers such as `PostSerializer(`.
fn constructor_call_names(source_text: &str) -> BTreeSet<String> {
    let mut names = BTreeSet::new();

    for line in source_text.lines() {
        if line.trim_start().starts_with("class ") {
            continue;
        }
        for name in call_names_in_line(line) {
            names.insert(name);
        }
    }

    names
}

/// Finds `.objects` references outside simple strings and comments on one line.
fn objects_model_names_in_line(line: &str) -> BTreeSet<String> {
    let bytes = line.as_bytes();
    let mut names = BTreeSet::new();
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'#' => break,
            b'\'' | b'"' => index = skip_python_string(bytes, index),
            b'.' if has_objects_token(bytes, index) => {
                if let Some(name) = model_name_before_objects(line, index) {
                    names.insert(name);
                }
                index += ".objects".len();
            }
            _ => index += 1,
        }
    }

    names
}

/// Finds call identifiers outside simple strings and comments on one line.
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

/// Resolves by same parent app first, then by globally unique name.
fn resolve_unit_by_name<'a>(
    units_by_name: &BTreeMap<String, Vec<&'a FrameworkUnit>>,
    source: &FrameworkUnit,
    name: &str,
) -> Option<&'a FrameworkUnit> {
    let candidates = units_by_name.get(name)?;
    let same_parent = candidates
        .iter()
        .copied()
        .filter(|candidate| has_same_parent(source, candidate))
        .collect::<Vec<_>>();

    if same_parent.len() == 1 {
        return Some(same_parent[0]);
    }
    if candidates.len() == 1 {
        return Some(candidates[0]);
    }

    None
}

/// Returns whether two units share the same Django app parent identity.
fn has_same_parent(left: &FrameworkUnit, right: &FrameworkUnit) -> bool {
    match (left.parent_id.as_deref(), right.parent_id.as_deref()) {
        (Some(left_parent), Some(right_parent)) => left_parent == right_parent,
        _ => false,
    }
}

/// Returns source lines without trailing carriage returns.
fn source_lines(content: &str) -> Vec<&str> {
    content
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .collect()
}

/// Finds the first line after a Python block using indentation boundaries.
fn python_block_end(lines: &[&str], start: usize, base_indent: usize) -> usize {
    let mut index = start + 1;

    while index < lines.len() {
        let line = lines[index];
        let trimmed = line.trim_start();

        if !trimmed.is_empty() && !trimmed.starts_with('#') {
            let indent = indentation_width(line);
            if indent <= base_indent {
                break;
            }
        }

        index += 1;
    }

    index
}

/// Counts leading whitespace bytes, matching the existing Django unit parser.
fn indentation_width(line: &str) -> usize {
    line.len().saturating_sub(line.trim_start().len())
}

/// Returns whether a line declares the provided framework unit.
fn is_unit_declaration_line(line: &str, unit: &FrameworkUnit) -> bool {
    ["class", "async def", "def"]
        .iter()
        .any(|keyword| declaration_name(line, keyword).as_deref() == Some(unit.name.as_str()))
}

/// Reads a class name from a Python class declaration.
fn class_declaration_name(line: &str) -> Option<String> {
    declaration_name(line, "class")
}

/// Reads the declared name after a Python declaration keyword.
fn declaration_name(line: &str, keyword: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let remainder = trimmed.strip_prefix(keyword)?;

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

/// Returns whether a nested `class Meta:` belongs to the serializer class.
fn is_meta_class_line(line: &str, class_indent: usize) -> bool {
    indentation_width(line) > class_indent
        && class_declaration_name(line).as_deref() == Some("Meta")
}

/// Reads `model = Post` when it appears on the same line as `class Meta:`.
fn inline_meta_model_name(line: &str) -> Option<String> {
    let (_, body) = code_before_comment(line).split_once(':')?;
    model_assignment_name(body)
}

/// Reads a simple `model = Post` assignment inside a serializer Meta block.
fn model_assignment_name(line: &str) -> Option<String> {
    let code = code_before_comment(line).trim_start();
    let remainder = code.strip_prefix("model")?;

    if remainder
        .chars()
        .next()
        .map(|character| character == '_' || character.is_ascii_alphanumeric())
        .unwrap_or(false)
    {
        return None;
    }

    let value = remainder.trim_start().strip_prefix('=')?.trim_start();
    read_reference(value).and_then(|reference| {
        let name = reference.rsplit('.').next()?;
        is_identifier(name).then(|| name.to_string())
    })
}

/// Reads an ASCII Python identifier prefix.
fn read_identifier(value: &str) -> Option<&str> {
    let bytes = value.as_bytes();
    if bytes.is_empty() || !is_identifier_start(bytes[0]) {
        return None;
    }

    let mut end = 1usize;
    while end < bytes.len() && is_identifier_continue(bytes[end]) {
        end += 1;
    }

    Some(&value[..end])
}

/// Reads an ASCII dotted Python reference prefix.
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

/// Checks for an identifier token in a declaration header.
fn contains_identifier(line: &str, expected: &str) -> bool {
    let bytes = line.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        if is_identifier_start(bytes[index]) {
            let start = index;
            index += 1;
            while index < bytes.len() && is_identifier_continue(bytes[index]) {
                index += 1;
            }
            if &line[start..index] == expected {
                return true;
            }
        } else {
            index += 1;
        }
    }

    false
}

/// Returns one model identifier immediately before a `.objects` token.
fn model_name_before_objects(line: &str, objects_dot_index: usize) -> Option<String> {
    let bytes = line.as_bytes();
    let mut end = objects_dot_index;

    while end > 0 && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }

    let mut start = end;
    while start > 0 && (is_identifier_continue(bytes[start - 1]) || bytes[start - 1] == b'.') {
        start -= 1;
    }

    let reference = line[start..end].trim_matches('.');
    let name = reference.rsplit('.').next()?;
    if is_identifier(name) {
        Some(name.to_string())
    } else {
        None
    }
}

/// Returns true for a `.objects` token with identifier boundaries.
fn has_objects_token(bytes: &[u8], dot_index: usize) -> bool {
    let token = b".objects";
    if bytes.len().saturating_sub(dot_index) < token.len() {
        return false;
    }
    if &bytes[dot_index..dot_index + token.len()] != token {
        return false;
    }

    let next = dot_index + token.len();
    next >= bytes.len() || !is_identifier_continue(bytes[next])
}

/// Skips a simple single-line Python string literal.
fn skip_python_string(bytes: &[u8], quote_index: usize) -> usize {
    let quote = bytes[quote_index];
    let mut index = quote_index + 1;
    let mut escaped = false;

    while index < bytes.len() {
        if escaped {
            escaped = false;
        } else if bytes[index] == b'\\' {
            escaped = true;
        } else if bytes[index] == quote {
            return index + 1;
        }

        index += 1;
    }

    bytes.len()
}

/// Returns code before an outside-string `#` comment marker.
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

/// Checks an exact Python identifier string.
fn is_identifier(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || !is_identifier_start(bytes[0]) {
        return false;
    }

    bytes[1..].iter().all(|byte| is_identifier_continue(*byte))
}

/// Returns whether a byte can start a conservative Python identifier.
fn is_identifier_start(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphabetic()
}

/// Returns whether a byte can continue a conservative Python identifier.
fn is_identifier_continue(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphanumeric()
}

/// Checks a cross-platform file name suffix without normalizing the whole path.
fn has_file_name(file_path: &str, expected: &str) -> bool {
    file_path
        .rsplit(['/', '\\'])
        .next()
        .map(|name| name == expected)
        .unwrap_or(false)
}
