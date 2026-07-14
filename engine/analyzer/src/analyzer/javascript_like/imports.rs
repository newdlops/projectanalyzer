//! Fast file-to-file import edge extraction for JavaScript-like sources.
//!
//! This pass resolves project-local relative imports after workspace scanning so
//! the file graph can start from import roots instead of directory structure.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::graph::{NewExternalDependencyEdge, NewFileDependencyEdge, ProjectGraphBuilder};
use crate::model::{utf16_column_from_byte_offset, SourceInput, SourceRange};

const RESOLVABLE_EXTENSIONS: [&str; 4] = ["ts", "tsx", "js", "jsx"];

/// Reusable workspace-local module resolver shared by dependency and call passes.
///
/// The resolver owns normalized file and path-alias indexes so later semantic
/// passes use exactly the same relative/alias rules without rebuilding them for
/// every import binding.
pub(in crate::analyzer) struct WorkspaceModuleResolver {
    file_by_path: BTreeMap<PathBuf, PathBuf>,
    alias_rules_by_config: BTreeMap<PathBuf, Vec<PathAliasRule>>,
    config_path_by_dir: BTreeMap<PathBuf, Option<PathBuf>>,
}

impl WorkspaceModuleResolver {
    /// Builds resolver indexes for one immutable workspace source snapshot.
    pub(in crate::analyzer) fn new(files: &[SourceInput]) -> Self {
        Self {
            file_by_path: create_file_map(files),
            alias_rules_by_config: create_alias_rule_map(files),
            config_path_by_dir: BTreeMap::new(),
        }
    }

    /// Resolves one module specifier using relative paths or nearest config aliases.
    pub(in crate::analyzer) fn resolve(
        &mut self,
        source_path: &Path,
        module_specifier: &str,
    ) -> Option<PathBuf> {
        let alias_rules = find_alias_rules_for_file(
            source_path,
            &self.alias_rules_by_config,
            &mut self.config_path_by_dir,
        );

        resolve_module(
            source_path,
            module_specifier,
            &self.file_by_path,
            alias_rules,
        )
    }
}

/// Adds resolved import/export edges for all JavaScript-like project files.
pub fn add_import_edges(builder: &mut ProjectGraphBuilder, files: &[SourceInput]) {
    let mut resolver = WorkspaceModuleResolver::new(files);

    for file in files {
        if !is_javascript_like(file) {
            continue;
        }

        for candidate in collect_import_candidates(file) {
            let Some(target_path) = resolver.resolve(&file.path, &candidate.module_specifier)
            else {
                let is_relative_or_absolute = matches!(
                    candidate.module_specifier.as_bytes().first(),
                    Some(b'.' | b'/')
                );

                if !is_relative_or_absolute {
                    builder.add_external_dependency_edge(NewExternalDependencyEdge {
                        kind: candidate.kind,
                        source_path: file.path.clone(),
                        module_specifier: candidate.module_specifier,
                        range: candidate.range,
                        language: file.language_id.clone(),
                    });
                }
                continue;
            };

            if target_path == file.path {
                continue;
            }

            builder.add_file_dependency_edge(NewFileDependencyEdge {
                kind: candidate.kind,
                source_path: file.path.clone(),
                target_path,
                range: candidate.range,
            });
        }
    }
}

/// Import/export candidate before module resolution.
struct ImportCandidate {
    kind: String,
    module_specifier: String,
    range: SourceRange,
}

/// One tsconfig/jsconfig path alias rule scoped to the config directory.
#[derive(Clone)]
struct PathAliasRule {
    base_dir: PathBuf,
    pattern_prefix: String,
    pattern_suffix: String,
    targets: Vec<String>,
}

/// Creates a normalized path lookup for workspace source files.
fn create_file_map(files: &[SourceInput]) -> BTreeMap<PathBuf, PathBuf> {
    files
        .iter()
        .map(|file| (normalize_path(&file.path), file.path.clone()))
        .collect()
}

/// Returns whether a file can contain JavaScript-like import syntax.
fn is_javascript_like(file: &SourceInput) -> bool {
    matches!(file.language_id.as_str(), "typescript" | "javascript")
}

/// Collects single-line import/export declarations from one source file.
fn collect_import_candidates(file: &SourceInput) -> Vec<ImportCandidate> {
    let mut candidates = Vec::new();

    for (line_index, line) in file.content.lines().enumerate() {
        let trimmed = line.trim_start();
        let line_offset = line.len().saturating_sub(trimmed.len());

        if trimmed.starts_with("import ") {
            if let Some(candidate) =
                read_import_candidate(line_index, line, line_offset, trimmed, "imports")
            {
                candidates.push(candidate);
            }
            continue;
        }

        if trimmed.starts_with("export ") {
            if let Some(candidate) =
                read_from_candidate(line_index, line, line_offset, trimmed, "exports")
            {
                candidates.push(candidate);
            }
        }
    }

    candidates
}

