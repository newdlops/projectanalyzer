//! Function-local opaque binding collection for JavaScript-like call resolution.
//!
//! The lightweight frontend cannot resolve parameter or local variable values.
//! This module records those names per callable so bare calls do not incorrectly
//! bind to an unrelated same-file declaration. Member calls remain outside this
//! boundary because their receiver evidence follows a separate resolver path.

use std::collections::{BTreeMap, BTreeSet};

use super::super::lexical_scan::{find_matching_close, split_top_level};

/// Opaque lexical names grouped by the graph ID of their owning callable.
#[derive(Default)]
pub(super) struct LexicalBindings {
    by_source_id: BTreeMap<String, BTreeSet<String>>,
}

impl LexicalBindings {
    /// Registers parameters declared by one function, method, or arrow function.
    pub(super) fn register_parameters(
        &mut self,
        source_id: &str,
        code_line: &str,
        declaration_name: &str,
    ) {
        let names = collect_parameter_names(code_line, declaration_name);
        self.by_source_id
            .entry(source_id.to_string())
            .or_default()
            .extend(names);
    }

    /// Records direct local declarations visible to one callable.
    pub(super) fn collect_line(
        &mut self,
        source_id: &str,
        code_line: &str,
        declared_callable_name: Option<&str>,
    ) {
        let names = collect_local_names(code_line);
        let bindings = self.by_source_id.entry(source_id.to_string()).or_default();

        for name in names {
            // Function-like variable declarations have a real SymbolRecord and
            // should continue through normal lexical callable resolution.
            if declared_callable_name == Some(name.as_str()) {
                continue;
            }

            bindings.insert(name);
        }
    }

    /// Returns whether a bare name is known to resolve to an opaque local value.
    pub(super) fn shadows(&self, source_id: &str, name: &str) -> bool {
        self.by_source_id
            .get(source_id)
            .is_some_and(|bindings| bindings.contains(name))
    }
}

/// Collects direct parameter identifiers from one supported declaration line.
fn collect_parameter_names(code_line: &str, declaration_name: &str) -> Vec<String> {
    let Some(parameter_text) = parameter_text(code_line, declaration_name) else {
        return Vec::new();
    };

    split_top_level(parameter_text, b',')
        .filter_map(read_direct_binding_name)
        .collect()
}

/// Returns the parameter segment for a named or arrow-style declaration.
fn parameter_text<'a>(code_line: &'a str, declaration_name: &str) -> Option<&'a str> {
    if let Some(arrow_index) = code_line.find("=>") {
        let prefix = code_line[..arrow_index].trim_end();

        if prefix.ends_with(')') {
            let open_index = find_matching_open_paren(prefix)?;
            return Some(&prefix[open_index + 1..prefix.len() - 1]);
        }

        let name_start = prefix
            .as_bytes()
            .iter()
            .rposition(|byte| !is_identifier_part(*byte))
            .map(|index| index + 1)
            .unwrap_or_default();
        let parameter = &prefix[name_start..];
        return (!parameter.is_empty()).then_some(parameter);
    }

    let declaration_index = find_identifier(code_line, declaration_name)?;
    let open_index = code_line[declaration_index + declaration_name.len()..].find('(')?
        + declaration_index
        + declaration_name.len();
    let close_index = find_matching_close(code_line, open_index, b'(', b')')?;
    Some(&code_line[open_index + 1..close_index])
}

