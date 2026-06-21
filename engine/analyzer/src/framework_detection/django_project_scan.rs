//! Django project-root discovery for monorepo workspaces.
//!
//! Manifest evidence tells us that Django is installed somewhere, but a
//! monorepo can contain multiple concrete Django projects beneath one shared
//! Python package root. This scanner uses `manage.py` entrypoints to refine the
//! analysis roots without importing or executing project code.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use crate::fs_scan::is_excluded_directory;

use super::manifest_scan::workspace_relative_root_path;

const MAX_DJANGO_ENTRYPOINT_SIZE_BYTES: u64 = 1024 * 1024;

/// Concrete Django project root discovered from a `manage.py` entrypoint.
pub(super) struct DjangoProjectRoot {
    pub(super) root_path: String,
    pub(super) evidence: String,
}

/// Finds Django project roots using an explicit directory stack.
pub(super) fn scan_django_project_roots(
    workspace_root: &Path,
) -> Result<Vec<DjangoProjectRoot>, String> {
    let mut roots_by_path = BTreeMap::new();
    let mut stack = vec![workspace_root.to_path_buf()];

    while let Some(directory) = stack.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            format!(
                "failed to read Django project directory {}: {error}",
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
                if !is_excluded_directory(&path) {
                    stack.push(path);
                }
                continue;
            }

            if file_type.is_file() && is_manage_py(&path) && is_django_entrypoint(&path)? {
                let project_root = path.parent().unwrap_or(workspace_root);
                let root_path = workspace_relative_root_path(workspace_root, project_root);
                roots_by_path.insert(root_path, evidence_label(workspace_root, &path));
            }
        }
    }

    Ok(roots_by_path
        .into_iter()
        .map(|(root_path, evidence)| DjangoProjectRoot {
            root_path,
            evidence,
        })
        .collect())
}

/// Returns whether a file path names a Django management entrypoint candidate.
fn is_manage_py(path: &Path) -> bool {
    path.file_name().and_then(|value| value.to_str()) == Some("manage.py")
}

/// Confirms that a `manage.py` candidate contains standard Django entrypoint APIs.
fn is_django_entrypoint(path: &Path) -> Result<bool, String> {
    let metadata = fs::metadata(path).map_err(|error| {
        format!(
            "failed to read manage.py metadata {}: {error}",
            path.display()
        )
    })?;

    if metadata.len() > MAX_DJANGO_ENTRYPOINT_SIZE_BYTES {
        return Ok(false);
    }

    let content = fs::read_to_string(path)
        .map_err(|error| format!("failed to read manage.py {}: {error}", path.display()))?;

    Ok(content.contains("DJANGO_SETTINGS_MODULE")
        && (content.contains("django.core.management")
            || content.contains("execute_from_command_line")))
}

/// Builds a stable evidence string that points at the entrypoint file.
fn evidence_label(workspace_root: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(workspace_root).unwrap_or(path);
    format!(
        "manage.py Django entrypoint: {}",
        relative.to_string_lossy().replace('\\', "/")
    )
}
