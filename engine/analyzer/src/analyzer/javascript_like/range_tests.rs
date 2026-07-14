//! UTF-16 source-range regressions for JavaScript-like graph output.

use std::path::PathBuf;

use crate::graph::ProjectGraphBuilder;
use crate::model::{ProjectGraph, SourceInput};

use super::{add_import_edges, extract_symbols};

#[test]
fn reports_symbol_and_call_columns_as_utf16_code_units() {
    let graph = analyze(
        "function /*한글😀*/ helper() {}\nfunction caller() {\n  \"한글😀\"; helper();\n}\n",
    );
    let helper = graph
        .nodes
        .iter()
        .find(|node| node.kind == "function" && node.name == "helper")
        .expect("helper symbol");
    let call = graph
        .edges
        .iter()
        .find(|edge| edge.kind == "calls" && edge.range.start_line == 2)
        .expect("helper call");

    assert_eq!(helper.selection_range.start_character, 18);
    assert_eq!(helper.selection_range.end_character, 24);
    assert_eq!(helper.range.end_character, 29);
    assert_eq!(call.range.start_character, 10);
    assert_eq!(call.range.end_character, 17);
}

#[test]
fn reports_import_specifier_columns_as_utf16_code_units() {
    let files = vec![
        source(
            "/workspace/src/main.ts",
            "import /*한글😀*/ service from './service';",
        ),
        source("/workspace/src/service.ts", "export function service() {}"),
    ];
    let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));

    for file in &files {
        builder.add_file(file);
    }
    add_import_edges(&mut builder, &files);
    let graph = builder.finish();
    let import = graph
        .edges
        .iter()
        .find(|edge| edge.kind == "imports")
        .expect("resolved import edge");

    assert_eq!(import.range.start_character, 30);
    assert_eq!(import.range.end_character, 39);
}

#[test]
fn preserves_ascii_symbol_and_call_columns() {
    let graph = analyze("function helper() {}\nfunction caller() {\n  helper();\n}\n");
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

    assert_eq!(helper.selection_range.start_character, 9);
    assert_eq!(helper.selection_range.end_character, 15);
    assert_eq!(call.range.start_character, 2);
    assert_eq!(call.range.end_character, 9);
}

/// Runs JavaScript-like extraction for one TypeScript fixture.
fn analyze(content: &str) -> ProjectGraph {
    let file = source("/workspace/src/main.ts", content);
    let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));
    let file_id = builder.add_file(&file);

    extract_symbols(&mut builder, &file, file_id).expect("extract TypeScript fixture");
    builder.finish()
}

/// Creates one TypeScript source snapshot.
fn source(path: &str, content: &str) -> SourceInput {
    SourceInput {
        path: PathBuf::from(path),
        language_id: "typescript".to_string(),
        content: content.to_string(),
        size_bytes: content.len(),
    }
}
