//! Lightweight Python symbol extraction.
//!
//! This analyzer uses indentation and line prefixes to produce fast class and
//! function nodes without importing a Python parser.

use crate::graph::{NewSymbol, ProjectGraphBuilder};
use crate::model::{SourceInput, SourceRange};

/// Indentation-based Python scope entry.
struct ScopeEntry {
    id: String,
    name: String,
    indent: usize,
}

/// Extracts Python class and function symbols.
pub fn extract_symbols(
    builder: &mut ProjectGraphBuilder,
    file: &SourceInput,
    file_id: String,
) -> Result<(), String> {
    let mut scopes: Vec<ScopeEntry> = Vec::new();

    for (line_index, line) in file.content.lines().enumerate() {
        let trimmed = line.trim_start();

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
                scope_names,
                file_path: file.path.clone(),
                range: range.clone(),
                selection_range: name_range(line_index, line, &name),
                language: file.language_id.clone(),
                parent_id,
            });

            if kind == "class" {
                scopes.push(ScopeEntry { id, name, indent });
            }
        }
    }

    Ok(())
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
}
