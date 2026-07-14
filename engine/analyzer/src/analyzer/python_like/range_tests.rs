//! UTF-16 source-range regressions for Python graph output.

use std::path::PathBuf;

use crate::graph::ProjectGraphBuilder;
use crate::model::{ProjectGraph, SourceInput};

use super::syntax::{scan_workspace_sources, PythonSyntaxSnapshot};
use super::{add_import_edges, extract_symbols};

#[test]
fn reports_symbol_and_call_columns_as_utf16_code_units() {
    let graph = analyze(
        "def helper(label=\"한글😀\"):\n    return label\n\ndef caller():\n    \"한글😀\"; helper()\n",
    );
    let helper = graph
        .nodes
        .iter()
        .find(|node| node.kind == "function" && node.name == "helper")
        .expect("helper symbol");
    let call = graph
        .edges
        .iter()
        .find(|edge| edge.kind == "calls" && edge.range.start_line == 4)
        .expect("helper call");

    assert_eq!(helper.selection_range.start_character, 4);
    assert_eq!(helper.selection_range.end_character, 10);
    assert_eq!(helper.range.end_character, 25);
    assert_eq!(call.range.start_character, 12);
    assert_eq!(call.range.end_character, 19);
}

#[test]
fn reports_python_import_line_columns_as_utf16_code_units() {
    let files = vec![source("/workspace/app.py", "from 한글 import value  # 😀")];
    let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));

    for file in &files {
        builder.add_file(file);
    }
    let syntax = scan_workspace_sources(&files);
    add_import_edges(&mut builder, &files, &syntax);
    let graph = builder.finish();
    let import = graph
        .edges
        .iter()
        .find(|edge| edge.kind == "imports")
        .expect("external import edge");

    assert_eq!(import.range.start_character, 0);
    assert_eq!(import.range.end_character, 26);
}

#[test]
fn preserves_ascii_symbol_and_call_columns() {
    let graph = analyze("def helper():\n    return 1\n\ndef caller():\n    helper()\n");
    let helper = graph
        .nodes
        .iter()
        .find(|node| node.kind == "function" && node.name == "helper")
        .expect("helper symbol");
    let call = graph
        .edges
        .iter()
        .find(|edge| edge.kind == "calls")
        .expect("helper call");

    assert_eq!(helper.selection_range.start_character, 4);
    assert_eq!(helper.selection_range.end_character, 10);
    assert_eq!(call.range.start_character, 4);
    assert_eq!(call.range.end_character, 11);
}

/// Runs Python extraction with its offset-preserving syntax snapshot.
fn analyze(content: &str) -> ProjectGraph {
    let file = source("/workspace/app.py", content);
    let syntax = PythonSyntaxSnapshot::new(&file.content);
    let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));
    let file_id = builder.add_file(&file);

    extract_symbols(&mut builder, &file, file_id, &syntax).expect("extract Python fixture");
    builder.finish()
}

/// Creates one Python source snapshot.
fn source(path: &str, content: &str) -> SourceInput {
    SourceInput {
        path: PathBuf::from(path),
        language_id: "python".to_string(),
        content: content.to_string(),
        size_bytes: content.len(),
    }
}
