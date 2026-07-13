//! Project Analyzer Rust engine entrypoint.
//!
//! The engine owns fast filesystem scanning and lightweight symbol extraction.
//! It prints a ProjectGraph-compatible JSON payload to stdout so the VS Code
//! extension host can stay focused on UI and editor integration.

mod analyzer;
mod cli;
mod framework_detection;
mod framework_units;
mod fs_scan;
mod graph;
mod json;
mod model;
mod workspace_manifest;

use std::collections::BTreeSet;
use std::fs;
use std::io::{self, Read};
use std::path::PathBuf;

use analyzer::{analyze_source_file, analyze_workspace_edges, SourceInput};
use cli::{Command, EngineArgs};
use framework_detection::detect_frameworks;
use framework_units::analyze_framework_units;
use fs_scan::{scan_workspace, ScanOptions};
use graph::ProjectGraphBuilder;
use workspace_manifest::read_workspace_source_manifest;

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

/// Runs the requested engine command and writes graph JSON to stdout.
fn run() -> Result<(), String> {
    let args = EngineArgs::parse(std::env::args().skip(1))?;

    match args.command {
        Command::AnalyzeWorkspace(options) => {
            let workspace_root = options.workspace_root.clone();
            let source_manifest_stdin = options.source_manifest_stdin;
            // Manifest mode keeps VS Code's configured glob and dirty-document
            // semantics authoritative. Direct CLI callers retain filesystem scanning.
            let files = if options.source_manifest_stdin {
                read_workspace_source_manifest(io::stdin(), options.max_file_size_kb)?
            } else {
                scan_workspace(&ScanOptions {
                    workspace_root: options.workspace_root.clone(),
                    max_file_size_kb: options.max_file_size_kb,
                })?
            };
            let mut builder = ProjectGraphBuilder::new(options.workspace_root);

            for file in files.iter().cloned() {
                analyze_source_file(&mut builder, file)?;
            }

            analyze_workspace_edges(&mut builder, &files);
            let frameworks = detect_frameworks(&workspace_root)?;
            let mut framework_units = analyze_framework_units(&workspace_root, &frameworks)?;
            if source_manifest_stdin {
                // Framework adapters still scan project conventions from disk. Limit
                // their output to selected, saved-equivalent sources so excluded or
                // dirty files cannot re-enter the manifest-backed result as stale units.
                framework_units.retain_source_files(&saved_source_paths(&files));
            }
            builder.add_framework_units(framework_units.units, framework_units.edges);
            builder.add_frameworks(frameworks);
            println!("{}", builder.finish().to_json());
            Ok(())
        }
        Command::AnalyzeStdin(options) => {
            let mut content = String::new();
            io::stdin()
                .read_to_string(&mut content)
                .map_err(|error| format!("failed to read stdin: {error}"))?;

            let mut builder = ProjectGraphBuilder::new(options.workspace_root);
            analyze_source_file(
                &mut builder,
                SourceInput {
                    path: options.file_path,
                    language_id: options.language_id,
                    size_bytes: content.len(),
                    content,
                },
            )?;

            println!("{}", builder.finish().to_json());
            Ok(())
        }
    }
}

/// Returns selected source paths whose manifest content still matches disk.
/// Dirty snapshots remain authoritative for core symbols but their framework
/// units are omitted until framework adapters accept in-memory source inputs.
fn saved_source_paths(files: &[SourceInput]) -> BTreeSet<PathBuf> {
    files
        .iter()
        .filter(|file| {
            fs::read(&file.path)
                .map(|content| content == file.content.as_bytes())
                .unwrap_or(false)
        })
        .map(|file| file.path.clone())
        .collect()
}
