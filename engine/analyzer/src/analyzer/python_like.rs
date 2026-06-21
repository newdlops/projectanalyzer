//! Lightweight Python symbol extraction.
//!
//! This analyzer uses indentation and line prefixes to produce fast class and
//! function nodes without importing a Python parser.

mod calls;

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

use crate::graph::{
    NewExternalDependencyEdge, NewFileDependencyEdge, NewSymbol, ProjectGraphBuilder,
};
use crate::model::{SourceInput, SourceRange};

use self::calls::{
    add_call_edges, collect_python_calls, current_call_source, declaration_call_scan_start,
    CallCandidate,
};

/// Indentation-based Python scope entry.
struct ScopeEntry {
    id: String,
    name: String,
    kind: String,
    indent: usize,
    scope_names: Vec<String>,
}

/// Python symbol metadata used by call analysis for same-file resolution.
struct SymbolRecord {
    id: String,
    name: String,
    kind: String,
    qualified_name: String,
}

/// Python import candidate resolved after all workspace files are known.
struct ImportCandidate {
    display_module: String,
    resolution_modules: Vec<String>,
    range: SourceRange,
    external_candidate: bool,
}

/// Extracts Python class and function symbols.
pub fn extract_symbols(
    builder: &mut ProjectGraphBuilder,
    file: &SourceInput,
    file_id: String,
) -> Result<(), String> {
    let mut scopes: Vec<ScopeEntry> = Vec::new();
    let mut symbols: Vec<SymbolRecord> = Vec::new();
    let mut calls: Vec<CallCandidate> = Vec::new();

    for (line_index, line) in file.content.lines().enumerate() {
        let code_line = strip_python_comment(line);
        let trimmed = code_line.trim_start();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let indent = line.len().saturating_sub(trimmed.len());
        close_finished_scopes(&mut scopes, indent);

        if let Some((kind, name)) = detect_declaration(trimmed) {
            let parent_id = scopes
                .last()
                .map(|scope| scope.id.clone())
                .unwrap_or_else(|| file_id.clone());
            let mut scope_names: Vec<String> =
                scopes.iter().map(|scope| scope.name.clone()).collect();
            scope_names.push(name.clone());
            let range = line_range(line_index, indent, line);
            let id = builder.add_symbol(NewSymbol {
                kind: kind.clone(),
                name: name.clone(),
                scope_names: scope_names.clone(),
                file_path: file.path.clone(),
                range: range.clone(),
                selection_range: name_range(line_index, line, &name),
                language: file.language_id.clone(),
                parent_id,
            });

            symbols.push(SymbolRecord {
                id: id.clone(),
                name: name.clone(),
                kind: kind.clone(),
                qualified_name: scope_names.join("."),
            });

            if kind == "function" {
                let call_scan_start = declaration_call_scan_start(code_line);
                if call_scan_start < code_line.len() {
                    collect_python_calls(
                        &mut calls,
                        line_index,
                        code_line,
                        call_scan_start,
                        &id,
                        &scope_names,
                    );
                }
            }

            if kind == "class" || kind == "function" {
                scopes.push(ScopeEntry {
                    id,
                    name,
                    kind,
                    indent,
                    scope_names,
                });
            }
            continue;
        }

        if let Some(source) = current_call_source(&scopes) {
            collect_python_calls(
                &mut calls,
                line_index,
                code_line,
                0,
                &source.id,
                &source.scope_names,
            );
        }
    }

    add_call_edges(builder, file, &symbols, calls);
    Ok(())
}

/// Adds file-to-file and external module import edges for Python sources.
pub fn add_import_edges(builder: &mut ProjectGraphBuilder, files: &[SourceInput]) {
    let module_paths = create_module_path_map(files);

    for file in files {
        if file.language_id != "python" {
            continue;
        }

        let source_module = module_name_for_path(&file.path);

        for candidate in collect_import_candidates(file, source_module.as_deref()) {
            if let Some(target_path) =
                resolve_python_module(&candidate.resolution_modules, &module_paths)
            {
                if target_path != file.path {
                    builder.add_file_dependency_edge(NewFileDependencyEdge {
                        kind: "imports".to_string(),
                        source_path: file.path.clone(),
                        target_path,
                        range: candidate.range,
                    });
                }
                continue;
            }

            if candidate.external_candidate {
                builder.add_external_dependency_edge(NewExternalDependencyEdge {
                    kind: "imports".to_string(),
                    source_path: file.path.clone(),
                    module_specifier: candidate.display_module,
                    range: candidate.range,
                    language: file.language_id.clone(),
                });
            }
        }
    }
}

