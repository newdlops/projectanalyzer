//! Native graph regressions for conservative same-file typed receiver candidates.

use std::path::PathBuf;

use crate::graph::ProjectGraphBuilder;
use crate::model::{ProjectGraph, SourceInput};

use super::extract_symbols;

const CLASS: &str = "class ReadMath {\n  bias: number = 5;\n  mix(value: number): number {\n    return this.bias + value;\n  }\n}\n";

#[test]
fn infers_declared_receiver_method_without_claiming_runtime_dispatch() {
    let graph = analyze(&format!(
        "export function inspectMethods(service: ReadMath, amount: number): number {{\n  return service.mix(amount);\n}}\n{CLASS}"
    ), "typescript");
    let call = graph.edges.iter().find(|edge| edge.kind == "calls").expect("source call");
    let target = graph.nodes.iter().find(|node| node.id == call.target_id).expect("target");
    assert_eq!(target.qualified_name, "ReadMath.mix");
    assert_eq!(target.kind, "method");
    assert_eq!(call.confidence, "inferred");
    assert_eq!(call.range.start_line, 1);
    assert_eq!(call.range.start_character, 9);
    assert_eq!(call.range.end_character, 21);
    assert!(!graph.nodes.iter().any(|node| node.kind == "external"));
}

#[test]
fn preserves_unknown_receivers_and_unsupported_parameter_types() {
    for parameter in [
        "service", "service: Unknown", "service?: ReadMath", "service: ReadMath = fallback",
        "service: ReadMath | Other", "service: ReadMath & Other", "service: ReadMath[]",
        "service: ReadMath<number>", "service: ReadMath.Member", "...service: ReadMath",
        "{ service }: ReadMath", "service: { mix: Function }",
    ] {
        assert_unresolved(&format!(
            "function inspectMethods({parameter}) {{\n  service.mix(1);\n}}\n{CLASS}"
        ));
    }
}

#[test]
fn refuses_duplicate_owners_and_overloaded_or_duplicate_methods() {
    assert_unresolved(&format!(
        "function inspectMethods(service: ReadMath) {{\n  service.mix(1);\n}}\n{CLASS}{CLASS}"
    ));
    assert_unresolved(
        "function inspectMethods(service: ReadMath) {\n  service.mix(1);\n}\nclass ReadMath {\n  mix(value: number): number;\n  mix(value: number) { return value; }\n}\n"
    );
    assert_unresolved(
        "function inspectMethods(service: ReadMath) {\n  service.mix(1);\n}\ninterface ReadMath {\n  mix(value: number): number;\n}\n"
    );
}

#[test]
fn invalidates_shadowed_or_reassigned_parameter_hints_for_the_whole_callable() {
    for statement in [
        "let service = replacement;", "const service = replacement;", "var service = replacement;",
        "service = replacement;", "service += replacement;", "service ||= replacement;",
        "service++;", "++service;", "catch (service) {}",
        "const { service } = replacement;", "let [service] = replacement;",
        "function service() {}", "class Other {}",
    ] {
        assert_unresolved(&format!(
            "function inspectMethods(service: ReadMath) {{\n  service.mix(1);\n  {statement}\n}}\n{CLASS}"
        ));
    }
}

#[test]
fn receiver_name_shadow_does_not_fall_back_to_a_same_named_class() {
    assert_unresolved(
        "function inspectMethods(ReadMath) {\n  ReadMath.mix(1);\n}\nclass ReadMath {\n  mix(value: number) { return value; }\n}\n"
    );
}

#[test]
fn excludes_unresolved_generic_and_nested_binding_scopes() {
    for declaration in [
        "function inspectMethods<ReadMath>(service: ReadMath) {",
        "function outer() {\nfunction inspectMethods(service: ReadMath) {",
        "class Outer<ReadMath> {\ninspectMethods(service: ReadMath) {",
    ] {
        assert_unresolved(&format!("{declaration}\n  service.mix(1);\n}}\n}}\n{CLASS}"));
    }
    let graph = analyze(&format!(
        "function inspectMethods(service: ReadMath) {{\n  service.mix(1);\n}}\n{CLASS}"
    ), "javascript");
    assert!(graph.edges.iter().filter(|edge| edge.kind == "calls").all(|edge| edge.confidence == "unresolved"));
}

/// Runs the production native JavaScript-like graph extractor on public fixture text.
fn analyze(content: &str, language: &str) -> ProjectGraph {
    let file = SourceInput {
        path: PathBuf::from("/workspace/MethodReads.ts"),
        language_id: language.to_string(),
        content: content.to_string(),
        size_bytes: content.len(),
    };
    let mut builder = ProjectGraphBuilder::new(PathBuf::from("/workspace"));
    let id = builder.add_file(&file);
    extract_symbols(&mut builder, &file, id).expect("native fixture graph");
    builder.finish()
}

/// Ensures the receiver call remains a placeholder instead of selecting a lookalike method.
fn assert_unresolved(content: &str) {
    let graph = analyze(content, "typescript");
    let call = graph.edges.iter().find(|edge| {
        edge.kind == "calls" && graph.nodes.iter().any(|node| {
            node.id == edge.source_id && node.name == "inspectMethods"
        })
    }).expect("receiver source call");
    assert_eq!(call.confidence, "unresolved", "{content}");
    let target = graph.nodes.iter().find(|node| node.id == call.target_id).expect("target");
    assert_eq!(target.kind, "external", "{content}");
}
