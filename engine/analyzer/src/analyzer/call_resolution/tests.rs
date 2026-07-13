//! Fixture-style tests for workspace imported-call resolution boundaries.

use std::path::PathBuf;

use crate::analyzer::{analyze_source_file, analyze_workspace_edges};
use crate::graph::ProjectGraphBuilder;
use crate::model::{ProjectGraph, SourceInput};

#[test]
fn resolves_javascript_named_alias_and_removes_only_its_orphan_placeholder() {
    let files = vec![
        source(
            "/workspace/src/main.ts",
            "typescript",
            "import { foo as bar } from './helpers';\nexport function run() {\n  bar();\n  missing();\n}\n",
        ),
        source(
            "/workspace/src/helpers.ts",
            "typescript",
            "export function foo() {\n  return 1;\n}\n",
        ),
    ];
    let graph = analyze(files);
    let run_id = node_id(&graph, "/workspace/src/main.ts", "run");
    let foo_id = node_id(&graph, "/workspace/src/helpers.ts", "foo");

    assert_resolved_call(&graph, &run_id, &foo_id);
    assert!(!has_external(&graph, "/workspace/src/main.ts", "bar"));
    assert!(has_external(&graph, "/workspace/src/main.ts", "missing"));
}

#[test]
fn resolves_python_from_import_alias_to_unique_top_level_function() {
    let files = vec![
        source(
            "/workspace/app/main.py",
            "python",
            "from app.helpers import foo as bar\n\ndef run():\n    return bar()\n",
        ),
        source(
            "/workspace/app/helpers.py",
            "python",
            "def foo():\n    return 1\n",
        ),
    ];
    let graph = analyze(files);
    let run_id = node_id(&graph, "/workspace/app/main.py", "run");
    let foo_id = node_id(&graph, "/workspace/app/helpers.py", "foo");

    assert_resolved_call(&graph, &run_id, &foo_id);
    assert!(!has_external(&graph, "/workspace/app/main.py", "bar"));
}

#[test]
fn preserves_unresolved_call_when_javascript_target_is_ambiguous() {
    let files = vec![
        source(
            "/workspace/src/main.ts",
            "typescript",
            "import { foo as bar } from './helpers';\nexport function run() {\n  bar();\n}\n",
        ),
        source(
            "/workspace/src/helpers.ts",
            "typescript",
            "export function foo() {}\nexport function foo() {}\n",
        ),
    ];
    let graph = analyze(files);

    assert_unresolved_external_call(&graph, "/workspace/src/main.ts", "run", "bar");
}

#[test]
fn preserves_unresolved_call_when_python_parameter_shadows_import_binding() {
    let files = vec![
        source(
            "/workspace/app/main.py",
            "python",
            "from app.helpers import foo as bar\n\ndef run(bar):\n    return bar()\n",
        ),
        source(
            "/workspace/app/helpers.py",
            "python",
            "def foo():\n    return 1\n",
        ),
    ];
    let graph = analyze(files);

    assert_unresolved_external_call(&graph, "/workspace/app/main.py", "run", "bar");
}

#[test]
fn preserves_unresolved_call_when_python_module_suffix_is_ambiguous() {
    let files = vec![
        source(
            "/workspace/main.py",
            "python",
            "from helpers import foo as bar\n\ndef run():\n    return bar()\n",
        ),
        source(
            "/workspace/pkg_a/helpers.py",
            "python",
            "def foo():\n    return 'a'\n",
        ),
        source(
            "/workspace/pkg_b/helpers.py",
            "python",
            "def foo():\n    return 'b'\n",
        ),
    ];
    let graph = analyze(files);

    assert_unresolved_external_call(&graph, "/workspace/main.py", "run", "bar");
}

#[test]
fn preserves_namespace_and_default_import_calls_as_unsupported_forms() {
    let files = vec![
        source(
            "/workspace/src/main.ts",
            "typescript",
            "import * as helpers from './helpers';\nimport fallback from './helpers';\nexport function run() {\n  helpers.foo();\n  fallback();\n}\n",
        ),
        source(
            "/workspace/src/helpers.ts",
            "typescript",
            "export function foo() {}\n",
        ),
    ];
    let graph = analyze(files);

    assert_unresolved_external_call(&graph, "/workspace/src/main.ts", "run", "helpers.foo");
    assert_unresolved_external_call(&graph, "/workspace/src/main.ts", "run", "fallback");
}

/// Runs the same file, workspace-edge, and post-pass pipeline as the CLI.
fn analyze(files: Vec<SourceInput>) -> ProjectGraph {
    let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));

    for file in files.iter().cloned() {
        analyze_source_file(&mut builder, file).expect("fixture source analyzes");
    }

    analyze_workspace_edges(&mut builder, &files);
    builder.finish()
}

/// Creates an in-memory source fixture.
fn source(path: &str, language_id: &str, content: &str) -> SourceInput {
    SourceInput {
        path: PathBuf::from(path),
        language_id: language_id.to_string(),
        content: content.to_string(),
        size_bytes: content.len(),
    }
}

/// Returns one exact file/name node ID.
fn node_id(graph: &ProjectGraph, file_path: &str, name: &str) -> String {
    graph
        .nodes
        .iter()
        .find(|node| node.file_path == file_path && node.name == name)
        .map(|node| node.id.clone())
        .unwrap_or_else(|| panic!("missing {name} in {file_path}"))
}

/// Asserts a concrete imported call with the required confidence.
fn assert_resolved_call(graph: &ProjectGraph, source_id: &str, target_id: &str) {
    assert!(graph.edges.iter().any(|edge| {
        edge.kind == "calls"
            && edge.source_id == source_id
            && edge.target_id == target_id
            && edge.confidence == "resolved"
    }));
}

/// Asserts an unresolved call still points at its external display node.
fn assert_unresolved_external_call(
    graph: &ProjectGraph,
    file_path: &str,
    source_name: &str,
    external_name: &str,
) {
    let source_id = node_id(graph, file_path, source_name);
    let external_id = node_id(graph, file_path, external_name);

    assert!(graph.edges.iter().any(|edge| {
        edge.kind == "calls"
            && edge.source_id == source_id
            && edge.target_id == external_id
            && edge.confidence == "unresolved"
    }));
}

/// Returns whether an external placeholder still exists in one source file.
fn has_external(graph: &ProjectGraph, file_path: &str, name: &str) -> bool {
    graph
        .nodes
        .iter()
        .any(|node| node.kind == "external" && node.file_path == file_path && node.name == name)
}