/// Reads either `import ... from "x"` or side-effect `import "x"` syntax.
fn read_import_candidate(
    line_index: usize,
    source_line: &str,
    line_offset: usize,
    trimmed: &str,
    kind: &str,
) -> Option<ImportCandidate> {
    read_from_candidate(line_index, source_line, line_offset, trimmed, kind).or_else(|| {
        let remainder = trimmed.strip_prefix("import")?.trim_start();
        read_quoted_specifier(
            line_index,
            source_line,
            line_offset + trimmed.find(remainder)?,
            remainder,
            kind,
        )
    })
}

/// Reads `... from "x"` syntax.
fn read_from_candidate(
    line_index: usize,
    source_line: &str,
    line_offset: usize,
    trimmed: &str,
    kind: &str,
) -> Option<ImportCandidate> {
    let from_index = trimmed.find(" from ")?;
    let remainder_start = from_index + " from ".len();
    read_quoted_specifier(
        line_index,
        source_line,
        line_offset + remainder_start,
        &trimmed[remainder_start..],
        kind,
    )
}

/// Reads a string literal module specifier and returns its source span.
fn read_quoted_specifier(
    line_index: usize,
    source_line: &str,
    offset: usize,
    text: &str,
    kind: &str,
) -> Option<ImportCandidate> {
    let quote_index = text.find(['\'', '"'])?;
    let quote = text.as_bytes()[quote_index] as char;
    let specifier_start = quote_index + 1;
    let specifier_end = text[specifier_start..].find(quote)? + specifier_start;
    let module_specifier = text[specifier_start..specifier_end].to_string();

    Some(ImportCandidate {
        kind: kind.to_string(),
        module_specifier,
        range: SourceRange {
            start_line: line_index,
            start_character: utf16_column_from_byte_offset(source_line, offset + specifier_start),
            end_line: line_index,
            end_character: utf16_column_from_byte_offset(source_line, offset + specifier_end),
        },
    })
}

/// Resolves a module specifier against relative paths or tsconfig/jsconfig aliases.
fn resolve_module(
    source_path: &Path,
    module_specifier: &str,
    file_by_path: &BTreeMap<PathBuf, PathBuf>,
    alias_rules: &[PathAliasRule],
) -> Option<PathBuf> {
    if module_specifier.starts_with('.') {
        return resolve_relative_module(source_path, module_specifier, file_by_path);
    }

    resolve_alias_module(module_specifier, file_by_path, alias_rules)
}

/// Resolves a relative module specifier against known workspace files.
fn resolve_relative_module(
    source_path: &Path,
    module_specifier: &str,
    file_by_path: &BTreeMap<PathBuf, PathBuf>,
) -> Option<PathBuf> {
    let base_path = normalize_path(&source_path.parent()?.join(module_specifier));

    for candidate in create_resolution_candidates(&base_path) {
        if let Some(file_path) = file_by_path.get(&candidate) {
            return Some(file_path.clone());
        }
    }

    None
}

/// Resolves a non-relative project alias import using parsed path rules.
fn resolve_alias_module(
    module_specifier: &str,
    file_by_path: &BTreeMap<PathBuf, PathBuf>,
    alias_rules: &[PathAliasRule],
) -> Option<PathBuf> {
    for rule in alias_rules {
        let Some(captured) =
            match_alias_pattern(module_specifier, &rule.pattern_prefix, &rule.pattern_suffix)
        else {
            continue;
        };

        for target in &rule.targets {
            let rewritten = if target.contains('*') {
                target.replacen('*', captured, 1)
            } else {
                target.clone()
            };
            let target_path = PathBuf::from(&rewritten);
            let base_path = if target_path.is_absolute() {
                normalize_path(&target_path)
            } else {
                normalize_path(&rule.base_dir.join(target_path))
            };

            for candidate in create_resolution_candidates(&base_path) {
                if let Some(file_path) = file_by_path.get(&candidate) {
                    return Some(file_path.clone());
                }
            }
        }
    }

    None
}

/// Creates common TS/JS path candidates without touching the file system.
fn create_resolution_candidates(base_path: &Path) -> Vec<PathBuf> {
    if base_path.extension().is_some() {
        return vec![base_path.to_path_buf()];
    }

    let mut candidates = Vec::new();

    for extension in RESOLVABLE_EXTENSIONS {
        candidates.push(base_path.with_extension(extension));
    }

    for extension in RESOLVABLE_EXTENSIONS {
        candidates.push(base_path.join(format!("index.{extension}")));
    }

    candidates
}

