//! Shared graph model for the Rust engine.
//!
//! Field names intentionally match the TypeScript ProjectGraph model consumed by
//! the VS Code Webview.

use std::path::PathBuf;

/// Source file snapshot analyzed by language modules.
#[derive(Clone)]
pub struct SourceInput {
    pub path: PathBuf,
    pub language_id: String,
    pub content: String,
    pub size_bytes: usize,
}

/// Zero-based source range matching VS Code position semantics.
#[derive(Clone)]
pub struct SourceRange {
    pub start_line: usize,
    pub start_character: usize,
    pub end_line: usize,
    pub end_character: usize,
}

/// Returns the number of UTF-16 code units used by a source fragment.
///
/// VS Code positions count UTF-16 code units rather than UTF-8 bytes or
/// Unicode scalar values, so astral characters such as emoji count as two.
pub fn utf16_code_unit_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Converts an offset-preserving scanner's UTF-8 byte index to a VS Code column.
///
/// Scanner internals intentionally keep byte offsets for cheap slicing. The
/// public graph boundary calls this helper with the original source line so
/// masked multibyte characters cannot distort the resulting UTF-16 position.
pub fn utf16_column_from_byte_offset(line: &str, byte_offset: usize) -> usize {
    let mut boundary = byte_offset.min(line.len());

    // Best-effort analyzers should not panic if a future scanner reports an
    // interior byte. Clamp to the preceding character boundary instead.
    while !line.is_char_boundary(boundary) {
        boundary = boundary.saturating_sub(1);
    }

    utf16_code_unit_len(&line[..boundary])
}

/// Graph node stored in the serialized project graph.
#[derive(Clone)]
pub struct SymbolNode {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub qualified_name: String,
    pub file_path: String,
    pub range: SourceRange,
    pub selection_range: SourceRange,
    pub language: String,
    pub parent_id: Option<String>,
    pub size_bytes: Option<usize>,
}

/// Directed graph edge stored in the serialized project graph.
#[derive(Clone)]
pub struct GraphEdge {
    pub id: String,
    pub kind: String,
    pub source_id: String,
    pub target_id: String,
    pub file_path: String,
    pub range: SourceRange,
    pub confidence: String,
}

/// Analysis diagnostic captured without aborting the whole run.
#[derive(Clone)]
pub struct AnalysisDiagnostic {
    pub severity: String,
    pub code: String,
    pub message: String,
    pub file_path: Option<String>,
}

/// File-count summary for one detected implementation language.
#[derive(Clone)]
pub struct LanguageSummary {
    pub language: String,
    pub file_count: usize,
    pub percentage: f64,
}

/// Static framework or tool detection captured from workspace manifests.
#[derive(Clone)]
pub struct DetectedFramework {
    pub name: String,
    pub ecosystem: String,
    pub category: String,
    pub confidence: String,
    pub root_path: Option<String>,
    pub evidence: Vec<String>,
}

/// Framework-aware semantic unit derived from framework conventions.
#[derive(Clone)]
pub struct FrameworkUnit {
    pub id: String,
    pub framework: String,
    pub kind: String,
    pub name: String,
    pub qualified_name: String,
    pub root_path: String,
    pub file_path: String,
    pub range: SourceRange,
    pub parent_id: Option<String>,
}

/// Relationship between framework semantic units.
#[derive(Clone)]
pub struct FrameworkUnitEdge {
    pub id: String,
    pub kind: String,
    pub source_id: String,
    pub target_id: String,
    pub file_path: String,
    pub range: SourceRange,
    pub confidence: String,
}

/// Final project graph emitted to the extension host.
pub struct ProjectGraph {
    pub workspace_root: String,
    pub version: String,
    pub generated_at: String,
    pub nodes: Vec<SymbolNode>,
    pub edges: Vec<GraphEdge>,
    pub framework_units: Vec<FrameworkUnit>,
    pub framework_unit_edges: Vec<FrameworkUnitEdge>,
    pub diagnostics: Vec<AnalysisDiagnostic>,
    pub languages: Vec<String>,
    pub language_summary: Vec<LanguageSummary>,
    pub frameworks: Vec<DetectedFramework>,
    pub file_count: usize,
}

/// Returns a full-file range for a source text snapshot.
pub fn full_content_range(content: &str) -> SourceRange {
    let mut line_count = 0usize;
    let mut last_line_len = 0usize;

    for line in content.split('\n') {
        line_count += 1;
        last_line_len = utf16_code_unit_len(line.trim_end_matches('\r'));
    }

    SourceRange {
        start_line: 0,
        start_character: 0,
        end_line: line_count.saturating_sub(1),
        end_character: last_line_len,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_utf8_offsets_to_vscode_utf16_columns() {
        let line = "한글😀target";
        let target_byte_offset = line.find("target").expect("target exists");

        assert_eq!(utf16_column_from_byte_offset(line, target_byte_offset), 4);
        assert_eq!(utf16_code_unit_len(line), 10);
    }

    #[test]
    fn preserves_ascii_offset_contract() {
        assert_eq!(utf16_column_from_byte_offset("  target", 2), 2);
        assert_eq!(utf16_code_unit_len("  target"), 8);
    }

    #[test]
    fn full_content_range_uses_utf16_length_on_the_last_line() {
        let range = full_content_range("first\n한글😀");

        assert_eq!(range.end_line, 1);
        assert_eq!(range.end_character, 4);
    }
}
