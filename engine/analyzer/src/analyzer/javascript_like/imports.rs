//! Fast file-to-file import edge extraction for JavaScript-like sources.
//!
//! This pass resolves project-local relative imports after workspace scanning so
//! the file graph can start from import roots instead of directory structure.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::graph::{NewFileDependencyEdge, ProjectGraphBuilder};
use crate::model::{SourceInput, SourceRange};

const RESOLVABLE_EXTENSIONS: [&str; 4] = ["ts", "tsx", "js", "jsx"];

/// Adds resolved import/export edges for all JavaScript-like project files.
pub fn add_import_edges(builder: &mut ProjectGraphBuilder, files: &[SourceInput]) {
    let file_by_path = create_file_map(files);

    for file in files {
        if !is_javascript_like(file) {
            continue;
        }

        for candidate in collect_import_candidates(file) {
            let Some(target_path) =
                resolve_relative_module(&file.path, &candidate.module_specifier, &file_by_path)
            else {
                continue;
            };

            if target_path == file.path {
                continue;
            }

            builder.add_file_dependency_edge(NewFileDependencyEdge {
                kind: candidate.kind,
                source_path: file.path.clone(),
                target_path,
                range: candidate.range,
            });
        }
    }
}

/// Import/export candidate before module resolution.
struct ImportCandidate {
    kind: String,
    module_specifier: String,
    range: SourceRange,
}

/// Creates a normalized path lookup for workspace source files.
fn create_file_map(files: &[SourceInput]) -> BTreeMap<PathBuf, PathBuf> {
    files
        .iter()
        .map(|file| (normalize_path(&file.path), file.path.clone()))
        .collect()
}

/// Returns whether a file can contain JavaScript-like import syntax.
fn is_javascript_like(file: &SourceInput) -> bool {
    matches!(file.language_id.as_str(), "typescript" | "javascript")
}

/// Collects single-line import/export declarations from one source file.
fn collect_import_candidates(file: &SourceInput) -> Vec<ImportCandidate> {
    let mut candidates = Vec::new();

    for (line_index, line) in file.content.lines().enumerate() {
        let trimmed = line.trim_start();
        let line_offset = line.len().saturating_sub(trimmed.len());

        if trimmed.starts_with("import ") {
            if let Some(candidate) =
                read_import_candidate(line_index, line_offset, trimmed, "imports")
            {
                candidates.push(candidate);
            }
            continue;
        }

        if trimmed.starts_with("export ") {
            if let Some(candidate) =
                read_from_candidate(line_index, line_offset, trimmed, "exports")
            {
                candidates.push(candidate);
            }
        }
    }

    candidates
}

/// Reads either `import ... from "x"` or side-effect `import "x"` syntax.
fn read_import_candidate(
    line_index: usize,
    line_offset: usize,
    trimmed: &str,
    kind: &str,
) -> Option<ImportCandidate> {
    read_from_candidate(line_index, line_offset, trimmed, kind).or_else(|| {
        let remainder = trimmed.strip_prefix("import")?.trim_start();
        read_quoted_specifier(
            line_index,
            line_offset + trimmed.find(remainder)?,
            remainder,
            kind,
        )
    })
}

/// Reads `... from "x"` syntax.
fn read_from_candidate(
    line_index: usize,
    line_offset: usize,
    trimmed: &str,
    kind: &str,
) -> Option<ImportCandidate> {
    let from_index = trimmed.find(" from ")?;
    let remainder_start = from_index + " from ".len();
    read_quoted_specifier(
        line_index,
        line_offset + remainder_start,
        &trimmed[remainder_start..],
        kind,
    )
}

/// Reads a string literal module specifier and returns its source span.
fn read_quoted_specifier(
    line_index: usize,
    offset: usize,
    text: &str,
    kind: &str,
) -> Option<ImportCandidate> {
    let quote_index = text.find(|character| character == '\'' || character == '"')?;
    let quote = text.as_bytes()[quote_index] as char;
    let specifier_start = quote_index + 1;
    let specifier_end = text[specifier_start..].find(quote)? + specifier_start;
    let module_specifier = text[specifier_start..specifier_end].to_string();

    if !module_specifier.starts_with('.') {
        return None;
    }

    Some(ImportCandidate {
        kind: kind.to_string(),
        module_specifier,
        range: SourceRange {
            start_line: line_index,
            start_character: offset + specifier_start,
            end_line: line_index,
            end_character: offset + specifier_end,
        },
    })
}

/// Resolves a relative module specifier against known workspace files.
fn resolve_relative_module(
    source_path: &Path,
    module_specifier: &str,
    file_by_path: &BTreeMap<PathBuf, PathBuf>,
) -> Option<PathBuf> {
    let base_path = normalize_path(&source_path.parent()?.join(module_specifier));

    for candidate in create_resolution_candidates(&base_path) {
        if let Some(file_path) = file_by_path.get(&candidate) {
            return Some(file_path.clone());
        }
    }

    None
}

/// Creates common TS/JS path candidates without touching the file system.
fn create_resolution_candidates(base_path: &Path) -> Vec<PathBuf> {
    if base_path.extension().is_some() {
        return vec![base_path.to_path_buf()];
    }

    let mut candidates = Vec::new();

    for extension in RESOLVABLE_EXTENSIONS {
        candidates.push(base_path.with_extension(extension));
    }

    for extension in RESOLVABLE_EXTENSIONS {
        candidates.push(base_path.join(format!("index.{extension}")));
    }

    candidates
}

/// Normalizes lexical `.` and `..` components without requiring paths to exist.
fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::ProjectGraphBuilder;

    #[test]
    fn adds_relative_import_edges_between_files() {
        let files = vec![
            source(
                "/workspace/src/main.ts",
                "import { service } from './service';",
            ),
            source("/workspace/src/service.ts", "export function service() {}"),
        ];
        let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));

        for file in &files {
            builder.add_file(file);
        }

        add_import_edges(&mut builder, &files);
        let graph = builder.finish();

        assert!(graph.edges.iter().any(|edge| {
            edge.kind == "imports"
                && edge.source_id.ends_with("/workspace/src/main.ts")
                && edge.target_id.ends_with("/workspace/src/service.ts")
        }));
    }

    fn source(path: &str, content: &str) -> SourceInput {
        SourceInput {
            path: PathBuf::from(path),
            language_id: "typescript".to_string(),
            content: content.to_string(),
            size_bytes: content.len(),
        }
    }
}
