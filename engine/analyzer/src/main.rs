//! Project Analyzer Rust engine entrypoint.
//!
//! The engine owns fast filesystem scanning and lightweight symbol extraction.
//! It prints a ProjectGraph-compatible JSON payload to stdout so the VS Code
//! extension host can stay focused on UI and editor integration.

mod analyzer;
mod cli;
mod framework_detection;
mod fs_scan;
mod graph;
mod json;
mod model;

use std::io::{self, Read};

use analyzer::{analyze_source_file, analyze_workspace_edges, SourceInput};
use cli::{Command, EngineArgs};
use framework_detection::detect_frameworks;
use fs_scan::{scan_workspace, ScanOptions};
use graph::ProjectGraphBuilder;

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
            let files = scan_workspace(&ScanOptions {
                workspace_root: options.workspace_root.clone(),
                max_file_size_kb: options.max_file_size_kb,
            })?;
            let mut builder = ProjectGraphBuilder::new(options.workspace_root);

            for file in files.iter().cloned() {
                analyze_source_file(&mut builder, file)?;
            }

            analyze_workspace_edges(&mut builder, &files);
            builder.add_frameworks(detect_frameworks(&workspace_root)?);
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
