//! Regression fixtures for Python lexical binding-aware call resolution.

use std::path::PathBuf;

use crate::graph::ProjectGraphBuilder;
use crate::model::{ProjectGraph, SourceInput};

use super::extract_symbols;
use super::syntax::PythonSyntaxSnapshot;

#[test]
fn parameter_shadow_prevents_same_file_bare_call_resolution() {
    let graph = analyze("def helper(): return 1\n\ndef run(helper): return helper()\n");
    let run_id = qualified_node_id(&graph, "run");
    let helper_id = qualified_node_id(&graph, "helper");

    assert_no_call_edge(&graph, &run_id, &helper_id);
    assert_unresolved_named_call(&graph, &run_id, "helper");
}

#[test]
fn later_assignment_prevents_python_local_call_resolution() {
    let graph = analyze(
        "def helper():\n    return 1\n\ndef run():\n    helper()\n    helper = replacement\n",
    );
    let run_id = qualified_node_id(&graph, "run");
    let helper_id = qualified_node_id(&graph, "helper");

    assert_no_call_edge(&graph, &run_id, &helper_id);
    assert_unresolved_named_call(&graph, &run_id, "helper");
}

#[test]
fn parameter_shadow_does_not_block_self_member_resolution() {
    let graph = analyze(
        "class Service:\n    def run(self, helper):\n        return self.helper()\n    def helper(self):\n        return 1\n\ndef helper():\n    return 2\n",
    );
    let run_id = qualified_node_id(&graph, "Service.run");
    let method_id = qualified_node_id(&graph, "Service.helper");

    assert!(graph.edges.iter().any(|edge| {
        edge.kind == "calls" && edge.source_id == run_id && edge.target_id == method_id
    }));
}

/// Runs Python extraction with the same code-only syntax view as workspace analysis.
fn analyze(content: &str) -> ProjectGraph {
    let file = SourceInput {
        path: PathBuf::from("/workspace/app.py"),
        language_id: "python".to_string(),
        content: content.to_string(),
        size_bytes: content.len(),
    };
    let syntax = PythonSyntaxSnapshot::new(content);
    let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));
    let file_id = builder.add_file(&file);

    extract_symbols(&mut builder, &file, file_id, &syntax).expect("extracts Python fixture");
    builder.finish()
}

/// Returns one Python symbol ID by exact same-file qualified name.
fn qualified_node_id(graph: &ProjectGraph, qualified_name: &str) -> String {
    graph
        .nodes
        .iter()
        .find(|node| node.qualified_name == qualified_name && node.kind != "external")
        .map(|node| node.id.clone())
        .unwrap_or_else(|| panic!("missing node qualified as {qualified_name}"))
}

/// Asserts the analyzer did not create a concrete edge to the shadowed function.
fn assert_no_call_edge(graph: &ProjectGraph, source_id: &str, target_id: &str) {
    assert!(graph.edges.iter().all(|edge| {
        edge.kind != "calls" || edge.source_id != source_id || edge.target_id != target_id
    }));
}

/// Asserts that a shadowed bare call remains unresolved.
fn assert_unresolved_named_call(graph: &ProjectGraph, source_id: &str, name: &str) {
    let target = graph
        .nodes
        .iter()
        .find(|node| node.kind == "external" && node.name == name)
        .expect("external shadow target exists");

    assert!(graph.edges.iter().any(|edge| {
        edge.kind == "calls"
            && edge.source_id == source_id
            && edge.target_id == target.id
            && edge.confidence == "unresolved"
    }));
}
