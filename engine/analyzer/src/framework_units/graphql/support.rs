//! Shared GraphQL framework-unit scanning and model construction support.
//!
//! The helpers keep filesystem traversal iterative, enforce the source-size
//! guard, and centralize stable IDs and containment edges for language adapters.

use std::fs;
use std::path::{Path, PathBuf};

use crate::fs_scan::is_excluded_directory;
use crate::model::{
    utf16_code_unit_len, utf16_column_from_byte_offset, FrameworkUnit, FrameworkUnitEdge,
    SourceRange,
};

const MAX_GRAPHQL_FILE_SIZE_BYTES: u64 = 1024 * 1024;

/// One GraphQL root operation captured at its callable declaration.
pub(super) struct OperationDraft {
    pub(super) name: String,
    pub(super) operation_type: &'static str,
    pub(super) range: SourceRange,
}

/// A resolver or root type that owns GraphQL operations in one source file.
pub(super) struct SchemaDraft {
    pub(super) name: String,
    pub(super) range: SourceRange,
    pub(super) operations: Vec<OperationDraft>,
}

/// Returns the normalized root label used by manifest detection.
pub(super) fn framework_root_label(root_path: Option<&str>) -> String {
    match root_path {
        Some("") | None => ".".to_string(),
        Some(root_path) => root_path.to_string(),
    }
}

/// Resolves a workspace-relative framework root without canonicalizing paths.
pub(super) fn resolve_framework_root(workspace_root: &Path, root_path: &str) -> PathBuf {
    if root_path == "." {
        workspace_root.to_path_buf()
    } else {
        workspace_root.join(root_path)
    }
}

/// Finds eligible GraphQL source files with an explicit directory stack.
pub(super) fn collect_source_files(
    framework_root: &Path,
    ecosystem: &str,
) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    let mut stack = vec![framework_root.to_path_buf()];

    while let Some(directory) = stack.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            format!(
                "failed to read GraphQL directory {}: {error}",
                directory.display()
            )
        })?;

        for entry_result in entries {
            let entry =
                entry_result.map_err(|error| format!("failed to read directory entry: {error}"))?;
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|error| format!("failed to read file type {}: {error}", path.display()))?;

            if file_type.is_dir() {
                if !is_excluded_directory(&path) && !is_generated_directory(&path) {
                    stack.push(path);
                }
                continue;
            }
            if !file_type.is_file() || !is_source_file(&path, ecosystem) {
                continue;
            }

            let metadata = fs::metadata(&path)
                .map_err(|error| format!("failed to read metadata {}: {error}", path.display()))?;
            if metadata.len() <= MAX_GRAPHQL_FILE_SIZE_BYTES {
                files.push(path);
            }
        }
    }

    files.sort();
    Ok(files)
}

fn is_generated_directory(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(".next" | ".nuxt" | "coverage")
    )
}

fn is_source_file(path: &Path, ecosystem: &str) -> bool {
    let name = path.file_name().and_then(|value| value.to_str());
    if name.is_some_and(|value| value.ends_with(".d.ts")) {
        return false;
    }

    let extension = path.extension().and_then(|value| value.to_str());
    match ecosystem {
        "javascript" => matches!(extension, Some("ts" | "tsx" | "js" | "jsx")),
        "python" => extension == Some("py"),
        _ => false,
    }
}

/// Creates a zero-based range covering one callable or class declaration line.
pub(super) fn declaration_range(
    line_index: usize,
    start_character: usize,
    line: &str,
) -> SourceRange {
    SourceRange {
        start_line: line_index,
        start_character,
        end_line: line_index,
        end_character: utf16_code_unit_len(line),
    }
}

/// Counts leading whitespace using VS Code-compatible character offsets.
pub(super) fn leading_width(line: &str) -> usize {
    let leading_byte_offset = line.len().saturating_sub(line.trim_start().len());
    utf16_column_from_byte_offset(line, leading_byte_offset)
}

/// Returns a stable workspace-relative path using forward slashes.
pub(super) fn normalized_relative_path(base: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(base).unwrap_or(path);
    if relative.as_os_str().is_empty() {
        ".".to_string()
    } else {
        relative.to_string_lossy().replace('\\', "/")
    }
}

/// Creates a stable framework unit ID from source identity and declaration range.
pub(super) fn create_unit_id(
    root_path: &str,
    kind: &str,
    relative_path: &str,
    name: &str,
    range: &SourceRange,
) -> String {
    format!(
        "framework-unit::graphql::{root_path}::{kind}::{relative_path}::{name}::{}::{}",
        range.start_line, range.start_character
    )
}

/// Creates an exact schema-to-operation containment edge.
pub(super) fn create_contains_edge(
    schema: &FrameworkUnit,
    operation: &FrameworkUnit,
) -> FrameworkUnitEdge {
    FrameworkUnitEdge {
        id: format!(
            "framework-unit-edge::contains::{}::{}",
            schema.id, operation.id
        ),
        kind: "contains".to_string(),
        source_id: schema.id.clone(),
        target_id: operation.id.clone(),
        file_path: operation.file_path.clone(),
        range: operation.range.clone(),
        confidence: "exact".to_string(),
    }
}

/// Converts a source path to a dotted module label for schema qualification.
pub(super) fn module_name(root: &Path, file_path: &Path) -> String {
    let path_without_extension = file_path.with_extension("");
    let relative = path_without_extension
        .strip_prefix(root)
        .unwrap_or(&path_without_extension);
    let parts = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .filter(|part| !part.is_empty() && *part != "__init__")
        .collect::<Vec<_>>();

    if parts.is_empty() {
        "schema".to_string()
    } else {
        parts.join(".")
    }
}
