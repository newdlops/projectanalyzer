//! Same-file Python call expression collection and resolution.
//!
//! The helper keeps call traversal iterative and conservative. It resolves
//! direct same-file function calls and leaves unresolved dynamic calls as
//! external nodes so the UI can still show that a callable depends on them.

use crate::graph::{NewCallEdge, NewExternalSymbol, ProjectGraphBuilder};
use crate::model::{utf16_column_from_byte_offset, SourceInput, SourceRange};

use super::{bindings::LexicalBindings, ScopeEntry, SymbolRecord};

/// A call expression observed inside a callable Python scope.
struct CallExpression {
    display_name: String,
    lookup_name: String,
    qualifier: Option<String>,
    range: SourceRange,
}

/// Deferred Python call candidate resolved after declarations are collected.
pub(super) struct CallCandidate {
    source_id: String,
    source_scope_names: Vec<String>,
    expression: CallExpression,
}

/// Resolved call target metadata.
struct ResolvedCallTarget {
    target_id: String,
    confidence: String,
}

/// Finds the nearest function scope that can own Python call edges.
pub(super) fn current_call_source(scopes: &[ScopeEntry]) -> Option<&ScopeEntry> {
    scopes
        .iter()
        .rev()
        .find(|scope| is_callable_kind(&scope.kind))
}

/// Returns true for Python symbols that can own or receive call edges.
fn is_callable_kind(kind: &str) -> bool {
    kind == "function"
}

/// Converts deferred Python call candidates into graph edges.
pub(super) fn add_call_edges(
    builder: &mut ProjectGraphBuilder,
    file: &SourceInput,
    symbols: &[SymbolRecord],
    lexical_bindings: &LexicalBindings,
    calls: Vec<CallCandidate>,
) {
    for call in calls {
        let resolved = resolve_call_target(symbols, lexical_bindings, &call).unwrap_or_else(|| {
            let target_id = builder.add_external_symbol(NewExternalSymbol {
                name: call.expression.display_name.clone(),
                qualified_name: call.expression.display_name.clone(),
                file_path: file.path.clone(),
                range: call.expression.range.clone(),
                selection_range: call.expression.range.clone(),
                language: file.language_id.clone(),
            });

            ResolvedCallTarget {
                target_id,
                confidence: "unresolved".to_string(),
            }
        });

        builder.add_call_edge(NewCallEdge {
            source_id: call.source_id,
            target_id: resolved.target_id,
            file_path: file.path.clone(),
            range: call.expression.range,
            confidence: resolved.confidence,
        });
    }
}

/// Returns where to scan calls on a one-line Python function declaration.
pub(super) fn declaration_call_scan_start(line: &str) -> usize {
    line.find(':')
        .map(|colon_index| colon_index + 1)
        .unwrap_or_else(|| line.len())
}

/// Adds all call expressions found in one Python line under a source scope.
pub(super) fn collect_python_calls(
    calls: &mut Vec<CallCandidate>,
    line_index: usize,
    source_line: &str,
    code_line: &str,
    scan_start: usize,
    source_id: &str,
    source_scope_names: &[String],
) {
    for expression in collect_call_expressions(line_index, source_line, code_line, scan_start) {
        calls.push(CallCandidate {
            source_id: source_id.to_string(),
            source_scope_names: source_scope_names.to_vec(),
            expression,
        });
    }
}

/// Collects Python call expressions by looking for identifier chains before `(`.
fn collect_call_expressions(
    line_index: usize,
    source_line: &str,
    code_line: &str,
    scan_start: usize,
) -> Vec<CallExpression> {
    let mut calls = Vec::new();
    let bytes = code_line.as_bytes();
    let mut index = scan_start.min(code_line.len());

    while index < bytes.len() {
        if !is_identifier_start(bytes[index]) {
            index += 1;
            continue;
        }

        let identifier_start = index;
        let identifier_end = read_identifier_end(bytes, identifier_start);
        let lookup_name = code_line[identifier_start..identifier_end].to_string();
        let after_identifier = skip_spaces(bytes, identifier_end);

        if after_identifier < bytes.len()
            && bytes[after_identifier] == b'('
            && !is_skipped_call_name(&lookup_name)
        {
            let (display_name, qualifier, chain_start) =
                read_callee_chain(code_line, identifier_start, identifier_end);
            calls.push(CallExpression {
                display_name,
                lookup_name,
                qualifier,
                range: SourceRange {
                    start_line: line_index,
                    start_character: utf16_column_from_byte_offset(source_line, chain_start),
                    end_line: line_index,
                    end_character: utf16_column_from_byte_offset(source_line, after_identifier + 1),
                },
            });
        }

        index = identifier_end;
    }

    calls
}

