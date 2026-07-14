//! Workspace post-pass for conservative imported bare-call resolution.
//!
//! Public surface: `resolve_imported_calls` receives the completed symbol/call
//! graph plus its immutable source snapshot. Internal binding and shadow modules
//! accept only explicitly supported named imports; graph mutation remains owned
//! by `ProjectGraphBuilder`.

mod bindings;
mod shadowing;
mod types;

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;

use crate::graph::{CallEdgeResolution, ProjectGraphBuilder};
use crate::model::{SourceInput, SymbolNode};

use self::bindings::collect_named_import_bindings;
use self::shadowing::has_possible_shadow;
use self::types::NamedImportBinding;
use super::python_like::syntax::PythonSyntaxSnapshots;

/// Replaces only uniquely proven named-import unresolved call edges.
pub(super) fn resolve_imported_calls(
    builder: &mut ProjectGraphBuilder,
    files: &[SourceInput],
    python_syntax: &PythonSyntaxSnapshots,
) {
    let files_by_path: BTreeMap<&str, &SourceInput> = files
        .iter()
        .filter_map(|file| file.path.to_str().map(|path| (path, file)))
        .collect();
    let bindings = collect_named_import_bindings(files, python_syntax);
    let unique_bindings = unique_unshadowed_bindings(bindings, &files_by_path, python_syntax);
    let callable_targets = index_top_level_callables(builder.nodes());
    let nodes_by_id: BTreeMap<&str, &SymbolNode> = builder
        .nodes()
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect();
    let mut resolutions = Vec::new();

    for edge in builder.edges() {
        if edge.kind != "calls" || edge.confidence != "unresolved" {
            continue;
        }

        let Some(external) = nodes_by_id.get(edge.target_id.as_str()) else {
            continue;
        };

        if external.kind != "external"
            || external.name != external.qualified_name
            || !is_bare_identifier(&external.name)
        {
            continue;
        }

        let Some(source) = nodes_by_id.get(edge.source_id.as_str()) else {
            continue;
        };
        let binding_key = (edge.file_path.clone(), external.name.clone());
        let Some(binding) = unique_bindings.get(&binding_key) else {
            continue;
        };

        if source.file_path != edge.file_path
            || binding.source_path.to_string_lossy() != source.file_path
        {
            continue;
        }

        let target_key = (
            binding.target_path.to_string_lossy().to_string(),
            binding.imported_name.clone(),
        );
        let Some(targets) = callable_targets.get(&target_key) else {
            continue;
        };

        if targets.len() != 1 {
            continue;
        }

        resolutions.push(CallEdgeResolution {
            edge_id: edge.id.clone(),
            target_id: targets[0].clone(),
        });
    }

    builder.resolve_call_edges(resolutions);
}

/// Keeps only source bindings that are unique by local name and cannot be shadowed.
fn unique_unshadowed_bindings(
    bindings: Vec<NamedImportBinding>,
    files_by_path: &BTreeMap<&str, &SourceInput>,
    python_syntax: &PythonSyntaxSnapshots,
) -> BTreeMap<(String, String), NamedImportBinding> {
    let mut grouped: BTreeMap<(String, String), Vec<NamedImportBinding>> = BTreeMap::new();

    for binding in bindings {
        let key = (
            binding.source_path.to_string_lossy().to_string(),
            binding.local_name.clone(),
        );
        grouped.entry(key).or_default().push(binding);
    }

    let mut unique = BTreeMap::new();

    for (key, mut candidates) in grouped {
        if candidates.len() != 1 {
            continue;
        }

        let binding = candidates.pop().expect("one binding remains");
        let Some(source_file) = files_by_path.get(key.0.as_str()) else {
            continue;
        };

        if !has_possible_shadow(
            source_file,
            &binding,
            python_syntax.get(&binding.source_path),
        ) {
            unique.insert(key, binding);
        }
    }

    unique
}

/// Indexes only file-owned callable declarations by exact original name.
fn index_top_level_callables(nodes: &[SymbolNode]) -> BTreeMap<(String, String), Vec<String>> {
    let file_id_by_path: BTreeMap<&str, &str> = nodes
        .iter()
        .filter(|node| node.kind == "file")
        .map(|node| (node.file_path.as_str(), node.id.as_str()))
        .collect();
    let mut targets: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();

    for node in nodes {
        let Some(file_id) = file_id_by_path.get(node.file_path.as_str()) else {
            continue;
        };

        if node.kind != "function"
            || node.parent_id.as_deref() != Some(*file_id)
            || node.qualified_name != node.name
        {
            continue;
        }

        targets
            .entry((node.file_path.clone(), node.name.clone()))
            .or_default()
            .push(node.id.clone());
    }

    targets
}

/// Validates the exact bare-call label accepted by both lightweight scanners.
fn is_bare_identifier(name: &str) -> bool {
    let mut bytes = name.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    let valid_start = |byte: u8| byte == b'_' || byte == b'$' || byte.is_ascii_alphabetic();

    valid_start(first) && bytes.all(|byte| valid_start(byte) || byte.is_ascii_digit())
}
