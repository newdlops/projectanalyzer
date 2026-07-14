//! Conservative source-binding shadow detection for imported bare calls.
//!
//! The lightweight analyzer has no lexical binding table. This module therefore
//! rejects proven or plausible rebinding constructs anywhere in the source file.
//! False negatives in resolution are preferred over false concrete call edges.

use crate::model::SourceInput;

use super::super::python_like::syntax::PythonSyntaxSnapshot;
use super::types::NamedImportBinding;

/// Returns whether a local import binding may be shadowed or rebound.
pub(super) fn has_possible_shadow(
    file: &SourceInput,
    binding: &NamedImportBinding,
    python_syntax: Option<&PythonSyntaxSnapshot>,
) -> bool {
    match binding.language_id.as_str() {
        "typescript" | "javascript" => {
            file.content.lines().enumerate().any(|(line_index, line)| {
                line_index != binding.import_line
                    && javascript_line_may_bind(line, &binding.local_name)
            })
        }
        "python" => python_syntax
            .map(|syntax| {
                syntax.lines().enumerate().any(|(line_index, code_line)| {
                    line_index != binding.import_line
                        && python_line_may_bind(code_line, &binding.local_name)
                })
            })
            // Missing syntax is an internal inconsistency, so keep resolution conservative.
            .unwrap_or(true),
        _ => true,
    }
}

/// Detects common JavaScript declarations, assignments, imports, and parameters.
fn javascript_line_may_bind(line: &str, name: &str) -> bool {
    let code = strip_javascript_line_comment(line).trim();

    if code.is_empty() {
        return false;
    }

    if let Some(clause) = import_clause(code) {
        return contains_identifier(clause, name);
    }

    for keyword in ["const", "let", "var"] {
        if let Some(declaration) = text_after_word(code, keyword) {
            let left = declaration
                .split_once('=')
                .map(|(value, _)| value)
                .unwrap_or(declaration);

            if contains_identifier(left, name) {
                return true;
            }
        }
    }

    for keyword in ["function", "class"] {
        if text_after_word(code, keyword)
            .and_then(first_identifier)
            .map(|identifier| identifier == name)
            .unwrap_or(false)
        {
            return true;
        }
    }

    if code.contains("function")
        && parenthesized_segment(code).is_some_and(|segment| contains_identifier(segment, name))
    {
        return true;
    }

    if let Some(arrow_index) = code.find("=>") {
        let parameters = code[..arrow_index].trim_end();
        let parameters = parenthesized_segment(parameters).unwrap_or(parameters);

        if contains_identifier(parameters, name) {
            return true;
        }
    }

    if code.starts_with("catch")
        && parenthesized_segment(code).is_some_and(|segment| contains_identifier(segment, name))
    {
        return true;
    }

    starts_assignment(code, name)
}

/// Detects common Python parameters, assignments, loop targets, aliases, and declarations.
fn python_line_may_bind(code_line: &str, name: &str) -> bool {
    let code = code_line.trim();

    if code.is_empty() {
        return false;
    }

    if code.starts_with("import ") || code.starts_with("from ") {
        return contains_identifier(code, name);
    }

    let declaration = code.strip_prefix("async ").unwrap_or(code);

    if let Some(after_def) = declaration.strip_prefix("def ") {
        if first_identifier(after_def)
            .map(|identifier| identifier == name)
            .unwrap_or(false)
        {
            return true;
        }

        if parenthesized_segment(after_def)
            .is_some_and(|segment| contains_identifier(segment, name))
        {
            return true;
        }
    }

    if declaration
        .strip_prefix("class ")
        .and_then(first_identifier)
        .map(|identifier| identifier == name)
        .unwrap_or(false)
    {
        return true;
    }

    if let Some(targets) = code
        .strip_prefix("for ")
        .and_then(|value| value.split(" in ").next())
    {
        if contains_identifier(targets, name) {
            return true;
        }
    }

    if (code.starts_with("with ") || code.starts_with("except "))
        && code
            .split(" as ")
            .skip(1)
            .any(|alias| first_identifier(alias) == Some(name))
    {
        return true;
    }

    if let Some(assignment_index) = find_assignment_operator(code) {
        if contains_identifier(&code[..assignment_index], name) {
            return true;
        }
    }

    code.strip_prefix(name)
        .and_then(|suffix| suffix.trim_start().strip_prefix(':'))
        .is_some()
}