/// Resolves a Python call to a same-file function when the evidence is local.
fn resolve_call_target(
    symbols: &[SymbolRecord],
    lexical_bindings: &LexicalBindings,
    call: &CallCandidate,
) -> Option<ResolvedCallTarget> {
    if let Some(qualifier) = &call.expression.qualifier {
        return resolve_qualified_call(symbols, call, qualifier);
    }

    resolve_bare_call(symbols, lexical_bindings, call)
}

/// Resolves `self.method()` and direct qualified names against same-file symbols.
fn resolve_qualified_call(
    symbols: &[SymbolRecord],
    call: &CallCandidate,
    qualifier: &str,
) -> Option<ResolvedCallTarget> {
    if qualifier == "self" || qualifier == "cls" {
        for prefix_len in (1..call.source_scope_names.len()).rev() {
            let qualified_name = format!(
                "{}.{}",
                call.source_scope_names[..prefix_len].join("."),
                call.expression.lookup_name
            );

            if let Some(target) = find_callable_by_qualified_name(symbols, &qualified_name) {
                return Some(ResolvedCallTarget {
                    target_id: target.id.clone(),
                    confidence: "resolved".to_string(),
                });
            }
        }
    }

    find_callable_by_qualified_name(symbols, &call.expression.display_name).map(|target| {
        ResolvedCallTarget {
            target_id: target.id.clone(),
            confidence: "resolved".to_string(),
        }
    })
}

/// Resolves unqualified calls using lexical names first, then a unique-name fallback.
fn resolve_bare_call(
    symbols: &[SymbolRecord],
    lexical_bindings: &LexicalBindings,
    call: &CallCandidate,
) -> Option<ResolvedCallTarget> {
    if lexical_bindings.shadows(&call.source_id, &call.expression.lookup_name) {
        return None;
    }

    for prefix_len in (0..=call.source_scope_names.len()).rev() {
        let qualified_name = if prefix_len == 0 {
            call.expression.lookup_name.clone()
        } else {
            format!(
                "{}.{}",
                call.source_scope_names[..prefix_len].join("."),
                call.expression.lookup_name
            )
        };

        if let Some(target) = find_callable_by_qualified_name(symbols, &qualified_name) {
            return Some(ResolvedCallTarget {
                target_id: target.id.clone(),
                confidence: "resolved".to_string(),
            });
        }
    }

    let matches: Vec<&SymbolRecord> = symbols
        .iter()
        .filter(|symbol| {
            is_callable_kind(&symbol.kind) && symbol.name == call.expression.lookup_name
        })
        .collect();

    if matches.len() == 1 {
        return Some(ResolvedCallTarget {
            target_id: matches[0].id.clone(),
            confidence: "inferred".to_string(),
        });
    }

    None
}

/// Finds a callable Python symbol by its same-file qualified name.
fn find_callable_by_qualified_name<'a>(
    symbols: &'a [SymbolRecord],
    qualified_name: &str,
) -> Option<&'a SymbolRecord> {
    symbols
        .iter()
        .find(|symbol| is_callable_kind(&symbol.kind) && symbol.qualified_name == qualified_name)
}

/// Reads a dotted callee chain ending at the identifier before `(`.
fn read_callee_chain(
    code_line: &str,
    identifier_start: usize,
    identifier_end: usize,
) -> (String, Option<String>, usize) {
    let bytes = code_line.as_bytes();
    let mut segments = vec![code_line[identifier_start..identifier_end].to_string()];
    let mut chain_start = identifier_start;
    let mut cursor = identifier_start;

    loop {
        let before_identifier = skip_spaces_reverse(bytes, cursor);

        if before_identifier == 0 || bytes[before_identifier - 1] != b'.' {
            break;
        }

        let qualifier_end = skip_spaces_reverse(bytes, before_identifier - 1);
        let Some((qualifier_start, qualifier_name)) =
            read_identifier_before(code_line, qualifier_end)
        else {
            break;
        };

        segments.push(qualifier_name);
        chain_start = qualifier_start;
        cursor = qualifier_start;
    }

    segments.reverse();
    let qualifier = if segments.len() > 1 {
        Some(segments[..segments.len() - 1].join("."))
    } else {
        None
    };

    (segments.join("."), qualifier, chain_start)
}