/// Loads nearest tsconfig/jsconfig path aliases for files in the scan.
fn create_alias_rule_map(files: &[SourceInput]) -> BTreeMap<PathBuf, Vec<PathAliasRule>> {
    let mut config_paths = BTreeSet::new();
    let mut config_path_by_dir = BTreeMap::new();

    for file in files {
        if !is_javascript_like(file) {
            continue;
        }

        if let Some(config_path) = find_nearest_config_path(&file.path, &mut config_path_by_dir) {
            config_paths.insert(config_path);
        }
    }

    config_paths
        .into_iter()
        .map(|config_path| {
            let rules = parse_alias_rules(&config_path);
            (config_path, rules)
        })
        .collect()
}

/// Returns path alias rules for the nearest config file that applies to a source.
fn find_alias_rules_for_file<'a>(
    source_path: &Path,
    alias_rules_by_config: &'a BTreeMap<PathBuf, Vec<PathAliasRule>>,
    config_path_by_dir: &mut BTreeMap<PathBuf, Option<PathBuf>>,
) -> &'a [PathAliasRule] {
    let Some(config_path) = find_nearest_config_path(source_path, config_path_by_dir) else {
        return &[];
    };

    alias_rules_by_config
        .get(&config_path)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

/// Finds the closest tsconfig/jsconfig above a source file and caches directory lookups.
fn find_nearest_config_path(
    source_path: &Path,
    config_path_by_dir: &mut BTreeMap<PathBuf, Option<PathBuf>>,
) -> Option<PathBuf> {
    let source_dir = normalize_path(source_path.parent()?);

    if let Some(cached) = config_path_by_dir.get(&source_dir) {
        return cached.clone();
    }

    let mut current = Some(source_dir.as_path());

    while let Some(directory) = current {
        for config_name in ["tsconfig.json", "jsconfig.json"] {
            let candidate = directory.join(config_name);

            if candidate.is_file() {
                let normalized = normalize_path(&candidate);
                config_path_by_dir.insert(source_dir, Some(normalized.clone()));
                return Some(normalized);
            }
        }

        current = directory.parent();
    }

    config_path_by_dir.insert(source_dir, None);
    None
}

/// Parses simple compilerOptions.paths rules from a commented JSON config file.
fn parse_alias_rules(config_path: &Path) -> Vec<PathAliasRule> {
    let Ok(raw_config) = fs::read_to_string(config_path) else {
        return Vec::new();
    };
    let config_dir = normalize_path(config_path.parent().unwrap_or_else(|| Path::new(".")));
    let config_text = strip_json_comments(&raw_config);
    let base_dir = parse_string_property(&config_text, "baseUrl")
        .map(|base_url| normalize_path(&config_dir.join(base_url)))
        .unwrap_or_else(|| config_dir.clone());
    let Some(paths_object) = extract_object_property(&config_text, "paths") else {
        return Vec::new();
    };

    parse_paths_entries(&paths_object)
        .into_iter()
        .map(|(pattern, targets)| {
            let (pattern_prefix, pattern_suffix) = split_alias_pattern(&pattern);

            PathAliasRule {
                base_dir: base_dir.clone(),
                pattern_prefix,
                pattern_suffix,
                targets,
            }
        })
        .collect()
}

/// Removes JavaScript-style comments while preserving quoted strings.
fn strip_json_comments(text: &str) -> String {
    let mut stripped = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    while let Some(character) = chars.next() {
        if in_line_comment {
            if character == '\n' {
                in_line_comment = false;
                stripped.push(character);
            }
            continue;
        }

        if in_block_comment {
            if character == '*' && chars.peek() == Some(&'/') {
                chars.next();
                in_block_comment = false;
            }
            continue;
        }

        if in_string {
            stripped.push(character);

            if escaped {
                escaped = false;
                continue;
            }

            if character == '\\' {
                escaped = true;
                continue;
            }

            if character == '"' {
                in_string = false;
            }

            continue;
        }

        if character == '"' {
            in_string = true;
            stripped.push(character);
            continue;
        }

        if character == '/' && chars.peek() == Some(&'/') {
            chars.next();
            in_line_comment = true;
            continue;
        }

        if character == '/' && chars.peek() == Some(&'*') {
            chars.next();
            in_block_comment = true;
            continue;
        }

        stripped.push(character);
    }

    stripped
}

/// Parses a string property from a JSON-like object.
fn parse_string_property(text: &str, property_name: &str) -> Option<String> {
    let colon_index = find_property_colon(text, property_name)?;
    let value_start = skip_whitespace(text, colon_index + 1);
    parse_json_string(text, value_start).map(|(value, _)| value)
}

/// Extracts an object property body including nested braces.
fn extract_object_property(text: &str, property_name: &str) -> Option<String> {
    let colon_index = find_property_colon(text, property_name)?;
    let object_start = text[colon_index + 1..].find('{')? + colon_index + 1;
    let object_end = find_matching_brace(text, object_start)?;

    Some(text[object_start + 1..object_end].to_string())
}

