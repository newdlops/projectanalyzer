//! Strawberry code-first GraphQL root operation extraction.
//!
//! The adapter limits `@strawberry.type` handling to conventional Query,
//! Mutation, and Subscription roots so ordinary object fields are not promoted.

use crate::model::SourceRange;

use super::support::{declaration_range, leading_width, OperationDraft, SchemaDraft};

const MAX_DECORATOR_LOOKBACK: usize = 8;

struct ClassDeclaration {
    name: String,
    indent: usize,
    range: SourceRange,
    body_end_line: usize,
}

#[derive(Default)]
struct PythonMaskState {
    triple_quote: Option<u8>,
}

/// Extracts sync and async Strawberry root operations from one Python file.
pub(super) fn extract(content: &str) -> Vec<SchemaDraft> {
    if !content.contains("@strawberry.") {
        return Vec::new();
    }

    let lines = content.lines().collect::<Vec<_>>();
    let code_lines = mask_python_lines(&lines);
    let mut schemas = Vec::new();

    for class in class_declarations(&lines, &code_lines) {
        if !is_root_type_name(&class.name)
            || !leading_decorators(&code_lines, class.range.start_line)
                .iter()
                .any(|name| name == "strawberry.type")
        {
            continue;
        }

        let operations = root_operations(&lines, &code_lines, &class);
        if !operations.is_empty() {
            schemas.push(SchemaDraft {
                name: class.name,
                range: class.range,
                operations,
            });
        }
    }

    schemas
}

fn root_operations(
    lines: &[&str],
    code_lines: &[String],
    class: &ClassDeclaration,
) -> Vec<OperationDraft> {
    let start = class.range.start_line.saturating_add(1);
    let end = class.body_end_line.min(lines.len().saturating_sub(1));
    let Some(member_indent) = direct_member_indent(code_lines, start, end, class.indent) else {
        return Vec::new();
    };
    let mut operations = Vec::new();

    for line_index in start..=end {
        let line = lines[line_index];
        let code_line = &code_lines[line_index];
        if leading_width(code_line) != member_indent {
            continue;
        }
        let Some(method_name) = python_function_name(code_line.trim_start()) else {
            continue;
        };
        let operation_type = leading_decorators(code_lines, line_index)
            .into_iter()
            .find_map(|name| strawberry_operation_type(&name));
        let Some(operation_type) = operation_type else {
            continue;
        };

        push_operation(
            &mut operations,
            OperationDraft {
                name: method_name,
                operation_type,
                range: declaration_range(line_index, member_indent, line),
            },
        );
    }

    operations
}

fn class_declarations(lines: &[&str], code_lines: &[String]) -> Vec<ClassDeclaration> {
    let mut classes = Vec::new();
    for (line_index, line) in lines.iter().enumerate() {
        let code_line = &code_lines[line_index];
        let indent = leading_width(line);
        let Some(name) = python_class_name(code_line.trim_start()) else {
            continue;
        };
        classes.push(ClassDeclaration {
            name,
            indent,
            range: declaration_range(line_index, indent, line),
            body_end_line: python_block_end(code_lines, line_index, indent),
        });
    }
    classes
}

fn python_block_end(lines: &[String], start_line: usize, indent: usize) -> usize {
    for (line_index, line) in lines.iter().enumerate().skip(start_line + 1) {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if leading_width(line) <= indent {
            return line_index.saturating_sub(1);
        }
    }
    lines.len().saturating_sub(1)
}

fn direct_member_indent(
    lines: &[String],
    start_line: usize,
    end_line: usize,
    class_indent: usize,
) -> Option<usize> {
    (start_line..=end_line)
        .filter_map(|line_index| {
            let line = &lines[line_index];
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return None;
            }
            let indent = leading_width(line);
            (indent > class_indent).then_some(indent)
        })
        .min()
}

fn leading_decorators(lines: &[String], declaration_line: usize) -> Vec<String> {
    let mut decorators = Vec::new();
    let mut cursor = declaration_line;
    let mut scanned = 0usize;

    while cursor > 0 && scanned < MAX_DECORATOR_LOOKBACK {
        cursor -= 1;
        scanned += 1;
        let trimmed = lines[cursor].trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some(name) = python_decorator_name(trimmed) else {
            break;
        };
        decorators.push(name);
    }
    decorators.reverse();
    decorators
}

