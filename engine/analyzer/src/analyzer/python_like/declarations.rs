//! Conservative Python class and function declaration recognition.
//!
//! This module owns declaration token boundaries so symbol extraction cannot
//! confuse ordinary identifiers such as `default_value` or `classify` with
//! `def` and `class` statements.

/// Supported declaration returned to the indentation-based symbol extractor.
pub(super) struct Declaration {
    pub(super) kind: &'static str,
    pub(super) name: String,
}

/// Detects a class, synchronous function, or asynchronous function declaration.
pub(super) fn detect_declaration(trimmed_code: &str) -> Option<Declaration> {
    if let Some(name) = read_declared_name(trimmed_code, "class", DeclarationKind::Class) {
        return Some(Declaration {
            kind: "class",
            name,
        });
    }

    if let Some(name) = read_declared_name(trimmed_code, "async def", DeclarationKind::Function) {
        return Some(Declaration {
            kind: "function",
            name,
        });
    }

    read_declared_name(trimmed_code, "def", DeclarationKind::Function).map(|name| Declaration {
        kind: "function",
        name,
    })
}

/// Supported signature delimiter rules after one declared identifier.
#[derive(Clone, Copy)]
enum DeclarationKind {
    Class,
    Function,
}

/// Reads one ASCII identifier after a whole declaration keyword and validates its signature.
fn read_declared_name(
    line: &str,
    keyword: &str,
    declaration_kind: DeclarationKind,
) -> Option<String> {
    let remainder = line.strip_prefix(keyword)?;
    let first = *remainder.as_bytes().first()?;

    if !first.is_ascii_whitespace() {
        return None;
    }

    let declaration = remainder.trim_start();
    let bytes = declaration.as_bytes();
    let first_name_byte = *bytes.first()?;

    if !is_identifier_start(first_name_byte) {
        return None;
    }

    let mut end = 1usize;
    while end < bytes.len() && is_identifier_part(bytes[end]) {
        end += 1;
    }

    let signature = declaration[end..].trim_start();
    let valid_signature = match declaration_kind {
        DeclarationKind::Class => signature.starts_with([':', '(', '[']),
        DeclarationKind::Function => signature.starts_with(['(', '[']),
    };

    valid_signature.then(|| declaration[..end].to_string())
}

/// Returns whether a byte can begin a conservative ASCII Python identifier.
fn is_identifier_start(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphabetic()
}

/// Returns whether a byte can continue a conservative ASCII Python identifier.
fn is_identifier_part(byte: u8) -> bool {
    is_identifier_start(byte) || byte.is_ascii_digit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_supported_declarations_and_signature_spacing() {
        let declarations = [
            ("class Service:", "class", "Service"),
            ("class Generic[T]:", "class", "Generic"),
            ("def run ():", "function", "run"),
            ("async def load():", "function", "load"),
        ];

        for (source, expected_kind, expected_name) in declarations {
            let declaration = detect_declaration(source).expect("supported declaration");
            assert_eq!(declaration.kind, expected_kind);
            assert_eq!(declaration.name, expected_name);
        }
    }

    #[test]
    fn rejects_keyword_prefixes_and_malformed_signatures() {
        for source in [
            "default_value = 1",
            "classify()",
            "definition()",
            "def 123bad():",
            "def missing_signature:",
            "class MissingSignature",
        ] {
            assert!(
                detect_declaration(source).is_none(),
                "unexpected declaration: {source}"
            );
        }
    }
}
