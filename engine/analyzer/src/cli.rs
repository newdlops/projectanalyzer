//! CLI parsing for the Rust analyzer engine.
//!
//! The parser uses only the standard library so the engine can build quickly in
//! fresh workspaces without fetching dependencies.

use std::path::PathBuf;

/// Parsed engine command.
pub enum Command {
    AnalyzeWorkspace(AnalyzeWorkspaceOptions),
    AnalyzeStdin(AnalyzeStdinOptions),
}

/// Top-level parsed CLI arguments.
pub struct EngineArgs {
    pub command: Command,
}

/// Options for workspace analysis.
pub struct AnalyzeWorkspaceOptions {
    pub workspace_root: PathBuf,
    pub max_file_size_kb: usize,
}

/// Options for current-file analysis through stdin.
pub struct AnalyzeStdinOptions {
    pub workspace_root: PathBuf,
    pub file_path: PathBuf,
    pub language_id: String,
}

impl EngineArgs {
    /// Parses command-line arguments into a typed command.
    pub fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut tokens = args.into_iter();
        let command_name = tokens.next().ok_or_else(|| {
            "missing command: expected analyze-workspace or analyze-stdin".to_string()
        })?;

        match command_name.as_str() {
            "analyze-workspace" => Ok(Self {
                command: Command::AnalyzeWorkspace(parse_analyze_workspace(tokens)?),
            }),
            "analyze-stdin" => Ok(Self {
                command: Command::AnalyzeStdin(parse_analyze_stdin(tokens)?),
            }),
            _ => Err(format!("unknown command: {command_name}")),
        }
    }
}

/// Parses workspace analysis flags.
fn parse_analyze_workspace<I>(tokens: I) -> Result<AnalyzeWorkspaceOptions, String>
where
    I: IntoIterator<Item = String>,
{
    let mut workspace_root: Option<PathBuf> = None;
    let mut max_file_size_kb = 1024usize;
    let mut iterator = tokens.into_iter();

    while let Some(token) = iterator.next() {
        match token.as_str() {
            "--workspace" => {
                workspace_root = Some(PathBuf::from(required_value(
                    "--workspace",
                    iterator.next(),
                )?));
            }
            "--max-file-size-kb" => {
                let value = required_value("--max-file-size-kb", iterator.next())?;
                max_file_size_kb = value
                    .parse::<usize>()
                    .map_err(|error| format!("invalid --max-file-size-kb value: {error}"))?;
            }
            _ => return Err(format!("unknown analyze-workspace flag: {token}")),
        }
    }

    Ok(AnalyzeWorkspaceOptions {
        workspace_root: workspace_root.ok_or_else(|| "missing --workspace".to_string())?,
        max_file_size_kb,
    })
}

/// Parses current-file stdin analysis flags.
fn parse_analyze_stdin<I>(tokens: I) -> Result<AnalyzeStdinOptions, String>
where
    I: IntoIterator<Item = String>,
{
    let mut workspace_root: Option<PathBuf> = None;
    let mut file_path: Option<PathBuf> = None;
    let mut language_id: Option<String> = None;
    let mut iterator = tokens.into_iter();

    while let Some(token) = iterator.next() {
        match token.as_str() {
            "--workspace" => {
                workspace_root = Some(PathBuf::from(required_value(
                    "--workspace",
                    iterator.next(),
                )?));
            }
            "--path" => {
                file_path = Some(PathBuf::from(required_value("--path", iterator.next())?));
            }
            "--language" => {
                language_id = Some(required_value("--language", iterator.next())?);
            }
            _ => return Err(format!("unknown analyze-stdin flag: {token}")),
        }
    }

    Ok(AnalyzeStdinOptions {
        workspace_root: workspace_root.ok_or_else(|| "missing --workspace".to_string())?,
        file_path: file_path.ok_or_else(|| "missing --path".to_string())?,
        language_id: language_id.ok_or_else(|| "missing --language".to_string())?,
    })
}

/// Returns a required flag value or a descriptive error.
fn required_value(flag: &str, value: Option<String>) -> Result<String, String> {
    value.ok_or_else(|| format!("missing value for {flag}"))
}
