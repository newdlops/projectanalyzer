//! Lightweight Python symbol extraction.
//!
//! This analyzer uses indentation and line prefixes to produce fast class and
//! function nodes without importing a Python parser.

mod bindings;
#[cfg(test)]
mod bindings_integration_tests;
mod calls;
mod declarations;
#[cfg(test)]
mod range_tests;
pub(in crate::analyzer) mod syntax;

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

use crate::graph::{
    NewExternalDependencyEdge, NewFileDependencyEdge, NewSymbol, ProjectGraphBuilder,
};
use crate::model::{utf16_code_unit_len, utf16_column_from_byte_offset, SourceInput, SourceRange};

use self::bindings::LexicalBindings;
use self::calls::{
    add_call_edges, collect_python_calls, current_call_source, declaration_call_scan_start,
    CallCandidate,
};
use self::declarations::detect_declaration;
use self::syntax::{PythonSyntaxSnapshot, PythonSyntaxSnapshots};

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

/// Reusable Python module resolver shared by import and imported-call passes.
pub(super) struct WorkspaceModuleResolver {
    module_paths: BTreeMap<String, PathBuf>,
    /// All paths per suffix preserve ambiguity that legacy import edges collapse.
    module_candidates: BTreeMap<String, Vec<PathBuf>>,
}

impl WorkspaceModuleResolver {
    /// Indexes all importable suffixes from the analyzed Python source snapshot.
    pub(super) fn new(files: &[SourceInput]) -> Self {
        Self {
            module_paths: create_module_path_map(files),
            module_candidates: create_module_candidate_map(files),
        }
    }

    /// Resolves one previously parsed dependency candidate.
    fn resolve_candidate(&self, candidate: &ImportCandidate) -> Option<PathBuf> {
        resolve_python_module(&candidate.resolution_modules, &self.module_paths)
    }

    /// Resolves the target file for a supported `from module import name` binding.
    pub(super) fn resolve_named_import(
        &self,
        source_path: &Path,
        module_part: &str,
        imported_name: &str,
    ) -> Option<PathBuf> {
        let resolution_modules = if module_part.starts_with('.') {
            let source_module = module_name_for_path(source_path)?;
            resolve_relative_import_modules(&source_module, module_part, imported_name)
        } else {
            vec![
                format!("{module_part}.{imported_name}"),
                module_part.to_string(),
            ]
        };

        for module_name in resolution_modules {
            let Some(paths) = self.module_candidates.get(&module_name) else {
                continue;
            };

            return if paths.len() == 1 {
                paths.first().cloned()
            } else {
                None
            };
        }

        None
    }
}

