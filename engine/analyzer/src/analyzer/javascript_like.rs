//! Lightweight TypeScript/JavaScript symbol extraction.
//!
//! This first Rust implementation is intentionally conservative and line-based.
//! It provides fast file/class/function visibility while leaving precise AST and
//! call-edge extraction to the next parser-backed milestone.

use crate::graph::{NewSymbol, ProjectGraphBuilder};
use crate::model::{SourceInput, SourceRange};

/// Scope entry used to associate methods with surrounding classes.
struct ScopeEntry {
    id: String,
    name: String,
    brace_depth: isize,
}

/// Extracts JavaScript-like symbols and contains edges.
pub fn extract_symbols(
    builder: &mut ProjectGraphBuilder,
    file: &SourceInput,
    file_id: String,
) -> Result<(), String> {
    let mut scopes: Vec<ScopeEntry> = Vec::new();
    let mut brace_depth = 0isize;

    for (line_index, line) in file.content.lines().enumerate() {
        close_finished_scopes(&mut scopes, brace_depth);
        let trimmed = line.trim_start();
        let start_character = line.len().saturating_sub(trimmed.len());

        if let Some((kind, name)) = detect_declaration(trimmed) {
            let parent_id = scopes
                .last()
                .map(|scope| scope.id.clone())
                .unwrap_or_else(|| file_id.clone());
            let mut scope_names: Vec<String> =
                scopes.iter().map(|scope| scope.name.clone()).collect();
            scope_names.push(name.clone());
            let range = line_range(line_index, start_character, line);
            let id = builder.add_symbol(NewSymbol {
                kind: kind.clone(),
                name: name.clone(),
                scope_names,
                file_path: file.path.clone(),
                range: range.clone(),
                selection_range: name_range(line_index, line, &name),
                language: file.language_id.clone(),
                parent_id,
            });

            if kind == "class" {
                scopes.push(ScopeEntry {
                    id,
                    name,
                    brace_depth: brace_depth + count_braces(line),
                });
            }
        }

        brace_depth += count_braces(line);
    }

    Ok(())
}

/// Removes class scopes whose closing brace has been reached.
fn close_finished_scopes(scopes: &mut Vec<ScopeEntry>, brace_depth: isize) {
    while scopes
        .last()
        .map(|scope| brace_depth < scope.brace_depth)
        .unwrap_or(false)
    {
        scopes.pop();
    }
}

/// Detects a conservative JavaScript-like declaration on one line.
fn detect_declaration(trimmed: &str) -> Option<(String, String)> {
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

    if let Some(name) = read_method_name(without_async) {
        return Some(("method".to_string(), name));
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

    let candidate = line
        .strip_prefix("public ")
        .or_else(|| line.strip_prefix("private "))
        .or_else(|| line.strip_prefix("protected "))
        .or_else(|| line.strip_prefix("static "))
        .unwrap_or(line);
    let open_paren = candidate.find('(')?;
    let before_paren = candidate[..open_paren].trim();

    if before_paren.is_empty() || before_paren.contains(' ') {
        return None;
    }

    Some(before_paren.to_string())
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

/// Counts brace depth changes on a line.
fn count_braces(line: &str) -> isize {
    let mut depth = 0isize;

    for character in line.chars() {
        if character == '{' {
            depth += 1;
        } else if character == '}' {
            depth -= 1;
        }
    }

    depth
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
    fn extracts_class_method_and_function() {
        let file = SourceInput {
            path: PathBuf::from("/workspace/src/service.ts"),
            language_id: "typescript".to_string(),
            content: "class Service {\n  run() {}\n}\nfunction helper() {}\n".to_string(),
            size_bytes: 48,
        };
        let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));
        let file_id = builder.add_file(&file);

        extract_symbols(&mut builder, &file, file_id).expect("extracts symbols");
        let graph = builder.finish();

        assert!(graph.nodes.iter().any(|node| node.name == "Service"));
        assert!(graph.nodes.iter().any(|node| node.name == "run"));
        assert!(graph.nodes.iter().any(|node| node.name == "helper"));
    }
}
