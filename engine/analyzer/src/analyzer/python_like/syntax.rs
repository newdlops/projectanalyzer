//! Stateful Python lexical masking for lightweight analyzer passes.
//!
//! Public surface: `PythonSyntaxSnapshot` provides an offset-preserving,
//! code-only source view, while `scan_workspace_sources` creates snapshots that
//! import, binding, and shadow passes can share. The implementation is iterative
//! and intentionally masks string contents instead of attempting a Python AST.

use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::model::SourceInput;

/// Offset-preserving Python source with comments and string literals masked.
pub(in crate::analyzer) struct PythonSyntaxSnapshot {
    /// Masked UTF-8 source; byte offsets and line endings match the input.
    code: String,
}

impl PythonSyntaxSnapshot {
    /// Scans one source file into a reusable code-only snapshot.
    pub(in crate::analyzer) fn new(source: &str) -> Self {
        let mut scanner = SyntaxScanner::default();
        Self {
            code: scanner.scan_source(source),
        }
    }

    /// Iterates masked lines with the same indices and byte offsets as source lines.
    pub(in crate::analyzer) fn lines(&self) -> std::str::Lines<'_> {
        self.code.lines()
    }
}

/// Workspace snapshots keyed by the exact source path used by graph nodes.
pub(in crate::analyzer) type PythonSyntaxSnapshots = BTreeMap<PathBuf, PythonSyntaxSnapshot>;

/// Builds the shared code-only views used by Python workspace analysis passes.
pub(in crate::analyzer) fn scan_workspace_sources(files: &[SourceInput]) -> PythonSyntaxSnapshots {
    files
        .iter()
        .filter(|file| file.language_id == "python")
        .map(|file| (file.path.clone(), PythonSyntaxSnapshot::new(&file.content)))
        .collect()
}

/// Stateful, non-recursive scanner for Python comments and quoted strings.
#[derive(Default)]
struct SyntaxScanner {
    /// Active literal crosses lines only for triple quotes or `\\` continuations.
    active_string: Option<ActiveString>,
}

impl SyntaxScanner {
    /// Masks a complete source while preserving its original line endings.
    fn scan_source(&mut self, source: &str) -> String {
        let mut output = String::with_capacity(source.len());

        for segment in source.split_inclusive('\n') {
            let (line, ending) = split_line_ending(segment);
            output.push_str(&self.scan_line(line));
            output.push_str(ending);
        }

        output
    }

    /// Masks one physical line and carries valid multiline literal state forward.
    fn scan_line(&mut self, line: &str) -> String {
        let source = line.as_bytes();
        let mut output = source.to_vec();
        let mut cursor = 0usize;

        while cursor < source.len() {
            if let Some(mut active) = self.active_string {
                if active.escaped {
                    output[cursor] = b' ';
                    active.escaped = false;
                    self.active_string = Some(active);
                    cursor += 1;
                    continue;
                }

                if source[cursor] == b'\\' {
                    output[cursor] = b' ';
                    active.escaped = true;
                    self.active_string = Some(active);
                    cursor += 1;
                    continue;
                }

                if active.triple && has_triple_quote(source, cursor, active.quote) {
                    mask_bytes(&mut output, cursor, 3);
                    self.active_string = None;
                    cursor += 3;
                    continue;
                }

                output[cursor] = b' ';
                if !active.triple && source[cursor] == active.quote {
                    self.active_string = None;
                }
                cursor += 1;
                continue;
            }

            match source[cursor] {
                b'#' => {
                    mask_bytes(&mut output, cursor, source.len() - cursor);
                    break;
                }
                quote @ (b'\'' | b'"') => {
                    let triple = has_triple_quote(source, cursor, quote);
                    let delimiter_length = if triple { 3 } else { 1 };
                    let prefix_start = string_prefix_start(source, cursor);
                    mask_bytes(&mut output, prefix_start, cursor - prefix_start);
                    mask_bytes(&mut output, cursor, delimiter_length);
                    self.active_string = Some(ActiveString {
                        quote,
                        triple,
                        escaped: false,
                    });
                    cursor += delimiter_length;
                }
                _ => cursor += 1,
            }
        }

        self.finish_physical_line();
        String::from_utf8(output).expect("masking preserves valid UTF-8")
    }

    /// Applies Python's physical-line boundary behavior to an open literal.
    fn finish_physical_line(&mut self) {
        let Some(mut active) = self.active_string else {
            return;
        };

        if active.triple {
            active.escaped = false;
            self.active_string = Some(active);
        } else if active.escaped {
            // A trailing backslash continues a single-quoted literal next line.
            active.escaped = false;
            self.active_string = Some(active);
        } else {
            // Invalid unterminated literals must not hide the remainder of a file.
            self.active_string = None;
        }
    }
}

