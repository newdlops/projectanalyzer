//! Language analyzer dispatch for the Rust engine.

mod call_resolution;
mod javascript_like;
mod lexical_scan;
mod python_like;

pub use crate::model::SourceInput;

use crate::graph::ProjectGraphBuilder;

/// Adds file and symbol nodes for a single source file.
pub fn analyze_source_file(
    builder: &mut ProjectGraphBuilder,
    file: SourceInput,
) -> Result<(), String> {
    let python_syntax = (file.language_id == "python")
        .then(|| python_like::syntax::PythonSyntaxSnapshot::new(&file.content));
    analyze_source_file_with_syntax(builder, &file, python_syntax.as_ref())
}

/// Adds every source and workspace edge while sharing one Python syntax snapshot.
pub fn analyze_source_files(
    builder: &mut ProjectGraphBuilder,
    files: &[SourceInput],
) -> Result<(), String> {
    let python_syntax = python_like::syntax::scan_workspace_sources(files);

    for file in files {
        analyze_source_file_with_syntax(builder, file, python_syntax.get(&file.path))?;
    }

    javascript_like::add_import_edges(builder, files);
    python_like::add_import_edges(builder, files, &python_syntax);
    call_resolution::resolve_imported_calls(builder, files, &python_syntax);
    Ok(())
}

/// Dispatches one source using a precomputed language-specific syntax view.
fn analyze_source_file_with_syntax(
    builder: &mut ProjectGraphBuilder,
    file: &SourceInput,
    python_syntax: Option<&python_like::syntax::PythonSyntaxSnapshot>,
) -> Result<(), String> {
    let file_id = builder.add_file(file);

    match file.language_id.as_str() {
        "typescript" | "javascript" => javascript_like::extract_symbols(builder, file, file_id),
        "python" => {
            let syntax = python_syntax
                .ok_or_else(|| "missing Python syntax snapshot for source file".to_string())?;
            python_like::extract_symbols(builder, file, file_id, syntax)
        }
        language_id if is_file_only_language(language_id) => Ok(()),
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

/// Returns whether a language is scanned for metadata without symbol extraction.
fn is_file_only_language(language_id: &str) -> bool {
    matches!(
        language_id,
        "vue" | "svelte" | "rust" | "go" | "java" | "kotlin" | "php" | "ruby"
    )
}
