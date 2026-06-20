//! Manifest-based language framework detection.
//!
//! The detector scans workspace manifests iteratively and records conservative
//! framework evidence from dependency and script declarations.

mod detectors;
mod manifest_scan;
mod parse;

#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use crate::model::DetectedFramework;

use self::detectors::detect_manifest;
use self::manifest_scan::scan_manifest_files;

const MAX_MANIFEST_SIZE_BYTES: u64 = 1024 * 1024;

/// Scans a workspace for known ecosystem manifests and returns framework metadata.
pub fn detect_frameworks(workspace_root: &Path) -> Result<Vec<DetectedFramework>, String> {
    let manifests = scan_manifest_files(workspace_root)?;
    let mut accumulator = FrameworkAccumulator::new();

    for manifest in manifests {
        let metadata = fs::metadata(&manifest.path).map_err(|error| {
            format!(
                "failed to read manifest metadata {}: {error}",
                manifest.path.display()
            )
        })?;

        if metadata.len() > MAX_MANIFEST_SIZE_BYTES {
            continue;
        }

        let content = fs::read_to_string(&manifest.path).map_err(|error| {
            format!(
                "failed to read manifest {}: {error}",
                manifest.path.display()
            )
        })?;
        detect_manifest(&manifest, &content, &mut accumulator);
    }

    Ok(accumulator.finish())
}

/// Static framework definition shared by manifest-specific detectors.
pub(super) struct FrameworkDefinition {
    pub(super) name: &'static str,
    pub(super) ecosystem: &'static str,
    pub(super) category: &'static str,
}

/// Mutable aggregation state that merges evidence for one framework/root pair.
pub(super) struct FrameworkAccumulator {
    entries: BTreeMap<String, FrameworkDraft>,
}

/// Detection under construction before evidence is sorted for serialization.
struct FrameworkDraft {
    framework: DetectedFramework,
    evidence: BTreeSet<String>,
    confidence_rank: usize,
}

impl FrameworkAccumulator {
    /// Creates an empty accumulator for one workspace detection run.
    fn new() -> Self {
        Self {
            entries: BTreeMap::new(),
        }
    }

    /// Adds one evidence string and keeps the highest confidence seen so far.
    pub(super) fn add(
        &mut self,
        root_path: &str,
        definition: &FrameworkDefinition,
        confidence: &str,
        evidence: String,
    ) {
        let key = format!(
            "{}\u{1f}{}\u{1f}{}",
            root_path, definition.ecosystem, definition.name
        );
        let confidence_rank = confidence_rank(confidence);
        let entry = self.entries.entry(key).or_insert_with(|| FrameworkDraft {
            framework: DetectedFramework {
                name: definition.name.to_string(),
                ecosystem: definition.ecosystem.to_string(),
                category: definition.category.to_string(),
                confidence: confidence.to_string(),
                root_path: Some(root_path.to_string()),
                evidence: Vec::new(),
            },
            evidence: BTreeSet::new(),
            confidence_rank,
        });

        if confidence_rank > entry.confidence_rank {
            entry.confidence_rank = confidence_rank;
            entry.framework.confidence = confidence.to_string();
        }

        entry.evidence.insert(evidence);
    }

    /// Returns stable framework rows sorted by root path, ecosystem, and name.
    fn finish(self) -> Vec<DetectedFramework> {
        self.entries
            .into_values()
            .map(|mut draft| {
                draft.framework.evidence = draft.evidence.into_iter().collect();
                draft.framework
            })
            .collect()
    }
}

/// Assigns comparable ranks to supported confidence values.
fn confidence_rank(confidence: &str) -> usize {
    match confidence {
        "high" => 3,
        "medium" => 2,
        "low" => 1,
        _ => 0,
    }
}