/// Returns an import binding clause before its module specifier.
fn import_clause(code: &str) -> Option<&str> {
    let remainder = code.strip_prefix("import ")?;
    Some(
        remainder
            .split_once(" from ")
            .map(|(clause, _)| clause)
            .unwrap_or(remainder),
    )
}

/// Finds text after a whole-word keyword anywhere on a declaration line.
fn text_after_word<'a>(text: &'a str, keyword: &str) -> Option<&'a str> {
    for (index, _) in text.match_indices(keyword) {
        let before_valid =
            index == 0 || !text.as_bytes()[index.saturating_sub(1)].is_ascii_alphanumeric();
        let after_index = index + keyword.len();
        let after_valid = text
            .as_bytes()
            .get(after_index)
            .map(|byte| !byte.is_ascii_alphanumeric() && *byte != b'_')
            .unwrap_or(true);

        if before_valid && after_valid {
            return Some(text[after_index..].trim_start());
        }
    }

    None
}

/// Returns the first balanced-enough parenthesized segment on one source line.
fn parenthesized_segment(text: &str) -> Option<&str> {
    let start = text.find('(')?;
    let end = text[start + 1..].find(')')? + start + 1;
    Some(&text[start + 1..end])
}

/// Returns the first ASCII identifier in a text fragment.
fn first_identifier(text: &str) -> Option<&str> {
    identifier_ranges(text)
        .next()
        .map(|(start, end)| &text[start..end])
}

/// Returns whether a fragment contains one exact ASCII identifier.
fn contains_identifier(text: &str, expected: &str) -> bool {
    identifier_ranges(text).any(|(start, end)| &text[start..end] == expected)
}

/// Iterates ASCII identifier ranges without recursion or parser dependencies.
fn identifier_ranges(text: &str) -> impl Iterator<Item = (usize, usize)> + '_ {
    let bytes = text.as_bytes();
    let mut index = 0usize;

    std::iter::from_fn(move || {
        while index < bytes.len() && !is_identifier_start(bytes[index]) {
            index += 1;
        }

        if index >= bytes.len() {
            return None;
        }

        let start = index;
        index += 1;

        while index < bytes.len() && is_identifier_part(bytes[index]) {
            index += 1;
        }

        Some((start, index))
    })
}

/// Detects a direct assignment to the imported JavaScript binding.
fn starts_assignment(code: &str, name: &str) -> bool {
    let Some(suffix) = code.strip_prefix(name) else {
        return false;
    };
    let suffix = suffix.trim_start();

    suffix.starts_with('=') && !suffix.starts_with("==")
}

/// Finds a Python assignment operator while excluding equality and comparisons.
fn find_assignment_operator(code: &str) -> Option<usize> {
    let bytes = code.as_bytes();

    for index in 0..bytes.len() {
        if bytes[index] != b'=' {
            continue;
        }

        let before = index.checked_sub(1).and_then(|offset| bytes.get(offset));
        let after = bytes.get(index + 1);

        if matches!(before, Some(b'=' | b'!' | b'<' | b'>')) || after == Some(&b'=') {
            continue;
        }

        return Some(index);
    }

    None
}

/// Removes a JavaScript `//` comment outside simple strings.
fn strip_javascript_line_comment(line: &str) -> &str {
    strip_comment(line, b'/', Some(b'/'))
}

/// Shared iterative single-line comment scanner with quote/escape awareness.
fn strip_comment(line: &str, marker: u8, second_marker: Option<u8>) -> &str {
    let bytes = line.as_bytes();
    let mut quote = None;
    let mut index = 0usize;

    while index < bytes.len() {
        match (bytes[index], quote) {
            (b'\\', Some(_)) => index += 2,
            (b'\'' | b'"' | b'`', None) => {
                quote = Some(bytes[index]);
                index += 1;
            }
            (character, Some(active)) if character == active => {
                quote = None;
                index += 1;
            }
            (character, None) if character == marker => {
                if second_marker
                    .map(|second| bytes.get(index + 1) == Some(&second))
                    .unwrap_or(true)
                {
                    return &line[..index];
                }
                index += 1;
            }
            _ => index += 1,
        }
    }

    line
}

/// Returns whether a byte can start a supported ASCII identifier.
fn is_identifier_start(byte: u8) -> bool {
    byte == b'_' || byte == b'$' || byte.is_ascii_alphabetic()
}

/// Returns whether a byte can continue a supported ASCII identifier.
fn is_identifier_part(byte: u8) -> bool {
    is_identifier_start(byte) || byte.is_ascii_digit()
}
