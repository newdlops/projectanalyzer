//! Code-first GraphQL semantic unit adapter.
//!
//! The public surface emits schema parents and Query/Mutation/Subscription
//! operations while language-specific decorator parsing remains internal.

mod javascript;
mod python;
mod support;

use std::fs;
use std::path::Path;

use crate::model::{DetectedFramework, FrameworkUnit};

use self::support::{
    collect_source_files, create_contains_edge, create_unit_id, framework_root_label, module_name,
    normalized_relative_path, resolve_framework_root, SchemaDraft,
};
use super::FrameworkUnitExtraction;

/// Extracts code-first GraphQL operations for one canonical framework root.
pub(super) fn analyze(
    workspace_root: &Path,
    framework: &DetectedFramework,
) -> Result<FrameworkUnitExtraction, String> {
    if framework.name != "GraphQL"
        || !matches!(framework.ecosystem.as_str(), "javascript" | "python")
    {
        return Ok(FrameworkUnitExtraction::default());
    }

    let root_path = framework_root_label(framework.root_path.as_deref());
    let framework_root = resolve_framework_root(workspace_root, &root_path);
    if !framework_root.is_dir() {
        return Ok(FrameworkUnitExtraction::default());
    }

    let files = collect_source_files(&framework_root, &framework.ecosystem)?;
    let mut extraction = FrameworkUnitExtraction::default();
    for file_path in files {
        let content = fs::read_to_string(&file_path)
            .map_err(|error| format!("failed to read {}: {error}", file_path.display()))?;
        let schemas = match framework.ecosystem.as_str() {
            "javascript" => javascript::extract(&content),
            "python" => python::extract(&content),
            _ => Vec::new(),
        };
        add_schema_units(
            workspace_root,
            &framework_root,
            &root_path,
            &file_path,
            schemas,
            &mut extraction,
        );
    }

    Ok(extraction)
}

/// Converts language drafts to stable graph models and exact containment edges.
fn add_schema_units(
    workspace_root: &Path,
    framework_root: &Path,
    root_path: &str,
    file_path: &Path,
    schemas: Vec<SchemaDraft>,
    extraction: &mut FrameworkUnitExtraction,
) {
    let relative_path = normalized_relative_path(workspace_root, file_path);
    let module = module_name(framework_root, file_path);

    for schema in schemas {
        let schema_unit = FrameworkUnit {
            id: create_unit_id(
                root_path,
                "schema",
                &relative_path,
                &schema.name,
                &schema.range,
            ),
            framework: "GraphQL".to_string(),
            kind: "schema".to_string(),
            name: schema.name.clone(),
            qualified_name: format!("{module}.{}", schema.name),
            root_path: root_path.to_string(),
            file_path: file_path.to_string_lossy().to_string(),
            range: schema.range,
            parent_id: None,
        };
        extraction.units.push(schema_unit.clone());

        for operation in schema.operations {
            let operation_unit = FrameworkUnit {
                id: create_unit_id(
                    root_path,
                    "operation",
                    &relative_path,
                    &operation.name,
                    &operation.range,
                ),
                framework: "GraphQL".to_string(),
                kind: "operation".to_string(),
                name: operation.name.clone(),
                qualified_name: format!("{}.{}", operation.operation_type, operation.name),
                root_path: root_path.to_string(),
                file_path: file_path.to_string_lossy().to_string(),
                range: operation.range,
                parent_id: Some(schema_unit.id.clone()),
            };
            extraction
                .edges
                .push(create_contains_edge(&schema_unit, &operation_unit));
            extraction.units.push(operation_unit);
        }
    }
}
