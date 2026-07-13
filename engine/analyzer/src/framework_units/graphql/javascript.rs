//! JavaScript and TypeScript code-first GraphQL operation extraction.
//!
//! Only root operation decorators inside `@Resolver` classes are emitted;
//! field resolvers and undecorated methods deliberately remain outside this view.

use crate::model::SourceRange;

use super::support::{declaration_range, leading_width, OperationDraft, SchemaDraft};

const MAX_DECORATOR_LOOKBACK: usize = 8;

struct ClassDeclaration {
    name: String,
    range: SourceRange,
    body_end_line: usize,
    body_depth: isize,
}

/// JavaScript code with strings/comments masked and brace depth preserved.
struct CodeLine {
    code: String,
    start_brace_depth: isize,
    end_brace_depth: isize,
}

#[derive(Default)]
struct MaskState {
    in_block_comment: bool,
    string_delimiter: Option<char>,
    escaped: bool,
}

/// Extracts NestJS and TypeGraphQL resolver operations from one source snapshot.
pub(super) fn extract(content: &str) -> Vec<SchemaDraft> {
    if !has_supported_graphql_decorator_source(content) {
        return Vec::new();
    }

    let lines = content.lines().collect::<Vec<_>>();
    let code_lines = mask_code_lines(&lines);
    let mut schemas = Vec::new();

    for class in class_declarations(&lines, &code_lines) {
        if !leading_decorator_names(&code_lines, class.range.start_line)
            .iter()
            .any(|name| name == "Resolver")
        {
            continue;
        }

        let operations = resolver_operations(&lines, &code_lines, &class);
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

fn has_supported_graphql_decorator_source(content: &str) -> bool {
    content.contains("@nestjs/graphql") || content.contains("type-graphql")
}

fn resolver_operations(
    lines: &[&str],
    code_lines: &[CodeLine],
    class: &ClassDeclaration,
) -> Vec<OperationDraft> {
    let mut operations = Vec::new();
    let start = class.range.start_line.saturating_add(1);
    let end = class.body_end_line.min(lines.len().saturating_sub(1));

    for line_index in start..=end {
        let line = lines[line_index];
        let code_line = &code_lines[line_index];
        if code_line.start_brace_depth != class.body_depth {
            continue;
        }
        let trimmed = code_line.code.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('@') {
            continue;
        }
        let Some(method_name) = typescript_method_name(trimmed) else {
            continue;
        };

        let operation_type = leading_decorator_names(code_lines, line_index)
            .into_iter()
            .find_map(|name| operation_type(&name));
        let Some(operation_type) = operation_type else {
            continue;
        };

        push_operation(
            &mut operations,
            OperationDraft {
                name: method_name,
                operation_type,
                range: declaration_range(line_index, leading_width(line), line),
            },
        );
    }

    operations
}

fn class_declarations(lines: &[&str], code_lines: &[CodeLine]) -> Vec<ClassDeclaration> {
    let mut classes = Vec::new();
    for (line_index, code_line) in code_lines.iter().enumerate() {
        let Some(name) = class_name(code_line.code.trim_start()) else {
            continue;
        };
        let line = lines[line_index];
        classes.push(ClassDeclaration {
            name,
            range: declaration_range(line_index, leading_width(line), line),
            body_end_line: class_body_end(code_lines, line_index),
            body_depth: class_body_depth(code_lines, line_index),
        });
    }
    classes
}

fn class_name(source: &str) -> Option<String> {
    let class_index = source.find("class")?;
    let before = source[..class_index].chars().next_back();
    let after_index = class_index + "class".len();
    let after = source[after_index..].chars().next();
    if is_identifier_character(before) || !after.is_some_and(char::is_whitespace) {
        return None;
    }

    let name_source = source[after_index..].trim_start();
    let name_end = name_source
        .find(|character: char| !is_identifier_character(Some(character)))
        .unwrap_or(name_source.len());
    let name = &name_source[..name_end];
    is_identifier(name).then(|| name.to_string())
}

fn class_body_depth(lines: &[CodeLine], start_line: usize) -> isize {
    lines
        .iter()
        .skip(start_line)
        .find(|line| line.code.contains('{'))
        .map(|line| line.end_brace_depth)
        .unwrap_or_else(|| lines[start_line].start_brace_depth.saturating_add(1))
}

fn class_body_end(lines: &[CodeLine], start_line: usize) -> usize {
    let class_depth = lines[start_line].start_brace_depth;
    let mut opened = false;
    for (line_index, line) in lines.iter().enumerate().skip(start_line) {
        opened |= line.code.contains('{');
        if opened && line.end_brace_depth <= class_depth {
            return line_index;
        }
    }
    lines.len().saturating_sub(1)
}

fn leading_decorator_names(lines: &[CodeLine], declaration_line: usize) -> Vec<String> {
    let mut names = Vec::new();
    let mut cursor = declaration_line;
    let mut scanned = 0usize;

    while cursor > 0 && scanned < MAX_DECORATOR_LOOKBACK {
        cursor -= 1;
        scanned += 1;
        let trimmed = lines[cursor].code.trim_start();
        if trimmed.is_empty() {
            continue;
        }
        let Some(name) = decorator_name(trimmed) else {
            break;
        };
        names.push(name);
    }
    names.reverse();
    names
}

/// Masks JavaScript strings and comments before structural brace accounting.
fn mask_code_lines(lines: &[&str]) -> Vec<CodeLine> {
    let mut state = MaskState::default();
    let mut brace_depth = 0isize;
    let mut code_lines = Vec::with_capacity(lines.len());

    for line in lines {
        let start_brace_depth = brace_depth;
        let code = mask_code_line(line, &mut state);
        brace_depth += brace_delta(&code);
        code_lines.push(CodeLine {
            code,
            start_brace_depth,
            end_brace_depth: brace_depth,
        });
    }

    code_lines
}

fn mask_code_line(line: &str, state: &mut MaskState) -> String {
    let mut output = String::with_capacity(line.len());
    let mut characters = line.chars().peekable();

    while let Some(character) = characters.next() {
        if state.in_block_comment {
            push_masked(&mut output, character);
            if character == '*' && characters.peek() == Some(&'/') {
                push_masked(&mut output, characters.next().unwrap_or('/'));
                state.in_block_comment = false;
            }
            continue;
        }

        if let Some(delimiter) = state.string_delimiter {
            push_masked(&mut output, character);
            if state.escaped {
                state.escaped = false;
            } else if character == '\\' {
                state.escaped = true;
            } else if character == delimiter {
                state.string_delimiter = None;
            }
            continue;
        }

        if character == '/' && characters.peek() == Some(&'/') {
            push_masked(&mut output, character);
            for trailing in characters {
                push_masked(&mut output, trailing);
            }
            break;
        }
        if character == '/' && characters.peek() == Some(&'*') {
            push_masked(&mut output, character);
            push_masked(&mut output, characters.next().unwrap_or('*'));
            state.in_block_comment = true;
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            push_masked(&mut output, character);
            state.string_delimiter = Some(character);
            state.escaped = false;
            continue;
        }
        output.push(character);
    }

    if !matches!(state.string_delimiter, Some('`')) {
        state.string_delimiter = None;
        state.escaped = false;
    }
    output
}

fn brace_delta(line: &str) -> isize {
    line.chars()
        .fold(0isize, |depth, character| match character {
            '{' => depth + 1,
            '}' => depth - 1,
            _ => depth,
        })
}

fn push_masked(output: &mut String, character: char) {
    for _ in 0..character.len_utf8() {
        output.push(' ');
    }
}

fn decorator_name(source: &str) -> Option<String> {
    let target = source.strip_prefix('@')?.trim_start();
    let end = target
        .find(|character: char| {
            !(character == '.' || character == '_' || character.is_ascii_alphanumeric())
        })
        .unwrap_or(target.len());
    target[..end].rsplit('.').next().map(ToString::to_string)
}

fn operation_type(decorator_name: &str) -> Option<&'static str> {
    match decorator_name {
        "Query" => Some("Query"),
        "Mutation" => Some("Mutation"),
        "Subscription" => Some("Subscription"),
        _ => None,
    }
}

fn typescript_method_name(source: &str) -> Option<String> {
    if source.starts_with("constructor") || source.contains("=>") {
        return None;
    }
    let open = source.find('(')?;
    let before = source[..open].trim_end();
    if before.is_empty() || before.contains('=') {
        return None;
    }

    let name = before
        .split_whitespace()
        .last()?
        .trim_start_matches('*')
        .trim_end_matches('?');
    is_identifier(name).then(|| name.to_string())
}

fn is_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    (first == '_' || first == '$' || first.is_ascii_alphabetic())
        && characters.all(|character| {
            character == '_' || character == '$' || character.is_ascii_alphanumeric()
        })
}

fn is_identifier_character(character: Option<char>) -> bool {
    character.is_some_and(|value| value == '_' || value == '$' || value.is_ascii_alphanumeric())
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
