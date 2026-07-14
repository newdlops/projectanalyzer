//! Django URL pattern parsing helpers.
//!
//! The parser stays conservative: it recognizes literal `path(...)` and
//! `re_path(...)` calls and extracts simple static view references only.

use crate::model::{utf16_code_unit_len, utf16_column_from_byte_offset, SourceRange};

/// Route draft returned to the Django adapter before graph IDs are assigned.
pub(super) struct RouteDraft {
    pub(super) name: String,
    pub(super) range: SourceRange,
    pub(super) target: Option<RouteTarget>,
}

/// Deferred route target resolution kept out of the serialized unit model.
#[derive(Clone)]
pub(super) struct RouteTarget {
    pub(super) candidates: Vec<String>,
}

/// Returns URL pattern declarations from one URLConf source text.
pub(super) fn route_drafts(content: &str) -> Vec<RouteDraft> {
    collect_route_statements(content)
        .into_iter()
        .filter_map(route_unit_from_statement)
        .collect()
}

/// One URL pattern call collected from one or more source lines.
struct RouteStatement {
    text: String,
    start_line: usize,
    start_character: usize,
    end_line: usize,
    end_character: usize,
}

/// Collects route call statements without recursing into syntax trees.
fn collect_route_statements(content: &str) -> Vec<RouteStatement> {
    let lines = content.lines().collect::<Vec<_>>();
    let mut statements = Vec::new();
    let mut index = 0usize;

    while index < lines.len() {
        let line = lines[index];
        let trimmed = line.trim_start();

        if !starts_route_call(trimmed) {
            index += 1;
            continue;
        }

        let start_line = index;
        let start_byte_offset = line.len().saturating_sub(trimmed.len());
        let mut text = String::new();
        let mut balance = 0isize;

        while index < lines.len() {
            let current = lines[index];
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(current.trim());
            balance += parenthesis_delta(current);

            if balance <= 0 && text.contains(')') {
                break;
            }

            index += 1;
        }

        statements.push(RouteStatement {
            text,
            start_line,
            start_character: utf16_column_from_byte_offset(line, start_byte_offset),
            end_line: index,
            end_character: lines
                .get(index)
                .map(|line| utf16_code_unit_len(line))
                .unwrap_or_default(),
        });
        index += 1;
    }

    statements
}

/// Returns whether a trimmed line starts a Django URL pattern call.
fn starts_route_call(trimmed: &str) -> bool {
    trimmed.starts_with("path(") || trimmed.starts_with("re_path(")
}

/// Counts parentheses for bounded route statement collection.
fn parenthesis_delta(line: &str) -> isize {
    let mut delta = 0isize;

    for character in line.chars() {
        match character {
            '(' => delta += 1,
            ')' => delta -= 1,
            _ => {}
        }
    }

    delta
}

/// Creates one route draft from a collected URL pattern statement.
fn route_unit_from_statement(statement: RouteStatement) -> Option<RouteDraft> {
    let arguments = call_arguments(&statement.text)?;
    let parts = split_top_level_arguments(arguments);

    if parts.is_empty() {
        return None;
    }

    let pattern = python_string_literal(&parts[0]).unwrap_or_else(|| parts[0].trim().to_string());
    let route_name = route_name_argument(&parts);
    let target = parts.get(1).and_then(|value| route_target(value));
    let display_name = route_display_name(&pattern, route_name.as_deref());

    Some(RouteDraft {
        name: display_name,
        range: SourceRange {
            start_line: statement.start_line,
            start_character: statement.start_character,
            end_line: statement.end_line,
            end_character: statement.end_character,
        },
        target,
    })
}

/// Returns the top-level call argument text inside the outer route call.
fn call_arguments(statement: &str) -> Option<&str> {
    let open = statement.find('(')?;
    let close = statement.rfind(')')?;

    if close <= open {
        None
    } else {
        Some(&statement[open + 1..close])
    }
}

/// Splits function arguments while preserving nested calls and strings.
fn split_top_level_arguments(arguments: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0isize;
    let mut string_quote = None;
    let mut escaped = false;

    for character in arguments.chars() {
        if let Some(quote) = string_quote {
            current.push(character);

            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == quote {
                string_quote = None;
            }
            continue;
        }

        match character {
            '\'' | '"' => {
                string_quote = Some(character);
                current.push(character);
            }
            '(' | '[' | '{' => {
                depth += 1;
                current.push(character);
            }
            ')' | ']' | '}' => {
                depth -= 1;
                current.push(character);
            }
            ',' if depth == 0 => {
                parts.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(character),
        }
    }

    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }

    parts
}

/// Reads a simple Python string literal, including raw string prefixes.
fn python_string_literal(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let first_quote = trimmed.find(['\'', '"'])?;
    let quote = trimmed[first_quote..].chars().next()?;
    let remainder = &trimmed[first_quote + quote.len_utf8()..];
    let end = remainder.rfind(quote)?;

    Some(remainder[..end].to_string())
}

/// Finds the `name="..."` keyword argument when present.
fn route_name_argument(parts: &[String]) -> Option<String> {
    parts.iter().find_map(|part| {
        let trimmed = part.trim();
        let value = trimmed.strip_prefix("name=")?;
        python_string_literal(value)
    })
}

/// Builds a readable route label from URL pattern and optional route name.
fn route_display_name(pattern: &str, route_name: Option<&str>) -> String {
    match route_name {
        Some(name) if !name.is_empty() => format!("{pattern} ({name})"),
        _ if pattern.is_empty() => "/".to_string(),
        _ => pattern.to_string(),
    }
}

/// Extracts conservative view target candidates from a URL pattern argument.
fn route_target(value: &str) -> Option<RouteTarget> {
    let trimmed = value.trim();

    if trimmed.starts_with("include(") || trimmed.starts_with("lambda ") {
        return None;
    }

    let normalized = trimmed.replace(".as_view()", "");
    let reference = normalized.split('(').next().unwrap_or(trimmed).trim();
    let reference = reference.trim_end_matches(".as_view").trim();
    let reference = reference
        .chars()
        .take_while(|character| {
            *character == '_' || *character == '.' || character.is_ascii_alphanumeric()
        })
        .collect::<String>();

    if reference.is_empty() {
        return None;
    }

    let leaf = reference
        .rsplit('.')
        .next()
        .unwrap_or(&reference)
        .to_string();
    let mut candidates = vec![reference];

    if candidates[0] != leaf {
        candidates.push(leaf);
    }

    Some(RouteTarget { candidates })
}