/// Parses path mapping entries of the form "alias/*": ["target/*"].
fn parse_paths_entries(paths_object: &str) -> Vec<(String, Vec<String>)> {
    let mut entries = Vec::new();
    let mut index = 0;

    while index < paths_object.len() {
        index = skip_entry_separator(paths_object, index);

        let Some((pattern, after_pattern)) = parse_json_string(paths_object, index) else {
            break;
        };
        let colon_index = paths_object[after_pattern..]
            .find(':')
            .map(|offset| offset + after_pattern);
        let Some(colon_index) = colon_index else {
            break;
        };
        let array_start = paths_object[colon_index + 1..]
            .find('[')
            .map(|offset| offset + colon_index + 1);
        let Some(array_start) = array_start else {
            break;
        };
        let array_end = paths_object[array_start + 1..]
            .find(']')
            .map(|offset| offset + array_start + 1);
        let Some(array_end) = array_end else {
            break;
        };
        let targets = parse_string_array(&paths_object[array_start + 1..array_end]);

        entries.push((pattern, targets));
        index = array_end + 1;
    }

    entries
}

/// Parses every string literal inside an array body.
fn parse_string_array(array_body: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut index = 0;

    while index < array_body.len() {
        index = skip_entry_separator(array_body, index);

        if let Some((value, next_index)) = parse_json_string(array_body, index) {
            values.push(value);
            index = next_index;
            continue;
        }

        index += 1;
    }

    values
}

/// Finds a top-level property colon.
fn find_property_colon(text: &str, property_name: &str) -> Option<usize> {
    let needle = format!("\"{property_name}\"");
    let property_index = text.find(&needle)?;

    text[property_index + needle.len()..]
        .find(':')
        .map(|offset| offset + property_index + needle.len())
}

/// Finds the closing brace for an object start.
fn find_matching_brace(text: &str, object_start: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (index, character) in text[object_start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }

            if character == '\\' {
                escaped = true;
                continue;
            }

            if character == '"' {
                in_string = false;
            }

            continue;
        }

        if character == '"' {
            in_string = true;
            continue;
        }

        if character == '{' {
            depth += 1;
            continue;
        }

        if character == '}' {
            depth = depth.saturating_sub(1);

            if depth == 0 {
                return Some(object_start + index);
            }
        }
    }

    None
}

/// Parses a basic JSON string and returns the value plus the next byte index.
fn parse_json_string(text: &str, start_index: usize) -> Option<(String, usize)> {
    let mut chars = text[start_index..].char_indices();
    let (_, quote) = chars.next()?;

    if quote != '"' {
        return None;
    }

    let mut value = String::new();
    let mut escaped = false;

    for (offset, character) in chars {
        if escaped {
            value.push(character);
            escaped = false;
            continue;
        }

        if character == '\\' {
            escaped = true;
            continue;
        }

        if character == '"' {
            return Some((value, start_index + offset + character.len_utf8()));
        }

        value.push(character);
    }

    None
}

/// Skips whitespace and commas between entries.
fn skip_entry_separator(text: &str, mut index: usize) -> usize {
    while index < text.len() {
        let character = text[index..].chars().next().unwrap_or_default();

        if !character.is_whitespace() && character != ',' {
            break;
        }

        index += character.len_utf8();
    }

    index
}

/// Skips whitespace from one byte index.
fn skip_whitespace(text: &str, mut index: usize) -> usize {
    while index < text.len() {
        let character = text[index..].chars().next().unwrap_or_default();

        if !character.is_whitespace() {
            break;
        }

        index += character.len_utf8();
    }

    index
}

/// Splits an alias pattern around the first wildcard.
fn split_alias_pattern(pattern: &str) -> (String, String) {
    if let Some(wildcard_index) = pattern.find('*') {
        return (
            pattern[..wildcard_index].to_string(),
            pattern[wildcard_index + 1..].to_string(),
        );
    }

    (pattern.to_string(), String::new())
}

/// Returns the text captured by an alias wildcard if a specifier matches.
fn match_alias_pattern<'a>(
    module_specifier: &'a str,
    pattern_prefix: &str,
    pattern_suffix: &str,
) -> Option<&'a str> {
    if !module_specifier.starts_with(pattern_prefix) || !module_specifier.ends_with(pattern_suffix)
    {
        return None;
    }

    let start = pattern_prefix.len();
    let end = module_specifier.len().saturating_sub(pattern_suffix.len());

    if start > end {
        return None;
    }

    Some(&module_specifier[start..end])
}

/// Normalizes lexical `.` and `..` components without requiring paths to exist.
fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

#[cfg(test)]
#[path = "imports_tests.rs"]
mod tests;