/// Reads the start and text of an identifier ending at `end`.
fn read_identifier_before(code_line: &str, end: usize) -> Option<(usize, String)> {
    let bytes = code_line.as_bytes();
    let mut start = end;

    if start == 0 || !is_identifier_part(bytes[start - 1]) {
        return None;
    }

    while start > 0 && is_identifier_part(bytes[start - 1]) {
        start -= 1;
    }

    if !is_identifier_start(bytes[start]) {
        return None;
    }

    Some((start, code_line[start..end].to_string()))
}

/// Returns the index after an ASCII Python identifier.
fn read_identifier_end(bytes: &[u8], start: usize) -> usize {
    let mut end = start + 1;

    while end < bytes.len() && is_identifier_part(bytes[end]) {
        end += 1;
    }

    end
}

/// Skips ASCII whitespace from `start`.
fn skip_spaces(bytes: &[u8], start: usize) -> usize {
    let mut index = start;

    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }

    index
}

/// Skips ASCII whitespace before `end`.
fn skip_spaces_reverse(bytes: &[u8], end: usize) -> usize {
    let mut index = end;

    while index > 0 && bytes[index - 1].is_ascii_whitespace() {
        index -= 1;
    }

    index
}

/// Returns whether a byte can begin a Python identifier in this lightweight pass.
fn is_identifier_start(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphabetic()
}

/// Returns whether a byte can continue a Python identifier in this lightweight pass.
fn is_identifier_part(byte: u8) -> bool {
    is_identifier_start(byte) || byte.is_ascii_digit()
}

/// Filters language keywords and declaration helpers that are not runtime calls.
fn is_skipped_call_name(name: &str) -> bool {
    matches!(
        name,
        "class" | "def" | "if" | "elif" | "for" | "while" | "with"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Name-only lexical matching cannot claim parser-backed exactness.
    #[test]
    fn marks_bare_lexical_name_match_as_resolved() {
        let symbols = vec![symbol("helper-id", "helper", "helper")];
        let call = call_candidate("helper", "helper", None, &["caller"]);

        let resolved = resolve_call_target(&symbols, &LexicalBindings::default(), &call)
            .expect("bare call resolves");

        assert_eq!(resolved.target_id, "helper-id");
        assert_eq!(resolved.confidence, "resolved");
    }

    /// A qualified text match still lacks receiver type information.
    #[test]
    fn marks_qualified_name_match_as_resolved() {
        let symbols = vec![symbol("load-id", "load", "Service.load")];
        let call = call_candidate("load", "Service.load", Some("Service"), &["caller"]);

        let resolved = resolve_call_target(&symbols, &LexicalBindings::default(), &call)
            .expect("qualified call resolves");

        assert_eq!(resolved.target_id, "load-id");
        assert_eq!(resolved.confidence, "resolved");
    }

    /// A file-wide unique-name fallback is a heuristic, not lexical resolution.
    #[test]
    fn marks_unique_name_fallback_as_inferred() {
        let symbols = vec![symbol("load-id", "load", "Service.load")];
        let call = call_candidate("load", "load", None, &["caller"]);

        let resolved = resolve_call_target(&symbols, &LexicalBindings::default(), &call)
            .expect("unique name is inferred");

        assert_eq!(resolved.target_id, "load-id");
        assert_eq!(resolved.confidence, "inferred");
    }

    /// Creates the minimum same-file Python symbol record for resolution tests.
    fn symbol(id: &str, name: &str, qualified_name: &str) -> SymbolRecord {
        SymbolRecord {
            id: id.to_string(),
            name: name.to_string(),
            kind: "function".to_string(),
            qualified_name: qualified_name.to_string(),
        }
    }

    /// Creates a deferred call with a stable placeholder source and range.
    fn call_candidate(
        lookup_name: &str,
        display_name: &str,
        qualifier: Option<&str>,
        source_scope_names: &[&str],
    ) -> CallCandidate {
        CallCandidate {
            source_id: "source-id".to_string(),
            source_scope_names: source_scope_names
                .iter()
                .map(|name| (*name).to_string())
                .collect(),
            expression: CallExpression {
                display_name: display_name.to_string(),
                lookup_name: lookup_name.to_string(),
                qualifier: qualifier.map(str::to_string),
                range: SourceRange {
                    start_line: 0,
                    start_character: 0,
                    end_line: 0,
                    end_character: display_name.len(),
                },
            },
        }
    }
}
