//! Lightweight TypeScript/JavaScript symbol extraction.
//!
//! This module keeps declaration discovery separate from call-edge collection so
//! the line-based implementation can later be replaced by an AST parser without
//! changing the graph builder contract.

mod calls;
mod frontend;
mod imports;
mod syntax;

use crate::graph::{NewSymbol, ProjectGraphBuilder};
use crate::model::{SourceInput, SourceRange};
use calls::{
    add_call_edges, collect_call_expressions, current_call_source, declaration_body_depth,
    declaration_call_scan_start, is_callable_kind, CallCandidate, CallSource,
};
use syntax::SyntaxScanner;

pub use imports::add_import_edges;
pub(super) use imports::WorkspaceModuleResolver;

/// Scope entry used to associate declarations and calls with surrounding symbols.
#[derive(Clone)]
pub(super) struct ScopeEntry {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) kind: String,
    pub(super) scope_names: Vec<String>,
    pub(super) brace_depth: isize,
}

/// Callable or structural symbol recorded for same-file call resolution.
pub(super) struct SymbolRecord {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) kind: String,
    pub(super) qualified_name: String,
}

/// Extracts JavaScript-like symbols and contains/calls edges.
pub fn extract_symbols(
    builder: &mut ProjectGraphBuilder,
    file: &SourceInput,
    file_id: String,
) -> Result<(), String> {
    let mut scopes: Vec<ScopeEntry> = Vec::new();
    let mut symbols: Vec<SymbolRecord> = Vec::new();
    let mut calls: Vec<CallCandidate> = Vec::new();
    let mut syntax_scanner = SyntaxScanner::default();

    for (line_index, line) in file.content.lines().enumerate() {
        let syntax_line = syntax_scanner.scan_line(line_index, line);
        close_finished_scopes(&mut scopes, syntax_line.start_brace_depth());
        let code_line = syntax_line.code();
        let trimmed = syntax_line.trimmed_code();
        let start_character = syntax_line.trimmed_start_character();
        let mut call_scan_start = 0usize;
        let mut line_call_source: Option<CallSource> = None;

        if let Some((kind, name)) = detect_declaration(trimmed, is_in_class_scope(&scopes)) {
            let parent_id = scopes
                .last()
                .map(|scope| scope.id.clone())
                .unwrap_or_else(|| file_id.clone());
            let mut scope_names: Vec<String> =
                scopes.iter().map(|scope| scope.name.clone()).collect();
            scope_names.push(name.clone());
            let qualified_name = scope_names.join(".");
            let range = line_range(line_index, start_character, line);
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
                qualified_name,
            });

            call_scan_start = declaration_call_scan_start(code_line, &kind);

            if let Some(body_depth) =
                declaration_body_depth(code_line, syntax_line.start_brace_depth(), &kind)
            {
                scopes.push(ScopeEntry {
                    id: id.clone(),
                    name,
                    kind: kind.clone(),
                    scope_names: scope_names.clone(),
                    brace_depth: body_depth,
                });
            } else if is_callable_kind(&kind) && call_scan_start < code_line.len() {
                line_call_source = Some(CallSource {
                    id,
                    scope_names: scope_names.clone(),
                });
            }

            if !is_callable_kind(&kind) {
                call_scan_start = code_line.len();
            }
        }

        if let Some(source) = line_call_source.or_else(|| current_call_source(&scopes)) {
            for expression in collect_call_expressions(line_index, code_line, call_scan_start) {
                calls.push(CallCandidate {
                    source_id: source.id.clone(),
                    source_scope_names: source.scope_names.clone(),
                    expression,
                });
            }
        }
    }

    add_call_edges(builder, file, &symbols, calls);
    Ok(())
}

/// Removes scopes whose closing brace has been reached.
fn close_finished_scopes(scopes: &mut Vec<ScopeEntry>, brace_depth: isize) {
    while scopes
        .last()
        .map(|scope| brace_depth < scope.brace_depth)
        .unwrap_or(false)
    {
        scopes.pop();
    }
}

/// Returns whether the current lexical stack is inside a class body.
fn is_in_class_scope(scopes: &[ScopeEntry]) -> bool {
    scopes.iter().any(|scope| scope.kind == "class")
}

/// Detects a conservative JavaScript-like declaration on one line.
fn detect_declaration(trimmed: &str, allow_method: bool) -> Option<(String, String)> {
    let without_export = trimmed
        .strip_prefix("export default ")
        .or_else(|| trimmed.strip_prefix("export "))
        .unwrap_or(trimmed);
    let without_async = without_export
        .strip_prefix("async ")
        .unwrap_or(without_export);

    if let Some(name) = read_named_after_keyword(without_async, "class") {
        return Some(("class".to_string(), name));
    }

    if let Some(name) = read_named_after_keyword(without_async, "interface") {
        return Some(("interface".to_string(), name));
    }

    if let Some(name) = read_named_after_keyword(without_async, "enum") {
        return Some(("enum".to_string(), name));
    }

    if let Some(name) = read_named_after_keyword(without_async, "function") {
        return Some(("function".to_string(), name));
    }

    if let Some(name) = read_variable_function_name(without_async) {
        return Some(("function".to_string(), name));
    }

    if allow_method {
        if let Some(name) = read_method_name(without_async) {
            return Some(("method".to_string(), name));
        }
    }

    None
}

/// Reads an identifier after a declaration keyword.
fn read_named_after_keyword(line: &str, keyword: &str) -> Option<String> {
    let remainder = line.strip_prefix(keyword)?.trim_start();
    read_identifier(remainder)
}

