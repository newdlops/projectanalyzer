//! Iterative manifest discovery for framework detection.

use std::fs;
use std::path::{Path, PathBuf};

use crate::fs_scan::is_excluded_directory;

/// A manifest file selected for framework detection.
pub(super) struct ManifestFile {
    pub(super) path: PathBuf,
    pub(super) name: String,
    pub(super) root_path: String,
}

/// Finds known manifest files without recursive calls.
pub(super) fn scan_manifest_files(workspace_root: &Path) -> Result<Vec<ManifestFile>, String> {
    let mut manifests = Vec::new();
    let mut stack = vec![workspace_root.to_path_buf()];

    while let Some(directory) = stack.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            format!("failed to read directory {}: {error}", directory.display())
        })?;

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

            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };

            if is_manifest_name(name) {
                manifests.push(ManifestFile {
                    path: path.clone(),
                    name: name.to_string(),
                    root_path: manifest_root_path(workspace_root, &path),
                });
            }
        }
    }

    manifests.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(manifests)
}

/// Returns whether a filename is one of the manifests understood by this module.
fn is_manifest_name(name: &str) -> bool {
    matches!(
        name,
        "package.json"
            | "pyproject.toml"
            | "requirements.txt"
            | "setup.py"
            | "Pipfile"
            | "Cargo.toml"
            | "go.mod"
            | "build.gradle"
            | "build.gradle.kts"
            | "pom.xml"
            | "composer.json"
            | "Gemfile"
    )
}

/// Returns a stable workspace-relative package root for a manifest file.
fn manifest_root_path(workspace_root: &Path, manifest_path: &Path) -> String {
    let manifest_directory = manifest_path.parent().unwrap_or(workspace_root);
    let relative = manifest_directory
        .strip_prefix(workspace_root)
        .unwrap_or(manifest_directory);

    if relative.as_os_str().is_empty() {
        ".".to_string()
    } else {
        relative.to_string_lossy().replace('\\', "/")
    }
}
