//! Named-import parsing and module resolution for the imported-call post-pass.
//!
//! Only statically named ESM imports and Python `from` imports are accepted.
//! Default, namespace, wildcard, multiline, nested Python, and malformed forms
//! intentionally produce no binding and therefore preserve unresolved calls.

use crate::model::SourceInput;

use super::super::{javascript_like, python_like};
use super::types::NamedImportBinding;
use python_like::syntax::{PythonSyntaxSnapshot, PythonSyntaxSnapshots};

/// Collects supported named bindings whose module resolves inside the workspace.
pub(super) fn collect_named_import_bindings(
    files: &[SourceInput],
    python_syntax: &PythonSyntaxSnapshots,
) -> Vec<NamedImportBinding> {
    let mut bindings = Vec::new();
    let mut javascript_resolver = javascript_like::WorkspaceModuleResolver::new(files);
    let python_resolver = python_like::WorkspaceModuleResolver::new(files);

    for file in files {
        match file.language_id.as_str() {
            "typescript" | "javascript" => {
                collect_javascript_bindings(file, &mut javascript_resolver, &mut bindings)
            }
            "python" => {
                let Some(syntax) = python_syntax.get(&file.path) else {
                    continue;
                };
                collect_python_bindings(file, syntax, &python_resolver, &mut bindings);
            }
            _ => {}
        }
    }

    bindings
}

/// Resolves single-line named ESM imports such as `{ foo as bar }`.
fn collect_javascript_bindings(
    file: &SourceInput,
    resolver: &mut javascript_like::WorkspaceModuleResolver,
    output: &mut Vec<NamedImportBinding>,
) {
    for (line_index, line) in file.content.lines().enumerate() {
        let Some((module_specifier, names)) = parse_javascript_named_import(line) else {
            continue;
        };
        let Some(target_path) = resolver.resolve(&file.path, &module_specifier) else {
            continue;
        };

        if target_path == file.path {
            continue;
        }

        for (imported_name, local_name) in names {
            output.push(NamedImportBinding {
                source_path: file.path.clone(),
                target_path: target_path.clone(),
                imported_name,
                local_name,
                import_line: line_index,
                language_id: file.language_id.clone(),
            });
        }
    }
}

/// Parses exactly one top-level, single-line named ESM import declaration.
fn parse_javascript_named_import(line: &str) -> Option<(String, Vec<(String, String)>)> {
    if line.len() != line.trim_start().len() {
        return None;
    }

    let trimmed = line.trim();
    let remainder = trimmed.strip_prefix("import ")?;
    let from_index = remainder.find(" from ")?;
    let clause = remainder[..from_index].trim();

    if !clause.starts_with('{') || !clause.ends_with('}') {
        return None;
    }

    let module_text = remainder[from_index + " from ".len()..].trim_start();
    let module_specifier = read_quoted_value(module_text)?;
    let mut names = Vec::new();

    for part in clause[1..clause.len().saturating_sub(1)].split(',') {
        let tokens: Vec<&str> = part.split_whitespace().collect();
        let (imported_name, local_name) = match tokens.as_slice() {
            [name] if is_javascript_identifier(name) => (*name, *name),
            [original, "as", local]
                if is_javascript_identifier(original) && is_javascript_identifier(local) =>
            {
                (*original, *local)
            }
            _ => return None,
        };

        names.push((imported_name.to_string(), local_name.to_string()));
    }

    if names.is_empty() {
        None
    } else {
        Some((module_specifier, names))
    }
}

/// Resolves top-level Python `from module import foo as bar` declarations.
fn collect_python_bindings(
    file: &SourceInput,
    syntax: &PythonSyntaxSnapshot,
    resolver: &python_like::WorkspaceModuleResolver,
    output: &mut Vec<NamedImportBinding>,
) {
    for (line_index, code_line) in syntax.lines().enumerate() {
        let Some((module_part, names)) = parse_python_named_import(code_line) else {
            continue;
        };

        for (imported_name, local_name) in names {
            let Some(target_path) =
                resolver.resolve_named_import(&file.path, &module_part, &imported_name)
            else {
                continue;
            };

            if target_path == file.path {
                continue;
            }

            output.push(NamedImportBinding {
                source_path: file.path.clone(),
                target_path,
                imported_name,
                local_name,
                import_line: line_index,
                language_id: file.language_id.clone(),
            });
        }
    }
}

/// Parses one non-parenthesized top-level Python named `from` import.
fn parse_python_named_import(line: &str) -> Option<(String, Vec<(String, String)>)> {
    if line.len() != line.trim_start().len() {
        return None;
    }

    let code = line.trim();
    let remainder = code.strip_prefix("from ")?;
    let import_index = remainder.find(" import ")?;
    let module_part = remainder[..import_index].trim();
    let imported_part = remainder[import_index + " import ".len()..].trim();

    if module_part.is_empty()
        || module_part.contains(char::is_whitespace)
        || imported_part.contains(['(', ')', '*'])
    {
        return None;
    }

    let mut names = Vec::new();

    for part in imported_part.split(',') {
        let tokens: Vec<&str> = part.split_whitespace().collect();
        let (imported_name, local_name) = match tokens.as_slice() {
            [name] if is_python_identifier(name) => (*name, *name),
            [original, "as", local]
                if is_python_identifier(original) && is_python_identifier(local) =>
            {
                (*original, *local)
            }
            _ => return None,
        };

        names.push((imported_name.to_string(), local_name.to_string()));
    }

    if names.is_empty() {
        None
    } else {
        Some((module_part.to_string(), names))
    }
}

/// Reads a leading single- or double-quoted JavaScript module literal.
fn read_quoted_value(text: &str) -> Option<String> {
    let quote = *text.as_bytes().first()?;

    if quote != b'\'' && quote != b'"' {
        return None;
    }

    let closing = text.as_bytes()[1..]
        .iter()
        .position(|character| *character == quote)?
        + 1;

    Some(text[1..closing].to_string())
}

/// Returns whether a name fits the lightweight JavaScript call scanner.
fn is_javascript_identifier(name: &str) -> bool {
    is_ascii_identifier(name, true)
}

/// Returns whether a name fits the lightweight Python call scanner.
fn is_python_identifier(name: &str) -> bool {
    is_ascii_identifier(name, false)
}

/// Validates an ASCII identifier, optionally permitting JavaScript `$`.
fn is_ascii_identifier(name: &str, allow_dollar: bool) -> bool {
    let mut bytes = name.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    let valid_start =
        |byte: u8| byte == b'_' || (allow_dollar && byte == b'$') || byte.is_ascii_alphabetic();

    valid_start(first) && bytes.all(|byte| valid_start(byte) || byte.is_ascii_digit())
}
