//! Shared JavaScript/TypeScript syntax helpers for backend framework adapters.

use std::path::Path;

use crate::model::{utf16_code_unit_len, utf16_column_from_byte_offset, SourceRange};

/// Decorator call captured before a class or method declaration.
pub(super) struct Decorator {
    pub(super) name: String,
    pub(super) arguments: Option<String>,
    pub(super) range: SourceRange,
}

pub(super) fn find_member_call_open(source: &str, owner: &str, method: &str) -> Option<usize> {
    let target = format!("{owner}.{method}");
    let mut search_start = 0usize;

    while let Some(relative) = source[search_start..].find(&target) {
        let start = search_start + relative;
        let after = start + target.len();
        let before = source[..start].chars().next_back();

        if !is_identifier_character(before) {
            let rest = &source[after..];
            let whitespace = rest.len() - rest.trim_start().len();
            if rest[whitespace..].starts_with('(') {
                return Some(after + whitespace);
            }
        }

        search_start = after;
    }

    None
}

pub(super) fn call_arguments_at(source: &str, open_index: usize) -> Option<String> {
    let close = source.rfind(')')?;
    (close > open_index).then(|| source[open_index + 1..close].to_string())
}

pub(super) fn split_top_level_arguments(arguments: &str) -> Vec<String> {
    arguments
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

pub(super) fn read_string_literal_value(argument: &str) -> Option<String> {
    let source = argument.trim_start();
    let quote = source.chars().next()?;
    if !matches!(quote, '\'' | '"' | '`') {
        return None;
    }

    let mut escaped = false;
    let mut value = String::new();
    for character in source[quote.len_utf8()..].chars() {
        if escaped {
            value.push(character);
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == quote {
            return (quote != '`' || !value.contains("${")).then_some(value);
        } else {
            value.push(character);
        }
    }
    None
}

pub(super) fn delimiter_delta(line: &str) -> isize {
    let mut delta = 0isize;

    for character in line.chars() {
        match character {
            '(' | '[' | '{' => delta += 1,
            ')' | ']' | '}' => delta -= 1,
            _ => {}
        }
    }

    delta
}

pub(super) fn keyword_identifier(source: &str, keyword: &str) -> Option<String> {
    let mut search_start = 0usize;

    while let Some(relative) = source[search_start..].find(keyword) {
        let start = search_start + relative;
        let end = start + keyword.len();
        let before = source[..start].chars().next_back();
        let after = source[end..].chars().next();

        if !is_identifier_character(before)
            && after.map(|value| value.is_whitespace()).unwrap_or(false)
        {
            let name_source = source[end..].trim_start();
            let name_end = name_source
                .find(|character: char| {
                    !(character == '_' || character == '$' || character.is_ascii_alphanumeric())
                })
                .unwrap_or(name_source.len());
            let name = &name_source[..name_end];
            if is_js_identifier(name) {
                return Some(name.to_string());
            }
        }

        search_start = end;
    }

    None
}

pub(super) fn is_js_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };

    (first == '_' || first == '$' || first.is_ascii_alphabetic())
        && characters.all(|character| {
            character == '_' || character == '$' || character.is_ascii_alphanumeric()
        })
}

pub(super) fn is_identifier_character(character: Option<char>) -> bool {
    character
        .map(|value| value == '_' || value == '$' || value.is_ascii_alphanumeric())
        .unwrap_or(false)
}

pub(super) fn js_module_name(root: &Path, file_path: &Path) -> String {
    let path_without_extension = file_path.with_extension("");
    let relative = path_without_extension
        .strip_prefix(root)
        .unwrap_or(&path_without_extension);
    let parts = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str().map(|part| part.to_string()))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    if parts.is_empty() {
        "module".to_string()
    } else {
        parts.join(".")
    }
}

pub(super) fn normalized_relative_path(base: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(base).unwrap_or(path);

    if relative.as_os_str().is_empty() {
        ".".to_string()
    } else {
        relative.to_string_lossy().replace('\\', "/")
    }
}

pub(super) fn range_with_decorator(range: &SourceRange, decorator: &Decorator) -> SourceRange {
    SourceRange {
        start_line: decorator.range.start_line,
        start_character: decorator.range.start_character,
        end_line: range.end_line,
        end_character: range.end_character,
    }
}

pub(super) fn line_range(line_index: usize, start_character: usize, line: &str) -> SourceRange {
    multi_line_range(line_index, start_character, line_index, line)
}

pub(super) fn multi_line_range(
    start_line: usize,
    start_character: usize,
    end_line: usize,
    end_line_text: &str,
) -> SourceRange {
    SourceRange {
        start_line,
        start_character,
        end_line,
        end_character: utf16_code_unit_len(end_line_text),
    }
}

pub(super) fn leading_width(line: &str) -> usize {
    let leading_byte_offset = line.len().saturating_sub(line.trim_start().len());
    utf16_column_from_byte_offset(line, leading_byte_offset)
}
