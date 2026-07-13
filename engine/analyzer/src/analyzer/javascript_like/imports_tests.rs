//! Fixture tests for JavaScript workspace module dependency resolution.

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

#[test]
fn adds_tsconfig_path_alias_import_edges_between_files() {
    let workspace_root = std::env::temp_dir().join(format!(
        "project-analyzer-alias-test-{}",
        std::process::id()
    ));
    let src_root = workspace_root.join("src");
    let service_path = src_root.join("services").join("service.ts");
    let main_path = src_root.join("main.ts");

    std::fs::create_dir_all(service_path.parent().expect("service parent"))
        .expect("create source tree");
    std::fs::write(
        workspace_root.join("tsconfig.json"),
        r#"{
          "compilerOptions": {
            "paths": {
              "*": ["./src/*"]
            }
          }
        }"#,
    )
    .expect("write tsconfig");

    let files = vec![
        source(
            main_path.to_string_lossy().as_ref(),
            "import { service } from 'services/service';",
        ),
        source(
            service_path.to_string_lossy().as_ref(),
            "export function service() {}",
        ),
    ];
    let mut builder = ProjectGraphBuilder::new(workspace_root.clone());

    for file in &files {
        builder.add_file(file);
    }
    add_import_edges(&mut builder, &files);
    let graph = builder.finish();
    assert!(graph.edges.iter().any(|edge| {
        edge.kind == "imports"
            && edge.source_id.ends_with("src/main.ts")
            && edge.target_id.ends_with("src/services/service.ts")
    }));

    let _ = std::fs::remove_dir_all(workspace_root);
}

#[test]
fn adds_external_import_leaf_for_package_imports() {
    let files = vec![source(
        "/workspace/src/main.ts",
        "import React from 'react';",
    )];
    let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));

    for file in &files {
        builder.add_file(file);
    }
    add_import_edges(&mut builder, &files);
    let graph = builder.finish();
    let external = graph
        .nodes
        .iter()
        .find(|node| node.kind == "external" && node.name == "react")
        .expect("external package node");

    assert!(graph.edges.iter().any(|edge| {
        edge.kind == "imports" && edge.target_id == external.id && edge.confidence == "unresolved"
    }));
}

/// Creates one TypeScript source fixture.
fn source(path: &str, content: &str) -> SourceInput {
    SourceInput {
        path: PathBuf::from(path),
        language_id: "typescript".to_string(),
        content: content.to_string(),
        size_bytes: content.len(),
    }
}