/// Collects direct `const`/`let`/`var` and catch-clause bindings on one line.
fn collect_local_names(code_line: &str) -> Vec<String> {
    let mut names = Vec::new();

    for keyword in ["const", "let", "var"] {
        let mut search_start = 0usize;

        while let Some(keyword_index) = find_word_from(code_line, keyword, search_start) {
            let declaration_start = keyword_index + keyword.len();
            let declaration_end = code_line[declaration_start..]
                .find(';')
                .map(|offset| declaration_start + offset)
                .unwrap_or(code_line.len());
            let declaration = &code_line[declaration_start..declaration_end];

            for segment in split_top_level(declaration, b',') {
                if let Some(name) = read_direct_binding_name(segment) {
                    names.push(name);
                }
            }

            search_start = declaration_end.saturating_add(1);
        }
    }

    if let Some(catch_index) = find_word_from(code_line, "catch", 0) {
        if let Some(relative_open) = code_line[catch_index + "catch".len()..].find('(') {
            let open_index = catch_index + "catch".len() + relative_open;

            if let Some(close_index) = find_matching_close(code_line, open_index, b'(', b')') {
                if let Some(name) =
                    read_direct_binding_name(&code_line[open_index + 1..close_index])
                {
                    names.push(name);
                }
            }
        }
    }

    names
}

/// Reads a simple identifier binding while rejecting member/destructuring targets.
fn read_direct_binding_name(segment: &str) -> Option<String> {
    let mut candidate = segment.trim();

    while let Some(stripped) = candidate.strip_prefix("...") {
        candidate = stripped.trim_start();
    }

    loop {
        let (word, remainder) = take_identifier(candidate)?;

        if matches!(word, "public" | "private" | "protected" | "readonly") {
            candidate = remainder.trim_start();
            continue;
        }

        return Some(word.to_string());
    }
}

/// Finds a whole identifier from one byte offset.
fn find_word_from(text: &str, expected: &str, start: usize) -> Option<usize> {
    for (relative_index, _) in text[start..].match_indices(expected) {
        let index = start + relative_index;
        let before_valid = index == 0 || !is_identifier_part(text.as_bytes()[index - 1]);
        let after_index = index + expected.len();
        let after_valid = text
            .as_bytes()
            .get(after_index)
            .map(|byte| !is_identifier_part(*byte))
            .unwrap_or(true);

        if before_valid && after_valid {
            return Some(index);
        }
    }

    None
}

/// Finds an exact identifier in source text.
fn find_identifier(text: &str, expected: &str) -> Option<usize> {
    find_word_from(text, expected, 0)
}

/// Finds the opening parenthesis paired with a trailing closing parenthesis.
fn find_matching_open_paren(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut depth = 0usize;

    for index in (0..bytes.len()).rev() {
        match bytes[index] {
            b')' => depth += 1,
            b'(' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }

    None
}

/// Returns one leading JavaScript identifier and the remaining text.
fn take_identifier(text: &str) -> Option<(&str, &str)> {
    let bytes = text.as_bytes();
    if !bytes.first().is_some_and(|byte| is_identifier_start(*byte)) {
        return None;
    }

    let mut end = 1usize;
    while end < bytes.len() && is_identifier_part(bytes[end]) {
        end += 1;
    }

    Some((&text[..end], &text[end..]))
}

/// Returns whether a byte can begin a supported JavaScript identifier.
fn is_identifier_start(byte: u8) -> bool {
    byte == b'_' || byte == b'$' || byte.is_ascii_alphabetic()
}

/// Returns whether a byte can continue a supported JavaScript identifier.
fn is_identifier_part(byte: u8) -> bool {
    is_identifier_start(byte) || byte.is_ascii_digit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_named_arrow_and_method_parameters() {
        assert_eq!(
            collect_parameter_names("function run(helper, count = 1) {", "run"),
            vec!["helper", "count"]
        );
        assert_eq!(
            collect_parameter_names("const run = async (helper: Handler) => {", "run"),
            vec!["helper"]
        );
        assert_eq!(
            collect_parameter_names("run(private helper: Handler) {", "run"),
            vec!["helper"]
        );
    }

    #[test]
    fn collects_simple_locals_without_member_targets() {
        assert_eq!(
            collect_local_names("for (const helper of helpers) { let count = 1; }"),
            vec!["helper", "count"]
        );
        assert_eq!(
            collect_local_names("catch (failure) { this.value = 1; }"),
            vec!["failure"]
        );
    }
}
