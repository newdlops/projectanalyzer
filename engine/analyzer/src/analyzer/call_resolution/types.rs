//! Internal contracts for conservative workspace imported-call resolution.

use std::path::PathBuf;

/// One supported named import after its module has resolved to a workspace file.
#[derive(Clone, Debug)]
pub(super) struct NamedImportBinding {
    /// Source file that owns the local binding and unresolved bare call.
    pub source_path: PathBuf,
    /// Resolved project-local module containing the imported declaration.
    pub target_path: PathBuf,
    /// Exported/original callable name expected in the target module.
    pub imported_name: String,
    /// Local source binding that must exactly match the unresolved call label.
    pub local_name: String,
    /// Zero-based declaration line excluded from conservative shadow scans.
    pub import_line: usize,
    /// Analyzer language ID used to route language-specific shadow checks.
    pub language_id: String,
}
