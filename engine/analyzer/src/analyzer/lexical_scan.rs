//! Small iterative delimiter helpers shared by lightweight language analyzers.
//!
//! These helpers preserve the language modules' parser-independent boundary;
//! they only understand balanced bracket shapes and never infer declarations.

/// Splits text on a delimiter only when bracket nesting is at the top level.
pub(super) fn split_top_level(text: &str, delimiter: u8) -> impl Iterator<Item = &str> {
    let bytes = text.as_bytes();
    let mut start = 0usize;
    let mut index = 0usize;
    let mut round_depth = 0usize;
    let mut square_depth = 0usize;
    let mut brace_depth = 0usize;

    std::iter::from_fn(move || {
        while index <= bytes.len() {
            let at_end = index == bytes.len();
            let at_delimiter = !at_end
                && bytes[index] == delimiter
                && round_depth == 0
                && square_depth == 0
                && brace_depth == 0;

            if at_end || at_delimiter {
                let segment = &text[start..index];
                index += 1;
                start = index;
                return Some(segment);
            }

            match bytes[index] {
                b'(' => round_depth += 1,
                b')' => round_depth = round_depth.saturating_sub(1),
                b'[' => square_depth += 1,
                b']' => square_depth = square_depth.saturating_sub(1),
                b'{' => brace_depth += 1,
                b'}' => brace_depth = brace_depth.saturating_sub(1),
                _ => {}
            }
            index += 1;
        }

        None
    })
}

/// Finds a balanced closing delimiter without recursive traversal.
pub(super) fn find_matching_close(
    text: &str,
    open_index: usize,
    open: u8,
    close: u8,
) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut depth = 0usize;

    for (index, byte) in bytes.iter().enumerate().skip(open_index) {
        if *byte == open {
            depth += 1;
        } else if *byte == close {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return Some(index);
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_only_top_level_delimiters() {
        assert_eq!(
            split_top_level("first, factory(a, b), [c, d]", b',').collect::<Vec<_>>(),
            vec!["first", " factory(a, b)", " [c, d]"]
        );
    }

    #[test]
    fn finds_balanced_closing_delimiter() {
        let source = "call(first(), second)";
        assert_eq!(find_matching_close(source, 4, b'(', b')'), Some(20));
    }
}
