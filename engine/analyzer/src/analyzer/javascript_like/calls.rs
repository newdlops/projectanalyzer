//! Call expression collection and same-file resolution for JavaScript-like files.

use crate::graph::{NewCallEdge, NewExternalSymbol, ProjectGraphBuilder};
use crate::model::{SourceInput, SourceRange};

use super::{ScopeEntry, SymbolRecord};

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

/// State carried while masking comments across line boundaries.
#[derive(Default)]
pub(super) struct LineMaskState {
    in_block_comment: bool,
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
    calls: Vec<CallCandidate>,
) {
    for call in calls {
        let resolved = resolve_call_target(symbols, &call).unwrap_or_else(|| {
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
                    start_character: chain_start,
                    end_line: line_index,
                    end_character: after_identifier + 1,
                },
            });
        }

        index = identifier_end;
    }

    calls
}

/// Masks comments and string contents while preserving byte offsets.
pub(super) fn mask_non_code(line: &str, state: &mut LineMaskState) -> String {
    let mut output = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    let mut string_delimiter: Option<char> = None;
    let mut escaped = false;

    while let Some(character) = chars.next() {
        if state.in_block_comment {
            push_masked_character(&mut output, character);

            if character == '*' && chars.peek() == Some(&'/') {
                let slash = chars.next().unwrap_or('/');
                push_masked_character(&mut output, slash);
                state.in_block_comment = false;
            }

            continue;
        }

        if let Some(delimiter) = string_delimiter {
            push_masked_character(&mut output, character);

            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                string_delimiter = None;
            }

            continue;
        }

        if character == '/' && chars.peek() == Some(&'/') {
            push_masked_character(&mut output, character);
            let slash = chars.next().unwrap_or('/');
            push_masked_character(&mut output, slash);

            for trailing in chars {
                push_masked_character(&mut output, trailing);
            }

            break;
        }

        if character == '/' && chars.peek() == Some(&'*') {
            push_masked_character(&mut output, character);
            let star = chars.next().unwrap_or('*');
            push_masked_character(&mut output, star);
            state.in_block_comment = true;
            continue;
        }

        if matches!(character, '"' | '\'' | '`') {
            push_masked_character(&mut output, character);
            string_delimiter = Some(character);
            escaped = false;
            continue;
        }

        output.push(character);
    }

    output
}

/// Resolves a call to a same-file callable when the line-based evidence is safe.
fn resolve_call_target(
    symbols: &[SymbolRecord],
    call: &CallCandidate,
) -> Option<ResolvedCallTarget> {
    if let Some(qualifier) = &call.expression.qualifier {
        return resolve_qualified_call(symbols, call, qualifier);
    }

    resolve_bare_call(symbols, call)
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
            confidence: "exact".to_string(),
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
fn resolve_bare_call(symbols: &[SymbolRecord], call: &CallCandidate) -> Option<ResolvedCallTarget> {
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
                confidence: "exact".to_string(),
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
            confidence: "resolved".to_string(),
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

/// Appends spaces matching the UTF-8 width of a masked character.
fn push_masked_character(output: &mut String, character: char) {
    for _ in 0..character.len_utf8() {
        output.push(' ');
    }
}