/// Removes scopes when indentation returns to the same or lower level.
fn close_finished_scopes(scopes: &mut Vec<ScopeEntry>, indent: usize) {
    while scopes
        .last()
        .map(|scope| indent <= scope.indent)
        .unwrap_or(false)
    {
        scopes.pop();
    }
}

/// Creates importable Python module names for all workspace `.py` files.
fn create_module_path_map(files: &[SourceInput]) -> BTreeMap<String, PathBuf> {
    let mut module_paths = BTreeMap::new();

    for file in files {
        if file.language_id != "python" {
            continue;
        }

        if let Some(module_name) = module_name_for_path(&file.path) {
            for alias in module_name_suffixes(&module_name) {
                module_paths
                    .entry(alias)
                    .or_insert_with(|| file.path.clone());
            }
        }
    }

    module_paths
}

/// Converts a Python file path to a dotted module name.
fn module_name_for_path(path: &Path) -> Option<String> {
    let path_without_extension = path.with_extension("");
    let mut parts: Vec<String> = path_without_extension
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .filter(|part| !part.is_empty())
        .map(|part| part.to_string())
        .collect();

    if parts.last().map(|part| part == "__init__").unwrap_or(false) {
        parts.pop();
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("."))
    }
}

/// Returns every importable suffix for a module path.
fn module_name_suffixes(module_name: &str) -> Vec<String> {
    let parts: Vec<&str> = module_name.split('.').collect();

    (0..parts.len())
        .map(|index| parts[index..].join("."))
        .collect()
}

/// Extracts import declarations from a Python source file.
fn collect_import_candidates(
    file: &SourceInput,
    source_module: Option<&str>,
) -> Vec<ImportCandidate> {
    let mut candidates = Vec::new();

    for (line_index, line) in file.content.lines().enumerate() {
        let trimmed = line.trim_start();

        if trimmed.starts_with("import ") {
            candidates.extend(read_import_line(line_index, line, trimmed));
            continue;
        }

        if trimmed.starts_with("from ") {
            if let Some(candidate) = read_from_import_line(line_index, line, trimmed, source_module)
            {
                candidates.push(candidate);
            }
        }
    }

    candidates
}

/// Reads `import a, b as c` statements.
fn read_import_line(line_index: usize, line: &str, trimmed: &str) -> Vec<ImportCandidate> {
    let range = line_range(line_index, line.len().saturating_sub(trimmed.len()), line);

    trimmed
        .strip_prefix("import ")
        .unwrap_or_default()
        .split(',')
        .filter_map(|part| read_imported_module_name(part))
        .map(|module_name| ImportCandidate {
            display_module: module_name.clone(),
            resolution_modules: vec![module_name],
            range: range.clone(),
            external_candidate: true,
        })
        .collect()
}

/// Reads `from a.b import c` and relative `from . import c` statements.
fn read_from_import_line(
    line_index: usize,
    line: &str,
    trimmed: &str,
    source_module: Option<&str>,
) -> Option<ImportCandidate> {
    let remainder = trimmed.strip_prefix("from ")?;
    let import_index = remainder.find(" import ")?;
    let module_part = remainder[..import_index].trim();
    let imported_part = remainder[import_index + " import ".len()..].trim();
    let range = line_range(line_index, line.len().saturating_sub(trimmed.len()), line);

    if module_part.starts_with('.') {
        let modules = resolve_relative_import_modules(source_module?, module_part, imported_part);

        return Some(ImportCandidate {
            display_module: module_part.to_string(),
            resolution_modules: modules,
            range,
            external_candidate: false,
        });
    }

    let mut modules: Vec<String> = read_imported_names(imported_part)
        .map(|name| format!("{module_part}.{name}"))
        .collect();
    modules.push(module_part.to_string());

    Some(ImportCandidate {
        display_module: module_part.to_string(),
        resolution_modules: modules,
        range,
        external_candidate: true,
    })
}

