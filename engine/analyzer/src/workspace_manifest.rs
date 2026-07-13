//! Host-selected workspace source manifest reader.
//!
//! The extension host owns VS Code glob matching and dirty document snapshots.
//! This module only decodes its length-prefixed UTF-8 protocol, keeping the Rust
//! engine dependency-free and avoiding command-line or newline escaping limits.

use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;

use crate::model::SourceInput;

/// Protocol version expected on the first manifest line.
const MANIFEST_VERSION: &str = "project-analyzer-workspace-v1";

/// Safety limit matching the extension adapter's workspace search ceiling.
const MAX_MANIFEST_FILES: usize = 10_000;

/// Maximum accepted path field size in UTF-8 bytes.
const MAX_PATH_BYTES: usize = 1024 * 1024;

/// Maximum accepted language ID size in UTF-8 bytes.
const MAX_LANGUAGE_ID_BYTES: usize = 1024;

///
/// Reads source snapshots chosen by the extension host. Files larger than the
/// configured limit are consumed but omitted, matching filesystem scan behavior.
/// Length prefixes allow file content to contain arbitrary newlines or NUL bytes.
pub fn read_workspace_source_manifest<R: Read>(
    input: R,
    max_file_size_kb: usize,
) -> Result<Vec<SourceInput>, String> {
    let mut reader = BufReader::new(input);
    let version = read_line(&mut reader, "manifest version")?;

    if version != MANIFEST_VERSION {
        return Err(format!(
            "unsupported workspace source manifest version: {version}"
        ));
    }

    let file_count = read_length(&mut reader, "file count")?;
    if file_count > MAX_MANIFEST_FILES {
        return Err(format!(
            "workspace source manifest contains {file_count} files; maximum is {MAX_MANIFEST_FILES}"
        ));
    }

    let max_file_size_bytes = max_file_size_kb.saturating_mul(1024);
    let mut files = Vec::with_capacity(file_count);

    for index in 0..file_count {
        let path_length = read_bounded_length(&mut reader, "path", MAX_PATH_BYTES)?;
        let language_length =
            read_bounded_length(&mut reader, "language ID", MAX_LANGUAGE_ID_BYTES)?;
        let content_length = read_length(&mut reader, "content")?;
        let path = read_utf8_field(&mut reader, path_length, "path")?;
        let language_id = read_utf8_field(&mut reader, language_length, "language ID")?;

        if path.is_empty() {
            return Err(format!(
                "workspace source manifest file {index} has an empty path"
            ));
        }
        if language_id.is_empty() {
            return Err(format!(
                "workspace source manifest file {index} has an empty language ID"
            ));
        }

        if content_length > max_file_size_bytes {
            discard_field(&mut reader, content_length, "content")?;
            continue;
        }

        let content = read_utf8_field(&mut reader, content_length, "content")?;
        files.push(SourceInput {
            path: PathBuf::from(path),
            language_id,
            size_bytes: content_length,
            content,
        });
    }

    let mut trailing = [0u8; 1];
    if reader
        .read(&mut trailing)
        .map_err(|error| format!("failed to read workspace source manifest: {error}"))?
        != 0
    {
        return Err("workspace source manifest has trailing bytes".to_string());
    }

    Ok(files)
}

/// Reads one newline-terminated UTF-8 header value.
fn read_line<R: BufRead>(reader: &mut R, label: &str) -> Result<String, String> {
    let mut bytes = Vec::new();
    let bytes_read = reader
        .read_until(b'\n', &mut bytes)
        .map_err(|error| format!("failed to read workspace source manifest {label}: {error}"))?;

    if bytes_read == 0 || bytes.last() != Some(&b'\n') {
        return Err(format!(
            "workspace source manifest {label} is not newline terminated"
        ));
    }

    bytes.pop();
    String::from_utf8(bytes)
        .map_err(|error| format!("workspace source manifest {label} is not UTF-8: {error}"))
}

