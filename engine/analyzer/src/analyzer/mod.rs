//! Language analyzer dispatch for the Rust engine.

mod javascript_like;
mod python_like;

pub use crate::model::SourceInput;

use crate::graph::ProjectGraphBuilder;

/// Adds file and symbol nodes for a single source file.
pub fn analyze_source_file(
    builder: &mut ProjectGraphBuilder,
    file: SourceInput,
) -> Result<(), String> {
    let file_id = builder.add_file(&file);

    match file.language_id.as_str() {
        "typescript" | "javascript" => javascript_like::extract_symbols(builder, &file, file_id),
        "python" => python_like::extract_symbols(builder, &file, file_id),
        _ => {
            builder.add_diagnostic(
                "analysis.unsupportedLanguage",
                format!("unsupported language: {}", file.language_id),
                Some(file.path.to_string_lossy().to_string()),
            );
            Ok(())
        }
    }
}

/// Adds workspace-level edges that require the full source file set.
pub fn analyze_workspace_edges(builder: &mut ProjectGraphBuilder, files: &[SourceInput]) {
    javascript_like::add_import_edges(builder, files);
}