/// Extracts Python class and function symbols.
pub fn extract_symbols(
    builder: &mut ProjectGraphBuilder,
    file: &SourceInput,
    file_id: String,
    syntax: &PythonSyntaxSnapshot,
) -> Result<(), String> {
    let mut scopes: Vec<ScopeEntry> = Vec::new();
    let mut symbols: Vec<SymbolRecord> = Vec::new();
    let mut calls: Vec<CallCandidate> = Vec::new();
    let mut lexical_bindings = LexicalBindings::default();

    for (line_index, (line, code_line)) in file.content.lines().zip(syntax.lines()).enumerate() {
        let trimmed = code_line.trim_start();

        if trimmed.is_empty() {
            continue;
        }

        let indent = line.len().saturating_sub(trimmed.len());
        close_finished_scopes(&mut scopes, indent);

        if let Some(declaration) = detect_declaration(trimmed) {
            let kind = declaration.kind.to_string();
            let name = declaration.name;
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
                lexical_bindings.register_parameters(&id, code_line);
                lexical_bindings.collect_line(&id, &code_line[call_scan_start..]);

                if call_scan_start < code_line.len() {
                    collect_python_calls(
                        &mut calls,
                        line_index,
                        line,
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
            lexical_bindings.collect_line(&source.id, code_line);
            collect_python_calls(
                &mut calls,
                line_index,
                line,
                code_line,
                0,
                &source.id,
                &source.scope_names,
            );
        }
    }

    add_call_edges(builder, file, &symbols, &lexical_bindings, calls);
    Ok(())
}

/// Adds Python imports using the code-only snapshots shared by workspace passes.
pub(in crate::analyzer) fn add_import_edges(
    builder: &mut ProjectGraphBuilder,
    files: &[SourceInput],
    syntax_snapshots: &PythonSyntaxSnapshots,
) {
    let resolver = WorkspaceModuleResolver::new(files);

    for file in files {
        if file.language_id != "python" {
            continue;
        }

        let source_module = module_name_for_path(&file.path);
        let Some(syntax) = syntax_snapshots.get(&file.path) else {
            continue;
        };

        for candidate in collect_import_candidates(file, syntax, source_module.as_deref()) {
            if let Some(target_path) = resolver.resolve_candidate(&candidate) {
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

/// Creates a lossless suffix index used when semantic resolution requires uniqueness.
fn create_module_candidate_map(files: &[SourceInput]) -> BTreeMap<String, Vec<PathBuf>> {
    let mut candidates: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();

    for file in files {
        if file.language_id != "python" {
            continue;
        }

        if let Some(module_name) = module_name_for_path(&file.path) {
            for alias in module_name_suffixes(&module_name) {
                let paths = candidates.entry(alias).or_default();

                if !paths.contains(&file.path) {
                    paths.push(file.path.clone());
                }
            }
        }
    }

    candidates
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
    syntax: &PythonSyntaxSnapshot,
    source_module: Option<&str>,
) -> Vec<ImportCandidate> {
    let mut candidates = Vec::new();

    for (line_index, (line, code_line)) in file.content.lines().zip(syntax.lines()).enumerate() {
        let trimmed = code_line.trim_start();

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
        .filter_map(read_imported_module_name)
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
    let module_name = part.split_whitespace().next()?;

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

/// Returns the full declaration line range.
fn line_range(line_index: usize, start_byte_offset: usize, line: &str) -> SourceRange {
    SourceRange {
        start_line: line_index,
        start_character: utf16_column_from_byte_offset(line, start_byte_offset),
        end_line: line_index,
        end_character: utf16_code_unit_len(line),
    }
}

/// Returns the best-effort name selection range.
fn name_range(line_index: usize, line: &str, name: &str) -> SourceRange {
    let start_byte_offset = line.find(name).unwrap_or_default();
    let start_character = utf16_column_from_byte_offset(line, start_byte_offset);

    SourceRange {
        start_line: line_index,
        start_character,
        end_line: line_index,
        end_character: start_character + utf16_code_unit_len(name),
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

        extract_fixture_symbols(&mut builder, &file, file_id);
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

        extract_fixture_symbols(&mut builder, &file, file_id);
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
    fn extracts_async_functions_and_resolves_their_call_edges() {
        let file = source(
            "/workspace/app.py",
            "class AsyncService:\n    async def run(self):\n        return await self.load()\n    async def load(self):\n        return await helper()\n\nasync def helper():\n    return await format_value()\n\nasync def format_value():\n    return \"value\"\n",
        );
        let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));
        let file_id = builder.add_file(&file);

        extract_fixture_symbols(&mut builder, &file, file_id);
        let graph = builder.finish();
        let run_id = node_id(&graph, "run");
        let load_id = node_id(&graph, "load");
        let helper_id = node_id(&graph, "helper");
        let format_id = node_id(&graph, "format_value");

        assert_call_edge(&graph, &run_id, &load_id);
        assert_call_edge(&graph, &load_id, &helper_id);
        assert_call_edge(&graph, &helper_id, &format_id);
        assert!(graph.nodes.iter().any(|node| {
            node.id == load_id && node.kind == "function" && node.parent_id.is_some()
        }));
        assert!(graph.nodes.iter().any(|node| {
            node.id == helper_id && node.kind == "function" && node.qualified_name == "helper"
        }));
    }

    #[test]
    fn rejects_declaration_keyword_prefixes_and_keeps_real_code() {
        let file = source(
            "/workspace/app.py",
            "def real_call():\n    return 1\n\ndef run():\n    default_value = 1\n    classify()\n    first = 'ghost_one()'\n    second = \"ghost_two()\"; return real_call()\n",
        );
        let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));
        let file_id = builder.add_file(&file);

        extract_fixture_symbols(&mut builder, &file, file_id);
        let graph = builder.finish();
        let run_id = node_id(&graph, "run");
        let real_call_id = node_id(&graph, "real_call");

        assert!(!graph.nodes.iter().any(|node| node.name == "ault_value"));
        assert!(!graph.nodes.iter().any(|node| node.name == "ify"));
        assert!(graph
            .nodes
            .iter()
            .any(|node| node.kind == "external" && node.name == "classify"));
        assert!(!graph
            .nodes
            .iter()
            .any(|node| node.name == "ghost_one" || node.name == "ghost_two"));
        assert_call_edge(&graph, &run_id, &real_call_id);
    }

    #[test]
    fn ignores_declarations_imports_and_calls_inside_docstrings() {
        let file = source(
            "/workspace/app.py",
            "\"\"\"Usage example.\n\ndef documented():\n    import hidden_module\n    ghost_call()\n\"\"\"\n\ndef visible():\n    return 1\n\ndef run():\n    return visible()\n",
        );
        let files = vec![file.clone()];
        let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));
        let file_id = builder.add_file(&file);

        extract_fixture_symbols(&mut builder, &file, file_id);
        let syntax_snapshots = syntax::scan_workspace_sources(&files);
        add_import_edges(&mut builder, &files, &syntax_snapshots);
        let graph = builder.finish();
        let run_id = node_id(&graph, "run");
        let visible_id = node_id(&graph, "visible");

        assert!(!graph.nodes.iter().any(|node| node.name == "documented"));
        assert!(!graph.nodes.iter().any(|node| node.name == "hidden_module"));
        assert!(!graph.nodes.iter().any(|node| node.name == "ghost_call"));
        assert_call_edge(&graph, &run_id, &visible_id);
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

        let syntax_snapshots = syntax::scan_workspace_sources(&files);
        add_import_edges(&mut builder, &files, &syntax_snapshots);
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

        let syntax_snapshots = syntax::scan_workspace_sources(&files);
        add_import_edges(&mut builder, &files, &syntax_snapshots);
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

    /// Runs symbol and call extraction against the shared code-only fixture view.
    fn extract_fixture_symbols(
        builder: &mut ProjectGraphBuilder,
        file: &SourceInput,
        file_id: String,
    ) {
        let syntax = PythonSyntaxSnapshot::new(&file.content);
        extract_symbols(builder, file, file_id, &syntax).expect("extracts Python fixture");
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
