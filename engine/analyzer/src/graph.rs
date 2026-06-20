//! Graph builder for the Rust analyzer engine.
//!
//! The builder centralizes graph identity and contains-edge construction so
//! language analyzers can remain focused on syntax recognition.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::model::{
    full_content_range, AnalysisDiagnostic, GraphEdge, ProjectGraph, SourceInput, SourceRange,
    SymbolNode,
};

/// Mutable graph builder used during one analysis run.
pub struct ProjectGraphBuilder {
    workspace_root: PathBuf,
    nodes: Vec<SymbolNode>,
    edges: Vec<GraphEdge>,
    diagnostics: Vec<AnalysisDiagnostic>,
    languages: BTreeSet<String>,
    file_count: usize,
}

impl ProjectGraphBuilder {
    /// Creates a builder for one workspace root.
    pub fn new(workspace_root: PathBuf) -> Self {
        Self {
            workspace_root,
            nodes: Vec::new(),
            edges: Vec::new(),
            diagnostics: Vec::new(),
            languages: BTreeSet::new(),
            file_count: 0,
        }
    }

    /// Adds a source file node and returns its graph ID.
    pub fn add_file(&mut self, file: &SourceInput) -> String {
        self.file_count += 1;
        self.languages.insert(file.language_id.clone());
        let file_id = create_file_node_id(&file.path);
        let range = full_content_range(&file.content);
        let qualified_name = relative_path(&self.workspace_root, &file.path);

        self.nodes.push(SymbolNode {
            id: file_id.clone(),
            kind: "file".to_string(),
            name: file_name(&file.path),
            qualified_name,
            file_path: file.path.to_string_lossy().to_string(),
            range: range.clone(),
            selection_range: range,
            language: file.language_id.clone(),
            parent_id: None,
            size_bytes: Some(file.size_bytes),
        });

        file_id
    }

    /// Adds a symbol node and its structural contains edge.
    pub fn add_symbol(&mut self, symbol: NewSymbol) -> String {
        let file_path = symbol.file_path.to_string_lossy().to_string();
        let qualified_name = symbol.scope_names.join(".");
        let symbol_id = create_symbol_node_id(
            &symbol.file_path,
            &symbol.kind,
            &qualified_name,
            &symbol.range,
        );

        self.nodes.push(SymbolNode {
            id: symbol_id.clone(),
            kind: symbol.kind,
            name: symbol.name,
            qualified_name,
            file_path: file_path.clone(),
            range: symbol.range.clone(),
            selection_range: symbol.selection_range,
            language: symbol.language,
            parent_id: Some(symbol.parent_id.clone()),
            size_bytes: None,
        });
        self.edges.push(GraphEdge {
            id: create_edge_id("contains", &symbol.parent_id, &symbol_id),
            kind: "contains".to_string(),
            source_id: symbol.parent_id,
            target_id: symbol_id.clone(),
            file_path,
            range: symbol.range,
            confidence: "exact".to_string(),
        });

        symbol_id
    }

    /// Adds a file-scoped diagnostic.
    pub fn add_diagnostic(&mut self, code: &str, message: String, file_path: Option<String>) {
        self.diagnostics.push(AnalysisDiagnostic {
            severity: "warning".to_string(),
            code: code.to_string(),
            message,
            file_path,
        });
    }

    /// Finishes the graph and returns the serialized model.
    pub fn finish(self) -> ProjectGraph {
        ProjectGraph {
            workspace_root: self.workspace_root.to_string_lossy().to_string(),
            version: "0.1.0-rust".to_string(),
            generated_at: unix_timestamp_string(),
            nodes: self.nodes,
            edges: self.edges,
            diagnostics: self.diagnostics,
            languages: self.languages.into_iter().collect(),
            file_count: self.file_count,
        }
    }
}

/// New symbol data supplied by language analyzers.
pub struct NewSymbol {
    pub kind: String,
    pub name: String,
    pub scope_names: Vec<String>,
    pub file_path: PathBuf,
    pub range: SourceRange,
    pub selection_range: SourceRange,
    pub language: String,
    pub parent_id: String,
}

/// Builds a stable file node ID.
pub fn create_file_node_id(file_path: &Path) -> String {
    format!("file::{}", file_path.to_string_lossy())
}

/// Builds a stable symbol node ID.
fn create_symbol_node_id(
    file_path: &Path,
    kind: &str,
    qualified_name: &str,
    range: &SourceRange,
) -> String {
    format!(
        "symbol::{}::{}::{}::{}::{}",
        file_path.to_string_lossy(),
        kind,
        qualified_name,
        range.start_line,
        range.start_character
    )
}

/// Builds a stable edge ID.
fn create_edge_id(kind: &str, source_id: &str, target_id: &str) -> String {
    format!("edge::{kind}::{source_id}::{target_id}")
}

/// Returns a relative display path when the file is under the workspace root.
fn relative_path(workspace_root: &Path, file_path: &Path) -> String {
    file_path
        .strip_prefix(workspace_root)
        .unwrap_or(file_path)
        .to_string_lossy()
        .to_string()
}

/// Returns the last path component for display.
fn file_name(file_path: &Path) -> String {
    file_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| file_path.to_string_lossy().to_string())
}

/// Returns a dependency-free timestamp string.
fn unix_timestamp_string() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();

    format!("{seconds}")
}