/// Reads one decimal byte length header.
fn read_length<R: BufRead>(reader: &mut R, label: &str) -> Result<usize, String> {
    let value = read_line(reader, label)?;
    value
        .parse::<usize>()
        .map_err(|error| format!("invalid workspace source manifest {label} length: {error}"))
}

/// Reads a byte length and rejects fields too large for their metadata role.
fn read_bounded_length<R: BufRead>(
    reader: &mut R,
    label: &str,
    maximum: usize,
) -> Result<usize, String> {
    let length = read_length(reader, label)?;
    if length > maximum {
        return Err(format!(
            "workspace source manifest {label} is {length} bytes; maximum is {maximum}"
        ));
    }
    Ok(length)
}

/// Reads an exact byte count and validates that it is UTF-8.
fn read_utf8_field<R: Read>(reader: &mut R, length: usize, label: &str) -> Result<String, String> {
    let mut bytes = vec![0u8; length];
    reader
        .read_exact(&mut bytes)
        .map_err(|error| format!("failed to read workspace source manifest {label}: {error}"))?;
    String::from_utf8(bytes)
        .map_err(|error| format!("workspace source manifest {label} is not UTF-8: {error}"))
}

/// Consumes an oversized field without allocating its declared length.
fn discard_field<R: Read>(reader: &mut R, length: usize, label: &str) -> Result<(), String> {
    let copied = std::io::copy(&mut reader.take(length as u64), &mut std::io::sink())
        .map_err(|error| format!("failed to discard workspace source manifest {label}: {error}"))?;

    if copied != length as u64 {
        return Err(format!(
            "workspace source manifest {label} ended after {copied} of {length} bytes"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::read_workspace_source_manifest;

    /// Builds a protocol record while keeping expected byte lengths readable.
    fn manifest_record(path: &str, language_id: &str, content: &str) -> Vec<u8> {
        let mut bytes =
            format!("{}\n{}\n{}\n", path.len(), language_id.len(), content.len()).into_bytes();
        bytes.extend_from_slice(path.as_bytes());
        bytes.extend_from_slice(language_id.as_bytes());
        bytes.extend_from_slice(content.as_bytes());
        bytes
    }

    /// Preserves UTF-8 paths and source text containing newlines and NUL bytes.
    #[test]
    fn reads_length_prefixed_source_snapshots() {
        let mut payload = b"project-analyzer-workspace-v1\n1\n".to_vec();
        payload.extend(manifest_record(
            "/workspace/한글.ts",
            "typescript",
            "const line = '\0';\n",
        ));

        let files = read_workspace_source_manifest(payload.as_slice(), 1024)
            .expect("manifest should parse");

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path.to_string_lossy(), "/workspace/한글.ts");
        assert_eq!(files[0].language_id, "typescript");
        assert_eq!(files[0].content, "const line = '\0';\n");
    }

    /// Oversized content is skipped while the following record remains aligned.
    #[test]
    fn skips_oversized_source_and_reads_next_record() {
        let mut payload = b"project-analyzer-workspace-v1\n2\n".to_vec();
        let oversized_content = "x".repeat(1025);
        payload.extend(manifest_record(
            "/workspace/large.ts",
            "typescript",
            &oversized_content,
        ));
        payload.extend(manifest_record("/workspace/small.py", "python", "x = 1"));

        let files = read_workspace_source_manifest(payload.as_slice(), 1)
            .expect("manifest should remain aligned");

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path.to_string_lossy(), "/workspace/small.py");
    }

    /// Rejects bytes after the declared records to expose producer bugs early.
    #[test]
    fn rejects_trailing_bytes() {
        let payload = b"project-analyzer-workspace-v1\n0\nunexpected";
        let error = match read_workspace_source_manifest(payload.as_slice(), 1024) {
            Ok(_) => panic!("trailing bytes should fail"),
            Err(error) => error,
        };

        assert!(error.contains("trailing bytes"));
    }
}
