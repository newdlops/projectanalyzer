//! JSON serialization helpers.
//!
//! The engine keeps serialization dependency-free for now. These helpers only
//! cover the graph payload shapes emitted by this crate.

use crate::model::{AnalysisDiagnostic, GraphEdge, ProjectGraph, SourceRange, SymbolNode};

impl ProjectGraph {
    /// Serializes a ProjectGraph-compatible JSON payload.
    pub fn to_json(&self) -> String {
        let mut output = String::new();
        output.push('{');
        push_string_field(&mut output, "workspaceRoot", &self.workspace_root);
        output.push(',');
        push_string_field(&mut output, "version", &self.version);
        output.push(',');
        push_string_field(&mut output, "generatedAt", &self.generated_at);
        output.push(',');
        push_array(&mut output, "nodes", &self.nodes, push_node);
        output.push(',');
        push_array(&mut output, "edges", &self.edges, push_edge);
        output.push(',');
        push_array(
            &mut output,
            "diagnostics",
            &self.diagnostics,
            push_diagnostic,
        );
        output.push(',');
        output.push_str("\"metadata\":{");
        push_string_array(&mut output, "languages", &self.languages);
        output.push(',');
        push_number_field(&mut output, "fileCount", self.file_count);
        output.push(',');
        push_number_field(&mut output, "symbolCount", self.nodes.len());
        output.push(',');
        push_number_field(&mut output, "edgeCount", self.edges.len());
        output.push('}');
        output.push('}');
        output
    }
}

/// Serializes a graph node.
fn push_node(output: &mut String, node: &SymbolNode) {
    output.push('{');
    push_string_field(output, "id", &node.id);
    output.push(',');
    push_string_field(output, "kind", &node.kind);
    output.push(',');
    push_string_field(output, "name", &node.name);
    output.push(',');
    push_string_field(output, "qualifiedName", &node.qualified_name);
    output.push(',');
    push_string_field(output, "filePath", &node.file_path);
    output.push(',');
    push_range(output, "range", &node.range);
    output.push(',');
    push_range(output, "selectionRange", &node.selection_range);
    output.push(',');
    push_string_field(output, "language", &node.language);

    if let Some(parent_id) = &node.parent_id {
        output.push(',');
        push_string_field(output, "parentId", parent_id);
    }

    if let Some(size_bytes) = node.size_bytes {
        output.push(',');
        output.push_str("\"metadata\":{");
        push_number_field(output, "sizeBytes", size_bytes);
        output.push('}');
    }

    output.push('}');
}

/// Serializes a graph edge.
fn push_edge(output: &mut String, edge: &GraphEdge) {
    output.push('{');
    push_string_field(output, "id", &edge.id);
    output.push(',');
    push_string_field(output, "kind", &edge.kind);
    output.push(',');
    push_string_field(output, "sourceId", &edge.source_id);
    output.push(',');
    push_string_field(output, "targetId", &edge.target_id);
    output.push(',');
    push_string_field(output, "filePath", &edge.file_path);
    output.push(',');
    push_range(output, "range", &edge.range);
    output.push(',');
    push_string_field(output, "confidence", &edge.confidence);
    output.push('}');
}

/// Serializes an analysis diagnostic.
fn push_diagnostic(output: &mut String, diagnostic: &AnalysisDiagnostic) {
    output.push('{');
    push_string_field(output, "severity", &diagnostic.severity);
    output.push(',');
    push_string_field(output, "code", &diagnostic.code);
    output.push(',');
    push_string_field(output, "message", &diagnostic.message);

    if let Some(file_path) = &diagnostic.file_path {
        output.push(',');
        push_string_field(output, "filePath", file_path);
    }

    output.push('}');
}

/// Serializes a named SourceRange object.
fn push_range(output: &mut String, name: &str, range: &SourceRange) {
    output.push('"');
    output.push_str(name);
    output.push_str("\":{");
    push_number_field(output, "startLine", range.start_line);
    output.push(',');
    push_number_field(output, "startCharacter", range.start_character);
    output.push(',');
    push_number_field(output, "endLine", range.end_line);
    output.push(',');
    push_number_field(output, "endCharacter", range.end_character);
    output.push('}');
}

/// Serializes an array field using a callback for each element.
fn push_array<T>(output: &mut String, name: &str, values: &[T], push_item: fn(&mut String, &T)) {
    output.push('"');
    output.push_str(name);
    output.push_str("\":[");

    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            output.push(',');
        }

        push_item(output, value);
    }

    output.push(']');
}

/// Serializes a string array field.
fn push_string_array(output: &mut String, name: &str, values: &[String]) {
    output.push('"');
    output.push_str(name);
    output.push_str("\":[");

    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            output.push(',');
        }

        push_json_string(output, value);
    }

    output.push(']');
}

/// Serializes a string field.
fn push_string_field(output: &mut String, name: &str, value: &str) {
    output.push('"');
    output.push_str(name);
    output.push_str("\":");
    push_json_string(output, value);
}

/// Serializes a number field.
fn push_number_field(output: &mut String, name: &str, value: usize) {
    output.push('"');
    output.push_str(name);
    output.push_str("\":");
    output.push_str(&value.to_string());
}

/// Serializes a JSON string with the escape sequences needed for graph payloads.
fn push_json_string(output: &mut String, value: &str) {
    output.push('"');

    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            control if control.is_control() => {
                output.push_str(&format!("\\u{:04x}", control as u32));
            }
            normal => output.push(normal),
        }
    }

    output.push('"');
}
