//! Function-local opaque binding collection for Python call resolution.
//!
//! Python determines local names from parameters and binding statements across
//! the whole function body. The line-oriented analyzer records that bounded
//! evidence per callable, then prevents only bare calls from resolving to an
//! unrelated same-file function. Qualified `self`/`cls` calls remain separate.

use std::collections::{BTreeMap, BTreeSet};

use super::super::lexical_scan::{find_matching_close, split_top_level};

/// Opaque local names and explicit global/nonlocal exclusions per callable.
#[derive(Default)]
pub(super) struct LexicalBindings {
    by_source_id: BTreeMap<String, BTreeSet<String>>,
    excluded_by_source_id: BTreeMap<String, BTreeSet<String>>,
}

impl LexicalBindings {
    /// Registers parameters from one supported single-line function signature.
    pub(super) fn register_parameters(&mut self, source_id: &str, code_line: &str) {
        let names = collect_parameter_names(code_line);
        self.by_source_id
            .entry(source_id.to_string())
            .or_default()
            .extend(names);
    }

    /// Records local binding statements observed in one callable body line.
    pub(super) fn collect_line(&mut self, source_id: &str, code_line: &str) {
        let exclusions = collect_scope_exclusions(code_line);
        if !exclusions.is_empty() {
            let excluded = self
                .excluded_by_source_id
                .entry(source_id.to_string())
                .or_default();
            let bindings = self.by_source_id.entry(source_id.to_string()).or_default();

            for name in exclusions {
                bindings.remove(&name);
                excluded.insert(name);
            }
        }

        let names = collect_local_names(code_line);
        let excluded = self.excluded_by_source_id.get(source_id);
        let bindings = self.by_source_id.entry(source_id.to_string()).or_default();

        for name in names {
            if excluded.is_some_and(|values| values.contains(&name)) {
                continue;
            }
            bindings.insert(name);
        }
    }

    /// Returns whether a bare call name is owned by an opaque local binding.
    pub(super) fn shadows(&self, source_id: &str, name: &str) -> bool {
        self.by_source_id
            .get(source_id)
            .is_some_and(|bindings| bindings.contains(name))
    }
}

/// Collects direct parameter names while ignoring annotations and defaults.
fn collect_parameter_names(code_line: &str) -> Vec<String> {
    let Some(open_index) = code_line.find('(') else {
        return Vec::new();
    };
    let Some(close_index) = find_matching_close(code_line, open_index, b'(', b')') else {
        return Vec::new();
    };

    split_top_level(&code_line[open_index + 1..close_index], b',')
        .filter_map(read_parameter_name)
        .collect()
}

/// Collects direct assignments, loop/alias targets, and local import names.
fn collect_local_names(code_line: &str) -> Vec<String> {
    let code = code_line.trim();
    if code.is_empty() {
        return Vec::new();
    }

    if let Some(names) = collect_import_names(code) {
        return names;
    }

    let mut names = Vec::new();

    if let Some(targets) = code
        .strip_prefix("for ")
        .and_then(|remainder| remainder.split_once(" in ").map(|(targets, _)| targets))
    {
        names.extend(collect_direct_targets(targets));
    }

    if code.starts_with("with ") || code.starts_with("except ") {
        for alias in code.split(" as ").skip(1) {
            if let Some(name) = read_leading_identifier(alias.trim_start()) {
                names.push(name.to_string());
            }
        }
    }

    if let Some(assignment_index) = find_assignment_operator(code) {
        names.extend(collect_direct_targets(&code[..assignment_index]));
    }

    names
}

/// Reads names excluded from local binding rules by `global` or `nonlocal`.
fn collect_scope_exclusions(code_line: &str) -> Vec<String> {
    let code = code_line.trim();
    let Some(names) = code
        .strip_prefix("global ")
        .or_else(|| code.strip_prefix("nonlocal "))
    else {
        return Vec::new();
    };

    names
        .split(',')
        .filter_map(|name| read_leading_identifier(name.trim()).map(str::to_string))
        .collect()
}

