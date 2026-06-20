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
    external_node_ids: BTreeSet<String>,
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
            external_node_ids: BTreeSet::new(),
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

    /// Adds an external target node used by unresolved call edges.
    pub fn add_external_symbol(&mut self, symbol: NewExternalSymbol) -> String {
        let file_path = symbol.file_path.to_string_lossy().to_string();
        let symbol_id = create_external_node_id(&symbol.file_path, &symbol.qualified_name);

        if self.external_node_ids.insert(symbol_id.clone()) {
            self.nodes.push(SymbolNode {
                id: symbol_id.clone(),
                kind: "external".to_string(),
                name: symbol.name,
                qualified_name: symbol.qualified_name,
                file_path,
                range: symbol.range.clone(),
                selection_range: symbol.selection_range,
                language: symbol.language,
                parent_id: None,
                size_bytes: None,
            });
        }

        symbol_id
    }

    /// Adds a call edge between a caller symbol and a resolved or external target.
    pub fn add_call_edge(&mut self, edge: NewCallEdge) {
        let file_path = edge.file_path.to_string_lossy().to_string();
        let edge_id = create_ranged_edge_id("calls", &edge.source_id, &edge.target_id, &edge.range);

        self.edges.push(GraphEdge {
            id: edge_id,
            kind: "calls".to_string(),
            source_id: edge.source_id,
            target_id: edge.target_id,
            file_path,
            range: edge.range,
            confidence: edge.confidence,
        });
    }

    /// Adds a resolved file-to-file import or export edge.
    pub fn add_file_dependency_edge(&mut self, edge: NewFileDependencyEdge) {
        let source_id = create_file_node_id(&edge.source_path);
        let target_id = create_file_node_id(&edge.target_path);

        self.edges.push(GraphEdge {
            id: create_edge_id(&edge.kind, &source_id, &target_id),
            kind: edge.kind,
            source_id,
            target_id,
            file_path: edge.source_path.to_string_lossy().to_string(),
            range: edge.range,
            confidence: "resolved".to_string(),
        });
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

/// New external node data supplied for unresolved references.
pub struct NewExternalSymbol {
    pub name: String,
    pub qualified_name: String,
    pub file_path: PathBuf,
    pub range: SourceRange,
    pub selection_range: SourceRange,
    pub language: String,
}

/// New call edge data supplied by language analyzers.
pub struct NewCallEdge {
    pub source_id: String,
    pub target_id: String,
    pub file_path: PathBuf,
    pub range: SourceRange,
    pub confidence: String,
}

/// New file dependency edge supplied by workspace-level import analysis.
pub struct NewFileDependencyEdge {
    pub kind: String,
    pub source_path: PathBuf,
    pub target_path: PathBuf,
    pub range: SourceRange,
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

/// Builds a stable external node ID scoped to the source file that observed it.
fn create_external_node_id(file_path: &Path, qualified_name: &str) -> String {
    format!(
        "external::{}::{}",
        file_path.to_string_lossy(),
        qualified_name
    )
}

/// Builds a stable edge ID.
fn create_edge_id(kind: &str, source_id: &str, target_id: &str) -> String {
    format!("edge::{kind}::{source_id}::{target_id}")
}

/// Builds a stable edge ID for source-positioned semantic edges.
fn create_ranged_edge_id(
    kind: &str,
    source_id: &str,
    target_id: &str,
    range: &SourceRange,
) -> String {
    format!(
        "edge::{kind}::{source_id}::{target_id}::{}::{}",
        range.start_line, range.start_character
    )
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