/// Delimiter state for one active single- or triple-quoted literal.
#[derive(Clone, Copy)]
struct ActiveString {
    quote: u8,
    triple: bool,
    escaped: bool,
}

/// Separates a physical line from `\n` or `\r\n` without shifting offsets.
fn split_line_ending(segment: &str) -> (&str, &str) {
    if let Some(line) = segment.strip_suffix("\r\n") {
        (line, "\r\n")
    } else if let Some(line) = segment.strip_suffix('\n') {
        (line, "\n")
    } else {
        (segment, "")
    }
}

/// Returns whether `start` begins three matching quote bytes.
fn has_triple_quote(source: &[u8], start: usize, quote: u8) -> bool {
    source.get(start..start.saturating_add(3)) == Some(&[quote, quote, quote])
}

/// Includes a valid Python string prefix in the masked token range.
fn string_prefix_start(source: &[u8], quote_index: usize) -> usize {
    let mut start = quote_index;

    while start > 0
        && quote_index.saturating_sub(start) < 2
        && source[start - 1].is_ascii_alphabetic()
    {
        start -= 1;
    }

    let prefix = source[start..quote_index]
        .iter()
        .map(u8::to_ascii_lowercase)
        .collect::<Vec<_>>();
    let valid_prefix = matches!(
        prefix.as_slice(),
        [] | [b'b' | b'f' | b'r' | b't' | b'u']
            | [b'b', b'r']
            | [b'r', b'b']
            | [b'f', b'r']
            | [b'r', b'f']
            | [b't', b'r']
            | [b'r', b't']
    );
    let boundary_valid = start == 0 || !is_identifier_part(source[start - 1]);

    if valid_prefix && boundary_valid {
        start
    } else {
        quote_index
    }
}

/// Replaces exactly `length` bytes with ASCII spaces.
fn mask_bytes(output: &mut [u8], start: usize, length: usize) {
    for byte in output.iter_mut().skip(start).take(length) {
        *byte = b' ';
    }
}

/// Returns whether a byte can continue the conservative ASCII identifiers.
fn is_identifier_part(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphanumeric()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_single_double_strings_and_comments_without_moving_offsets() {
        let source = "first = 'ghost_one()'; real_one()  # tail()\nsecond = r\"ghost_two() 한글\"; real_two()\n";
        let snapshot = PythonSyntaxSnapshot::new(source);

        assert_eq!(snapshot.code.len(), source.len());
        assert!(!snapshot.code.contains("ghost_one"));
        assert!(!snapshot.code.contains("ghost_two"));
        assert!(!snapshot.code.contains("tail"));
        assert!(snapshot.code.contains("real_one()"));
        assert!(snapshot.code.contains("real_two()"));
        assert_eq!(snapshot.code.find("real_two"), source.find("real_two"));
    }

    #[test]
    fn masks_triple_quoted_blocks_and_preserves_following_code() {
        let source = "\"\"\"\ndef documented():\n    import hidden\n    ghost()\n\"\"\"\ndef real():\n    return visible()\n";
        let snapshot = PythonSyntaxSnapshot::new(source);

        assert_eq!(snapshot.code.lines().count(), source.lines().count());
        assert!(!snapshot.code.contains("documented"));
        assert!(!snapshot.code.contains("hidden"));
        assert!(!snapshot.code.contains("ghost"));
        assert!(snapshot.code.contains("def real():"));
        assert!(snapshot.code.contains("visible()"));
    }

    #[test]
    fn carries_backslash_continued_strings_across_physical_lines() {
        let source = "value = \"hidden\\\nstill_hidden()\"\nreal_call()\n";
        let snapshot = PythonSyntaxSnapshot::new(source);

        assert!(!snapshot.code.contains("still_hidden"));
        assert!(snapshot.code.contains("real_call()"));
        assert_eq!(snapshot.code.len(), source.len());
    }

    #[test]
    fn preserves_crlf_line_boundaries() {
        let source = "value = \"hidden()\"\r\nreal_call()\r\n";
        let snapshot = PythonSyntaxSnapshot::new(source);
        let original_lines: Vec<&str> = source.lines().collect();
        let masked_lines: Vec<&str> = snapshot.lines().collect();

        assert_eq!(masked_lines.len(), original_lines.len());
        assert_eq!(masked_lines[0].len(), original_lines[0].len());
        assert_eq!(masked_lines[1], "real_call()");
    }
}
