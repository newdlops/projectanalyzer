//! Call expression collection and same-file resolution for JavaScript-like files.

use crate::graph::{NewCallEdge, NewExternalSymbol, ProjectGraphBuilder};
use crate::model::{utf16_column_from_byte_offset, SourceInput, SourceRange};

use super::{bindings::LexicalBindings, ScopeEntry, SymbolRecord};

/// Line-local caller metadata copied before call candidates are stored.
#[derive(Clone)]
pub(super) struct CallSource {
    pub(super) id: String,
    pub(super) scope_names: Vec<String>,
}

/// Call expression observed inside a function or method scope.
pub(super) struct CallExpression {
    display_name: String,
    lookup_name: String,
    qualifier: Option<String>,
    range: SourceRange,
}

/// Deferred call candidate resolved after all same-file symbols are known.
pub(super) struct CallCandidate {
    pub(super) source_id: String,
    pub(super) source_scope_names: Vec<String>,
    pub(super) expression: CallExpression,
}

/// Resolved target node and confidence for a call edge.
struct ResolvedCallTarget {
    target_id: String,
    confidence: String,
}

/// Returns true for symbol kinds that can own or receive call edges.
pub(super) fn is_callable_kind(kind: &str) -> bool {
    matches!(kind, "function" | "method" | "constructor")
}

/// Returns the nearest function-like scope that can own call edges.
pub(super) fn current_call_source(scopes: &[ScopeEntry]) -> Option<CallSource> {
    scopes
        .iter()
        .rev()
        .find(|scope| is_callable_kind(&scope.kind))
        .map(|scope| CallSource {
            id: scope.id.clone(),
            scope_names: scope.scope_names.clone(),
        })
}

/// Converts deferred call candidates into graph edges after same-file resolution.
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

/// Returns where call scanning should begin on a declaration line.
pub(super) fn declaration_call_scan_start(line: &str, kind: &str) -> usize {
    if !is_callable_kind(kind) {
        return line.len();
    }

    if let Some(arrow_index) = line.find("=>") {
        let expression_start = arrow_index + 2;

        if let Some(open_offset) = line[expression_start..].find('{') {
            return expression_start + open_offset + 1;
        }

        return expression_start;
    }

    line.find('{')
        .map(|open_index| open_index + 1)
        .unwrap_or_else(|| line.len())
}

/// Returns the brace depth that keeps a declaration scope active.
pub(super) fn declaration_body_depth(line: &str, brace_depth: isize, kind: &str) -> Option<isize> {
    let body_start = if kind == "class" {
        line.find('{').map(|open_index| open_index + 1)
    } else if is_callable_kind(kind) {
        let scan_start = declaration_call_scan_start(line, kind);
        line.as_bytes()
            .get(scan_start.checked_sub(1)?)
            .filter(|character| **character == b'{')
            .map(|_| scan_start)
    } else {
        None
    }?;
    let open_index = body_start.saturating_sub(1);
    let mut depth = brace_depth;

    for (index, character) in line.bytes().enumerate() {
        if index >= open_index {
            break;
        }

        if character == b'{' {
            depth += 1;
        } else if character == b'}' {
            depth -= 1;
        }
    }

    Some(depth + 1)
}

