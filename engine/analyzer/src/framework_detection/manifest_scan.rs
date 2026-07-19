//! Iterative manifest discovery shared by framework and package-root detection.

use std::fs;
use std::path::{Path, PathBuf};

use crate::fs_scan::is_excluded_directory;

/// A manifest file selected for framework detection.
pub(super) struct ManifestFile {
    pub(super) path: PathBuf,
    pub(super) name: String,
    pub(super) root_path: String,
    pub(super) manifest_path: String,
    pub(super) ecosystem: &'static str,
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

            if let Some(ecosystem) = manifest_ecosystem(name) {
                manifests.push(ManifestFile {
                    path: path.clone(),
                    name: name.to_string(),
                    root_path: manifest_root_path(workspace_root, &path),
                    manifest_path: workspace_relative_manifest_path(workspace_root, &path),
                    ecosystem,
                });
            }
        }
    }

    manifests.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(manifests)
}

/// Returns the neutral ecosystem associated with one supported manifest name.
fn manifest_ecosystem(name: &str) -> Option<&'static str> {
    match name {
        "package.json" => Some("javascript"),
        "pyproject.toml" | "requirements.txt" | "setup.py" | "Pipfile" => Some("python"),
        "Cargo.toml" => Some("rust"),
        "go.mod" => Some("go"),
        "build.gradle" | "build.gradle.kts" | "pom.xml" => Some("jvm"),
        "composer.json" => Some("php"),
        "Gemfile" => Some("ruby"),
        _ => None,
    }
}

/// Returns a stable workspace-relative package root for a manifest file.
fn manifest_root_path(workspace_root: &Path, manifest_path: &Path) -> String {
    let manifest_directory = manifest_path.parent().unwrap_or(workspace_root);
    workspace_relative_root_path(workspace_root, manifest_directory)
}

/// Returns the stable workspace-relative path retained as package-root evidence.
fn workspace_relative_manifest_path(workspace_root: &Path, manifest_path: &Path) -> String {
    manifest_path
        .strip_prefix(workspace_root)
        .unwrap_or(manifest_path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Returns a stable workspace-relative root label for a directory.
pub(super) fn workspace_relative_root_path(workspace_root: &Path, directory: &Path) -> String {
    let relative = directory.strip_prefix(workspace_root).unwrap_or(directory);

    if relative.as_os_str().is_empty() {
        ".".to_string()
    } else {
        relative.to_string_lossy().replace('\\', "/")
    }
}