/// Resolves candidate modules to a project file path.
fn resolve_python_module(
    resolution_modules: &[String],
    module_paths: &BTreeMap<String, PathBuf>,
) -> Option<PathBuf> {
    resolution_modules
        .iter()
        .find_map(|module_name| module_paths.get(module_name).cloned())
}

/// Creates absolute candidate module names for Python relative imports.
fn resolve_relative_import_modules(
    source_module: &str,
    module_part: &str,
    imported_part: &str,
) -> Vec<String> {
    let dot_count = module_part
        .chars()
        .take_while(|character| *character == '.')
        .count();
    let suffix = module_part[dot_count..].trim_matches('.');
    let mut package_parts: Vec<&str> = source_module.split('.').collect();
    package_parts.pop();

    for _ in 1..dot_count {
        package_parts.pop();
    }

    let mut base = package_parts.join(".");

    if !suffix.is_empty() {
        if !base.is_empty() {
            base.push('.');
        }
        base.push_str(suffix);
    }

    let mut modules: Vec<String> = read_imported_names(imported_part)
        .map(|name| {
            if base.is_empty() {
                name
            } else {
                format!("{base}.{name}")
            }
        })
        .collect();

    if !base.is_empty() {
        modules.push(base);
    }

    modules
}

/// Reads a module name before an optional alias.
fn read_imported_module_name(part: &str) -> Option<String> {
    let module_name = part.trim().split_whitespace().next()?;

    if module_name.is_empty() {
        None
    } else {
        Some(module_name.to_string())
    }
}

/// Reads imported names that may refer to child modules.
fn read_imported_names(imported_part: &str) -> impl Iterator<Item = String> + '_ {
    imported_part
        .split(',')
        .filter_map(read_imported_module_name)
        .filter(|name| name != "*")
}

/// Removes trailing Python comments while preserving `#` inside simple strings.
fn strip_python_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut index = 0usize;
    let mut quote: Option<u8> = None;

    while index < bytes.len() {
        match (bytes[index], quote) {
            (b'\\', Some(_)) => index += 2,
            (b'\'' | b'"', None) => {
                quote = Some(bytes[index]);
                index += 1;
            }
            (character, Some(active_quote)) if character == active_quote => {
                quote = None;
                index += 1;
            }
            (b'#', None) => return &line[..index],
            _ => index += 1,
        }
    }

    line
}

/// Detects a Python declaration line.
fn detect_declaration(trimmed: &str) -> Option<(String, String)> {
    if let Some(name) = read_name_after_keyword(trimmed, "class") {
        return Some(("class".to_string(), name));
    }

    if let Some(name) = read_name_after_keyword(trimmed, "def") {
        return Some(("function".to_string(), name));
    }

    None
}

/// Reads a Python identifier after class or def.
fn read_name_after_keyword(line: &str, keyword: &str) -> Option<String> {
    let remainder = line.strip_prefix(keyword)?.trim_start();
    let end = remainder
        .find(|character: char| !(character == '_' || character.is_ascii_alphanumeric()))
        .unwrap_or(remainder.len());

    if end == 0 {
        None
    } else {
        Some(remainder[..end].to_string())
    }
}

/// Returns the full declaration line range.
fn line_range(line_index: usize, start_character: usize, line: &str) -> SourceRange {
    SourceRange {
        start_line: line_index,
        start_character,
        end_line: line_index,
        end_character: line.chars().count(),
    }
}

