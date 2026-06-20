//! Fast iterative workspace scanning.
//!
//! The scanner avoids recursive calls and skips common dependency, generated,
//! and build output directories before reading source files.

use std::fs;
use std::path::{Path, PathBuf};

use crate::model::SourceInput;

/// Workspace scan settings.
pub struct ScanOptions {
    pub workspace_root: PathBuf,
    pub max_file_size_kb: usize,
}

/// Scans a workspace for supported source files.
pub fn scan_workspace(options: &ScanOptions) -> Result<Vec<SourceInput>, String> {
    let mut files = Vec::new();
    let mut stack = vec![options.workspace_root.clone()];
    let max_file_size_bytes = options.max_file_size_kb.saturating_mul(1024);

    while let Some(directory) = stack.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                return Err(format!(
                    "failed to read directory {}: {error}",
                    directory.display()
                ));
            }
        };

        for entry_result in entries {
            let entry =
                entry_result.map_err(|error| format!("failed to read directory entry: {error}"))?;
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|error| format!("failed to read file type {}: {error}", path.display()))?;

            if file_type.is_dir() {
                if !is_excluded_directory(&path) {
                    stack.push(path);
                }
                continue;
            }

            if !file_type.is_file() {
                continue;
            }

            let Some(language_id) = language_id_for_path(&path) else {
                continue;
            };
            let metadata = fs::metadata(&path)
                .map_err(|error| format!("failed to read metadata {}: {error}", path.display()))?;

            if metadata.len() as usize > max_file_size_bytes {
                continue;
            }

            let content = fs::read_to_string(&path).map_err(|error| {
                format!("failed to read source file {}: {error}", path.display())
            })?;

            files.push(SourceInput {
                path,
                language_id,
                size_bytes: content.len(),
                content,
            });
        }
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

/// Returns whether a directory should be skipped during project scanning.
pub(crate) fn is_excluded_directory(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };

    matches!(
        name,
        ".git"
            | ".vscode"
            | ".codeidx"
            | "node_modules"
            | "dist"
            | "build"
            | "coverage"
            | ".venv"
            | "venv"
            | "__pycache__"
            | "target"
            | "out"
    )
}

/// Maps a recognized source file extension to a VS Code language ID.
fn language_id_for_path(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();

    match extension.as_str() {
        "ts" | "tsx" | "mts" | "cts" => Some("typescript".to_string()),
        "js" | "jsx" | "mjs" | "cjs" => Some("javascript".to_string()),
        "vue" => Some("vue".to_string()),
        "svelte" => Some("svelte".to_string()),
        "py" => Some("python".to_string()),
        "rs" => Some("rust".to_string()),
        "go" => Some("go".to_string()),
        "java" => Some("java".to_string()),
        "kt" | "kts" => Some("kotlin".to_string()),
        "php" => Some("php".to_string()),
        "rb" => Some("ruby".to_string()),
        _ => None,
    }
}
