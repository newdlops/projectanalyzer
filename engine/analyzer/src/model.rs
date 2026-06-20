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
        last_line_len = line.trim_end_matches('\r').chars().count();
    }

    SourceRange {
        start_line: 0,
        start_character: 0,
        end_line: line_count.saturating_sub(1),
        end_character: last_line_len,
    }
}