/// Reads a function-like const/let/var declaration.
fn read_variable_function_name(line: &str) -> Option<String> {
    for keyword in ["const", "let", "var"] {
        let Some(remainder) = line.strip_prefix(keyword) else {
            continue;
        };
        let name = read_identifier(remainder.trim_start())?;

        if line.contains("=>") || line.contains("function") {
            return Some(name);
        }
    }

    None
}

/// Reads a class method declaration from one line.
fn read_method_name(line: &str) -> Option<String> {
    if line.starts_with("if ")
        || line.starts_with("for ")
        || line.starts_with("while ")
        || line.starts_with("switch ")
        || line.starts_with("return ")
    {
        return None;
    }

    let candidate = strip_method_modifiers(line);
    let open_paren = candidate.find('(')?;
    let before_paren = candidate[..open_paren]
        .trim()
        .split('<')
        .next()
        .unwrap_or_default()
        .trim();

    if before_paren.is_empty()
        || before_paren.contains(' ')
        || before_paren.contains('.')
        || read_identifier(before_paren).as_deref() != Some(before_paren)
    {
        return None;
    }

    let close_paren = candidate[open_paren + 1..].find(')')? + open_paren + 1;
    let after_paren = candidate[close_paren + 1..].trim_start();

    if !looks_like_method_tail(after_paren) {
        return None;
    }

    Some(before_paren.to_string())
}

/// Removes TypeScript method modifiers before declaration parsing.
fn strip_method_modifiers(mut line: &str) -> &str {
    loop {
        let Some(next) = line
            .strip_prefix("public ")
            .or_else(|| line.strip_prefix("private "))
            .or_else(|| line.strip_prefix("protected "))
            .or_else(|| line.strip_prefix("static "))
            .or_else(|| line.strip_prefix("async "))
            .or_else(|| line.strip_prefix("readonly "))
            .or_else(|| line.strip_prefix("abstract "))
            .or_else(|| line.strip_prefix("override "))
        else {
            return line;
        };

        line = next;
    }
}

/// Detects a conservative JavaScript-like method declaration tail.
fn looks_like_method_tail(after_paren: &str) -> bool {
    after_paren.starts_with('{') || after_paren.starts_with(':')
}

/// Reads a JavaScript identifier from the start of a string.
fn read_identifier(value: &str) -> Option<String> {
    let mut identifier = String::new();

    for character in value.chars() {
        if character == '_' || character == '$' || character.is_ascii_alphanumeric() {
            identifier.push(character);
            continue;
        }

        break;
    }

    if identifier.is_empty() {
        None
    } else {
        Some(identifier)
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
    use crate::model::{GraphEdge, ProjectGraph};
    use std::path::PathBuf;

    #[test]
    fn extracts_class_method_and_function() {
        let graph = analyze_typescript("class Service {\n  run() {}\n}\nfunction helper() {}\n");

        assert!(graph.nodes.iter().any(|node| node.name == "Service"));
        assert!(graph.nodes.iter().any(|node| node.name == "run"));
        assert!(graph.nodes.iter().any(|node| node.name == "helper"));
    }

    #[test]
    fn extracts_function_to_function_call_edge() {
        let graph =
            analyze_typescript("function caller() {\n  helper();\n}\n\nfunction helper() {}\n");
        let caller_id = node_id(&graph, "caller");
        let helper_id = node_id(&graph, "helper");
        let edge = call_edge(&graph, &caller_id, &helper_id);

        assert_eq!(edge.confidence, "exact");
        assert_eq!(edge.range.start_line, 1);
    }

    #[test]
    fn extracts_class_method_to_function_call_edge() {
        let graph = analyze_typescript(
            "class Service {\n  run() {\n    helper();\n  }\n}\n\nfunction helper() {}\n",
        );
        let run_id = node_id(&graph, "run");
        let helper_id = node_id(&graph, "helper");
        let edge = call_edge(&graph, &run_id, &helper_id);

        assert_eq!(edge.confidence, "exact");
        assert_eq!(edge.range.start_line, 2);
    }

    #[test]
    fn creates_external_node_for_unresolved_call() {
        let graph = analyze_typescript("function caller() {\n  missing();\n}\n");
        let caller_id = node_id(&graph, "caller");
        let external_id = node_id(&graph, "missing");
        let edge = call_edge(&graph, &caller_id, &external_id);
        let external = graph
            .nodes
            .iter()
            .find(|node| node.id == external_id)
            .expect("external target node exists");

        assert_eq!(external.kind, "external");
        assert_eq!(edge.confidence, "unresolved");
    }

    fn analyze_typescript(content: &str) -> ProjectGraph {
        let file = SourceInput {
            path: PathBuf::from("/workspace/src/service.ts"),
            language_id: "typescript".to_string(),
            content: content.to_string(),
            size_bytes: content.len(),
        };
        let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));
        let file_id = builder.add_file(&file);

        extract_symbols(&mut builder, &file, file_id).expect("extracts symbols");
        builder.finish()
    }

    fn node_id(graph: &ProjectGraph, name: &str) -> String {
        graph
            .nodes
            .iter()
            .find(|node| node.name == name)
            .map(|node| node.id.clone())
            .unwrap_or_else(|| panic!("missing node named {name}"))
    }

    fn call_edge<'a>(graph: &'a ProjectGraph, source_id: &str, target_id: &str) -> &'a GraphEdge {
        graph
            .edges
            .iter()
            .find(|edge| {
                edge.kind == "calls" && edge.source_id == source_id && edge.target_id == target_id
            })
            .unwrap_or_else(|| panic!("missing calls edge from {source_id} to {target_id}"))
    }
}