/// Masks Python strings and comments while preserving declaration offsets.
fn mask_python_lines(lines: &[&str]) -> Vec<String> {
    let mut state = PythonMaskState::default();
    lines
        .iter()
        .map(|line| mask_python_line(line, &mut state))
        .collect()
}

fn mask_python_line(line: &str, state: &mut PythonMaskState) -> String {
    let source = line.as_bytes();
    let mut output = source.to_vec();
    let mut cursor = 0usize;

    while cursor < source.len() {
        if let Some(quote) = state.triple_quote {
            if has_triple_quote(source, cursor, quote) {
                mask_bytes(&mut output, cursor, 3);
                state.triple_quote = None;
                cursor += 3;
            } else {
                output[cursor] = b' ';
                if source[cursor] == b'\\' && cursor + 1 < source.len() {
                    output[cursor + 1] = b' ';
                    cursor += 2;
                } else {
                    cursor += 1;
                }
            }
            continue;
        }

        match source[cursor] {
            b'#' => {
                mask_bytes(&mut output, cursor, source.len() - cursor);
                break;
            }
            quote @ (b'\'' | b'"') if has_triple_quote(source, cursor, quote) => {
                mask_bytes(&mut output, cursor, 3);
                state.triple_quote = Some(quote);
                cursor += 3;
            }
            quote @ (b'\'' | b'"') => {
                cursor = mask_single_line_string(source, &mut output, cursor, quote);
            }
            _ => cursor += 1,
        }
    }

    String::from_utf8(output).unwrap_or_else(|_| line.to_string())
}

fn has_triple_quote(source: &[u8], start: usize, quote: u8) -> bool {
    source.get(start..start.saturating_add(3)) == Some(&[quote, quote, quote])
}

fn mask_single_line_string(source: &[u8], output: &mut [u8], start: usize, quote: u8) -> usize {
    output[start] = b' ';
    let mut cursor = start + 1;
    while cursor < source.len() {
        output[cursor] = b' ';
        if source[cursor] == b'\\' && cursor + 1 < source.len() {
            output[cursor + 1] = b' ';
            cursor += 2;
        } else if source[cursor] == quote {
            return cursor + 1;
        } else {
            cursor += 1;
        }
    }
    cursor
}

fn mask_bytes(output: &mut [u8], start: usize, length: usize) {
    for byte in output.iter_mut().skip(start).take(length) {
        *byte = b' ';
    }
}

fn python_decorator_name(source: &str) -> Option<String> {
    let target = source.strip_prefix('@')?.trim_start();
    let end = target
        .find(|character: char| {
            !(character == '.' || character == '_' || character.is_ascii_alphanumeric())
        })
        .unwrap_or(target.len());
    (end > 0).then(|| target[..end].to_string())
}

fn strawberry_operation_type(decorator: &str) -> Option<&'static str> {
    match decorator {
        "strawberry.field" => Some("Query"),
        "strawberry.mutation" => Some("Mutation"),
        "strawberry.subscription" => Some("Subscription"),
        _ => None,
    }
}

fn is_root_type_name(name: &str) -> bool {
    matches!(name, "Query" | "Mutation" | "Subscription")
}

fn python_class_name(source: &str) -> Option<String> {
    let remainder = source.strip_prefix("class")?;
    if !remainder.chars().next().is_some_and(char::is_whitespace) {
        return None;
    }
    read_python_identifier(remainder.trim_start())
}

fn python_function_name(source: &str) -> Option<String> {
    let source = source.strip_prefix("async ").unwrap_or(source);
    let remainder = source.strip_prefix("def")?;
    if !remainder.chars().next().is_some_and(char::is_whitespace) {
        return None;
    }
    read_python_identifier(remainder.trim_start())
}

fn read_python_identifier(source: &str) -> Option<String> {
    let end = source
        .find(|character: char| !(character == '_' || character.is_ascii_alphanumeric()))
        .unwrap_or(source.len());
    let candidate = &source[..end];
    let mut characters = candidate.chars();
    let first = characters.next()?;
    ((first == '_' || first.is_ascii_alphabetic())
        && characters.all(|character| character == '_' || character.is_ascii_alphanumeric()))
    .then(|| candidate.to_string())
}

fn push_operation(operations: &mut Vec<OperationDraft>, operation: OperationDraft) {
    let duplicate = operations.iter().any(|candidate| {
        candidate.operation_type == operation.operation_type
            && candidate.name == operation.name
            && candidate.range.start_line == operation.range.start_line
            && candidate.range.start_character == operation.range.start_character
    });
    if !duplicate {
        operations.push(operation);
    }
}
