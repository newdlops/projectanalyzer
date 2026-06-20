//! Syntax frontend for lightweight JavaScript-like analysis.
//!
//! The current implementation is intentionally line-oriented, but it exposes a
//! scanner boundary so a real AST frontend can replace masking and brace
//! tracking without changing declaration or call graph construction.

/// Stateful scanner that converts source lines into code-only analysis lines.
#[derive(Default)]
pub(super) struct SyntaxScanner {
    /** Tracks multiline block comments while preserving source byte offsets. */
    mask_state: LineMaskState,

    /** Brace depth at the start of the next line to scan. */
    brace_depth: isize,
}

impl SyntaxScanner {
    /// Masks a source line and updates scanner state for the next line.
    pub(super) fn scan_line(&mut self, _line_index: usize, line: &str) -> SyntaxLine {
        let start_brace_depth = self.brace_depth;
        let code = mask_non_code(line, &mut self.mask_state);
        let trimmed_start_character = code.len().saturating_sub(code.trim_start().len());

        self.brace_depth += count_braces(&code);

        SyntaxLine {
            code,
            trimmed_start_character,
            start_brace_depth,
        }
    }
}

/// Code-only view of one source line used by declaration and call extraction.
pub(super) struct SyntaxLine {
    /** Original byte offsets preserved, with comments and strings masked. */
    code: String,

    /** First non-whitespace byte in the masked line. */
    trimmed_start_character: usize,

    /** Brace depth before this line is applied. */
    start_brace_depth: isize,
}

impl SyntaxLine {
    /// Returns masked code with original byte offsets preserved.
    pub(super) fn code(&self) -> &str {
        &self.code
    }

    /// Returns masked code after leading whitespace.
    pub(super) fn trimmed_code(&self) -> &str {
        self.code.trim_start()
    }

    /// Returns the first non-whitespace byte in the masked line.
    pub(super) fn trimmed_start_character(&self) -> usize {
        self.trimmed_start_character
    }

    /// Returns the brace depth before this line is applied.
    pub(super) fn start_brace_depth(&self) -> isize {
        self.start_brace_depth
    }
}

/// State carried while masking comments across line boundaries.
#[derive(Default)]
struct LineMaskState {
    in_block_comment: bool,
    string_delimiter: Option<char>,
    escaped: bool,
}

/// Masks comments and string contents while preserving byte offsets.
fn mask_non_code(line: &str, state: &mut LineMaskState) -> String {
    let mut output = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();

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

        if let Some(delimiter) = state.string_delimiter {
            push_masked_character(&mut output, character);

            if state.escaped {
                state.escaped = false;
            } else if character == '\\' {
                state.escaped = true;
            } else if character == delimiter {
                state.string_delimiter = None;
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

/// Counts brace depth changes on a masked code line.
fn count_braces(line: &str) -> isize {
    let mut depth = 0isize;

    for character in line.chars() {
        if character == '{' {
            depth += 1;
        } else if character == '}' {
            depth -= 1;
        }
    }

    depth
}

/// Appends spaces matching the UTF-8 width of a masked character.
fn push_masked_character(output: &mut String, character: char) {
    for _ in 0..character.len_utf8() {
        output.push(' ');
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_strings_and_comments_without_moving_offsets() {
        let mut scanner = SyntaxScanner::default();
        let original = "const call = \"ignored()\"; // tail()";
        let line = scanner.scan_line(0, original);

        assert_eq!(line.code().len(), original.len());
        assert!(line.code().contains("const call"));
        assert!(!line.code().contains("ignored()"));
        assert!(!line.code().contains("tail()"));
    }

    #[test]
    fn tracks_block_comment_state_across_lines() {
        let mut scanner = SyntaxScanner::default();
        let first = scanner.scan_line(0, "/* hidden(");
        let second = scanner.scan_line(1, "stillHidden(); */ visible();");

        assert!(!first.code().contains("hidden"));
        assert!(!second.code().contains("stillHidden"));
        assert!(second.code().contains("visible();"));
    }

    #[test]
    fn masks_template_strings_across_lines() {
        let mut scanner = SyntaxScanner::default();
        let first = scanner.scan_line(0, "const html = `");
        let second = scanner.scan_line(1, "  fakeCall();");
        let third = scanner.scan_line(2, "`;");
        let fourth = scanner.scan_line(3, "realCall();");

        assert!(!first.code().contains('`'));
        assert!(!second.code().contains("fakeCall"));
        assert!(!third.code().contains('`'));
        assert!(fourth.code().contains("realCall();"));
    }
}