/// Returns the best-effort name selection range.
fn name_range(line_index: usize, line: &str, name: &str) -> SourceRange {
    let start_character = line.find(name).unwrap_or_default();

    SourceRange {
        start_line: line_index,
        start_character,
        end_line: line_index,
        end_character: start_character + name.chars().count(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::ProjectGraphBuilder;
    use std::path::PathBuf;

    #[test]
    fn extracts_python_class_and_function() {
        let file = SourceInput {
            path: PathBuf::from("/workspace/app.py"),
            language_id: "python".to_string(),
            content:
                "class Service:\n    def run(self):\n        pass\n\ndef helper():\n    pass\n"
                    .to_string(),
            size_bytes: 68,
        };
        let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));
        let file_id = builder.add_file(&file);

        extract_symbols(&mut builder, &file, file_id).expect("extracts symbols");
        let graph = builder.finish();

        assert!(graph.nodes.iter().any(|node| node.name == "Service"));
        assert!(graph.nodes.iter().any(|node| node.name == "run"));
        assert!(graph.nodes.iter().any(|node| node.name == "helper"));
    }

    #[test]
    fn extracts_python_function_call_edges() {
        let file = SourceInput {
            path: PathBuf::from("/workspace/app.py"),
            language_id: "python".to_string(),
            content: "class Service:\n    def run(self):\n        return self.load()\n    def load(self):\n        return helper()\n\ndef helper():\n    return format_value()\n\ndef format_value():\n    return \"value\"\n"
                .to_string(),
            size_bytes: 174,
        };
        let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));
        let file_id = builder.add_file(&file);

        extract_symbols(&mut builder, &file, file_id).expect("extracts symbols and calls");
        let graph = builder.finish();
        let run_id = node_id(&graph, "run");
        let load_id = node_id(&graph, "load");
        let helper_id = node_id(&graph, "helper");
        let format_id = node_id(&graph, "format_value");

        assert_call_edge(&graph, &run_id, &load_id);
        assert_call_edge(&graph, &load_id, &helper_id);
        assert_call_edge(&graph, &helper_id, &format_id);
    }

    #[test]
    fn adds_python_import_edges_between_files() {
        let files = vec![
            source(
                "/workspace/app/main.py",
                "from app.service import run\nfrom . import util\n",
            ),
            source("/workspace/app/service.py", "def run():\n    pass\n"),
            source("/workspace/app/util.py", "VALUE = 1\n"),
        ];
        let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));

        for file in &files {
            builder.add_file(file);
        }

        add_import_edges(&mut builder, &files);
        let graph = builder.finish();

        assert!(graph.edges.iter().any(|edge| {
            edge.kind == "imports"
                && edge.source_id.ends_with("/workspace/app/main.py")
                && edge.target_id.ends_with("/workspace/app/service.py")
        }));
        assert!(graph.edges.iter().any(|edge| {
            edge.kind == "imports"
                && edge.source_id.ends_with("/workspace/app/main.py")
                && edge.target_id.ends_with("/workspace/app/util.py")
        }));
    }

    #[test]
    fn adds_external_python_import_leaves() {
        let files = vec![source(
            "/workspace/app/main.py",
            "import os\nfrom django.conf import settings\n",
        )];
        let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));

        for file in &files {
            builder.add_file(file);
        }

        add_import_edges(&mut builder, &files);
        let graph = builder.finish();

        assert!(graph
            .nodes
            .iter()
            .any(|node| node.kind == "external" && node.name == "os"));
        assert!(graph
            .nodes
            .iter()
            .any(|node| node.kind == "external" && node.name == "django.conf"));
        assert_eq!(
            graph
                .edges
                .iter()
                .filter(|edge| edge.kind == "imports" && edge.confidence == "unresolved")
                .count(),
            2
        );
    }

    fn source(path: &str, content: &str) -> SourceInput {
        SourceInput {
            path: PathBuf::from(path),
            language_id: "python".to_string(),
            content: content.to_string(),
            size_bytes: content.len(),
        }
    }

    fn node_id(graph: &crate::model::ProjectGraph, name: &str) -> String {
        graph
            .nodes
            .iter()
            .find(|node| node.name == name)
            .map(|node| node.id.clone())
            .unwrap_or_else(|| panic!("missing node named {name}"))
    }

    fn assert_call_edge(graph: &crate::model::ProjectGraph, source_id: &str, target_id: &str) {
        assert!(
            graph.edges.iter().any(|edge| {
                edge.kind == "calls" && edge.source_id == source_id && edge.target_id == target_id
            }),
            "missing calls edge from {source_id} to {target_id}"
        );
    }
}