/// Collects names introduced by one simple `import` or `from ... import` line.
fn collect_import_names(code: &str) -> Option<Vec<String>> {
    let imported = if let Some(remainder) = code.strip_prefix("import ") {
        remainder
    } else {
        code.strip_prefix("from ")?.split_once(" import ")?.1
    };

    Some(
        split_top_level(imported, b',')
            .filter_map(|part| {
                let part = part.trim();
                if part == "*" {
                    return None;
                }

                if let Some((_, alias)) = part.rsplit_once(" as ") {
                    return read_leading_identifier(alias.trim()).map(str::to_string);
                }

                read_leading_identifier(part).map(str::to_string)
            })
            .collect(),
    )
}

/// Collects simple identifier targets, including annotated and tuple targets.
fn collect_direct_targets(targets: &str) -> Vec<String> {
    let targets = targets.trim().trim_start_matches('(').trim_end_matches(')');

    split_top_level(targets, b',')
        .filter_map(read_assignment_target)
        .collect()
}

/// Reads one supported Python parameter identifier.
fn read_parameter_name(parameter: &str) -> Option<String> {
    let candidate = parameter.trim().trim_start_matches('*').trim_start();
    if candidate.is_empty() || candidate == "/" {
        return None;
    }

    read_leading_identifier(candidate).map(str::to_string)
}

/// Reads a direct assignment target and rejects attributes, subscripts, and calls.
fn read_assignment_target(target: &str) -> Option<String> {
    let candidate = target.trim().trim_start_matches('*').trim_start();
    let name = read_leading_identifier(candidate)?;
    let remainder = candidate[name.len()..].trim();

    if remainder.is_empty() || remainder.starts_with(':') {
        Some(name.to_string())
    } else {
        None
    }
}

/// Finds a Python assignment operator while excluding comparisons.
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

/// Returns the leading conservative ASCII Python identifier.
fn read_leading_identifier(text: &str) -> Option<&str> {
    let bytes = text.as_bytes();
    if !bytes.first().is_some_and(|byte| is_identifier_start(*byte)) {
        return None;
    }

    let mut end = 1usize;
    while end < bytes.len() && is_identifier_part(bytes[end]) {
        end += 1;
    }

    Some(&text[..end])
}

/// Returns whether a byte can begin a conservative Python identifier.
fn is_identifier_start(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphabetic()
}

/// Returns whether a byte can continue a conservative Python identifier.
fn is_identifier_part(byte: u8) -> bool {
    is_identifier_start(byte) || byte.is_ascii_digit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_parameters_without_annotation_or_default_names() {
        assert_eq!(
            collect_parameter_names(
                "def run(self, helper: Handler, count: int = factory(1), *args, **kwargs):"
            ),
            vec!["self", "helper", "count", "args", "kwargs"]
        );
    }

    #[test]
    fn collects_direct_bindings_and_rejects_member_assignments() {
        assert_eq!(
            collect_local_names("helper: Handler = factory()"),
            vec!["helper"]
        );
        assert_eq!(
            collect_local_names("first, second = values"),
            vec!["first", "second"]
        );
        assert!(collect_local_names("self.helper = factory()").is_empty());
        assert!(collect_local_names("use(helper=value)").is_empty());
    }

    #[test]
    fn collects_loop_alias_and_import_bindings() {
        assert_eq!(
            collect_local_names("for helper, count in values:"),
            vec!["helper", "count"]
        );
        assert_eq!(
            collect_local_names("with resource() as helper:"),
            vec!["helper"]
        );
        assert_eq!(
            collect_local_names("from tools import run as helper"),
            vec!["helper"]
        );
    }

    #[test]
    fn explicit_global_excludes_later_assignment_from_local_shadows() {
        let mut bindings = LexicalBindings::default();

        bindings.collect_line("run-id", "global helper");
        bindings.collect_line("run-id", "helper = replacement");

        assert!(!bindings.shadows("run-id", "helper"));
    }
}