/// Collects call expressions from a masked source line.
pub(super) fn collect_call_expressions(
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

/// Resolves a call to a same-file callable when the line-based evidence is safe.
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

/// Resolves member-style calls without falling back to unrelated same-name symbols.
fn resolve_qualified_call(
    symbols: &[SymbolRecord],
    call: &CallCandidate,
    qualifier: &str,
) -> Option<ResolvedCallTarget> {
    if qualifier == "this" {
        return resolve_relative_member_call(symbols, call);
    }

    if let Some(target) = find_callable_by_qualified_name(symbols, &call.expression.display_name) {
        return Some(ResolvedCallTarget {
            target_id: target.id.clone(),
            confidence: "resolved".to_string(),
        });
    }

    for prefix_len in (1..call.source_scope_names.len()).rev() {
        let qualified_name = format!(
            "{}.{}",
            call.source_scope_names[..prefix_len].join("."),
            call.expression.display_name
        );

        if let Some(target) = find_callable_by_qualified_name(symbols, &qualified_name) {
            return Some(ResolvedCallTarget {
                target_id: target.id.clone(),
                confidence: "resolved".to_string(),
            });
        }
    }

    None
}

/// Resolves `this.method()` against sibling methods in the current class-like scope.
fn resolve_relative_member_call(
    symbols: &[SymbolRecord],
    call: &CallCandidate,
) -> Option<ResolvedCallTarget> {
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

    None
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

/// Finds a callable symbol by its fully qualified same-file name.
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

        let dot_index = before_identifier - 1;
        let qualifier_end =
            skip_spaces_reverse(bytes, skip_optional_chain_marker(bytes, dot_index));
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

/// Skips a `?` before a member access dot in optional chaining.
fn skip_optional_chain_marker(bytes: &[u8], dot_index: usize) -> usize {
    if dot_index > 0 && bytes[dot_index - 1] == b'?' {
        dot_index - 1
    } else {
        dot_index
    }
}

/// Returns the index after an ASCII JavaScript identifier.
fn read_identifier_end(bytes: &[u8], start: usize) -> usize {
    let mut end = start + 1;

    while end < bytes.len() && is_identifier_part(bytes[end]) {
        end += 1;
    }

    end
}

/// Skips whitespace while scanning forward.
fn skip_spaces(bytes: &[u8], mut index: usize) -> usize {
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }

    index
}

/// Skips whitespace while scanning backward.
fn skip_spaces_reverse(bytes: &[u8], mut end: usize) -> usize {
    while end > 0 && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }

    end
}

/// Returns true for an ASCII JavaScript identifier start.
fn is_identifier_start(character: u8) -> bool {
    character == b'_' || character == b'$' || character.is_ascii_alphabetic()
}

/// Returns true for an ASCII JavaScript identifier part.
fn is_identifier_part(character: u8) -> bool {
    is_identifier_start(character) || character.is_ascii_digit()
}

/// Filters syntax keywords whose parenthesized forms are not call expressions.
fn is_skipped_call_name(name: &str) -> bool {
    matches!(
        name,
        "if" | "for" | "while" | "switch" | "catch" | "function" | "class"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Name-only lexical matching cannot claim AST- or type-backed exactness.
    #[test]
    fn marks_bare_lexical_name_match_as_resolved() {
        let symbols = vec![symbol("helper-id", "helper", "helper", "function")];
        let call = call_candidate("helper", "helper", None, &["caller"]);

        let resolved = resolve_call_target(&symbols, &LexicalBindings::default(), &call)
            .expect("bare call resolves");

        assert_eq!(resolved.target_id, "helper-id");
        assert_eq!(resolved.confidence, "resolved");
    }

    /// A qualified text match still lacks receiver type information.
    #[test]
    fn marks_qualified_name_match_as_resolved() {
        let symbols = vec![symbol("run-id", "run", "Service.run", "method")];
        let call = call_candidate("run", "Service.run", Some("Service"), &["caller"]);

        let resolved = resolve_call_target(&symbols, &LexicalBindings::default(), &call)
            .expect("qualified call resolves");

        assert_eq!(resolved.target_id, "run-id");
        assert_eq!(resolved.confidence, "resolved");
    }

    /// A file-wide unique-name fallback is a heuristic, not scope resolution.
    #[test]
    fn marks_unique_name_fallback_as_inferred() {
        let symbols = vec![symbol("run-id", "run", "Service.run", "method")];
        let call = call_candidate("run", "run", None, &["caller"]);

        let resolved = resolve_call_target(&symbols, &LexicalBindings::default(), &call)
            .expect("unique name is inferred");

        assert_eq!(resolved.target_id, "run-id");
        assert_eq!(resolved.confidence, "inferred");
    }

    /// Creates the minimum same-file symbol record needed by resolution tests.
    fn symbol(id: &str, name: &str, qualified_name: &str, kind: &str) -> SymbolRecord {
        SymbolRecord {
            id: id.to_string(),
            name: name.to_string(),
            kind: kind.to_string(),
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
