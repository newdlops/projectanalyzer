//! Manifest-based framework and project package evidence detection.
//!
//! One iterative workspace scan feeds both neutral package roots and conservative
//! framework evidence from dependency and script declarations.

mod detectors;
mod django_project_scan;
mod manifest_scan;
mod parse;

#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use crate::model::{DetectedFramework, ProjectPackageRoot};

use self::detectors::detect_manifest;
use self::django_project_scan::scan_django_project_roots;
use self::manifest_scan::scan_manifest_files;

const MAX_MANIFEST_SIZE_BYTES: u64 = 1024 * 1024;
pub(super) const DJANGO_DEFINITION: FrameworkDefinition = FrameworkDefinition {
    name: "Django",
    ecosystem: "python",
    category: "backend",
};

/// Workspace metadata derived while reusing one iterative manifest scan.
pub struct ManifestDetectionResult {
    /// Framework-specific facts derived from manifest contents and project markers.
    pub frameworks: Vec<DetectedFramework>,
    /// Neutral package boundaries derived only from supported manifest filenames.
    pub project_package_roots: Vec<ProjectPackageRoot>,
}

/// Compatibility wrapper that returns only framework-specific metadata.
///
/// The engine entrypoint consumes the richer result below, while framework-unit
/// tests and internal callers can keep their existing framework-only contract.
#[allow(dead_code)]
pub fn detect_frameworks(workspace_root: &Path) -> Result<Vec<DetectedFramework>, String> {
    Ok(detect_frameworks_and_project_package_roots(workspace_root)?.frameworks)
}

/// Detects frameworks and neutral package roots from one manifest discovery pass.
///
/// Django project markers remain a supplemental framework signal, while package
/// roots are based only on the manifests returned by the iterative scanner.
pub fn detect_frameworks_and_project_package_roots(
    workspace_root: &Path,
) -> Result<ManifestDetectionResult, String> {
    let manifests = scan_manifest_files(workspace_root)?;
    let project_package_roots = create_project_package_roots(&manifests);
    let django_project_roots = scan_django_project_roots(workspace_root)?;
    let mut accumulator = FrameworkAccumulator::new();

    for manifest in &manifests {
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
        detect_manifest(manifest, &content, &mut accumulator);
    }

    for project_root in &django_project_roots {
        accumulator.add(
            &project_root.root_path,
            &DJANGO_DEFINITION,
            "high",
            project_root.evidence.clone(),
        );
    }
    let django_project_root_paths = django_project_roots
        .iter()
        .map(|root| root.root_path.clone())
        .collect::<Vec<_>>();
    accumulator.suppress_django_ancestor_roots(&django_project_root_paths);

    Ok(ManifestDetectionResult {
        frameworks: accumulator.finish(),
        project_package_roots,
    })
}

/// Merges manifest paths and ecosystem labels by their exact package root.
fn create_project_package_roots(
    manifests: &[manifest_scan::ManifestFile],
) -> Vec<ProjectPackageRoot> {
    let mut drafts_by_root = BTreeMap::<String, ProjectPackageRootDraft>::new();

    for manifest in manifests {
        let draft = drafts_by_root
            .entry(manifest.root_path.clone())
            .or_default();
        draft.manifest_paths.insert(manifest.manifest_path.clone());
        draft.ecosystems.insert(manifest.ecosystem.to_string());
    }

    drafts_by_root
        .into_iter()
        .map(|(root_path, draft)| ProjectPackageRoot {
            root_path,
            manifest_paths: draft.manifest_paths.into_iter().collect(),
            ecosystems: draft.ecosystems.into_iter().collect(),
        })
        .collect()
}

/// Deterministic set-backed package evidence accumulated before serialization.
#[derive(Default)]
struct ProjectPackageRootDraft {
    manifest_paths: BTreeSet<String>,
    ecosystems: BTreeSet<String>,
}

/// Static framework definition shared by manifest-specific detectors.
#[derive(Clone, Copy)]
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

    /// Removes broad Django rows that only represent a parent package root.
    ///
    /// Monorepos often keep a shared Python manifest at the repository root while
    /// hosting multiple concrete Django projects under child directories. Those
    /// child roots should drive semantic analysis so that each project is shown
    /// as a separate framework tree and the parent manifest does not rescan all
    /// projects as one large Django app.
    pub(super) fn suppress_django_ancestor_roots(&mut self, concrete_root_paths: &[String]) {
        if concrete_root_paths.is_empty() {
            return;
        }

        let keys_to_remove = self
            .entries
            .iter()
            .filter_map(|(key, draft)| {
                if !is_django_framework(&draft.framework) {
                    return None;
                }

                let root_path = draft.framework.root_path.as_deref().unwrap_or(".");
                if concrete_root_paths
                    .iter()
                    .any(|concrete| same_root_path(root_path, concrete))
                {
                    return None;
                }

                if concrete_root_paths
                    .iter()
                    .any(|concrete| is_proper_ancestor_root(root_path, concrete))
                {
                    return Some(key.clone());
                }

                None
            })
            .collect::<Vec<_>>();

        for key in keys_to_remove {
            self.entries.remove(&key);
        }
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

/// Returns whether a detected row is the canonical Django framework row.
fn is_django_framework(framework: &DetectedFramework) -> bool {
    framework.name == DJANGO_DEFINITION.name && framework.ecosystem == DJANGO_DEFINITION.ecosystem
}

/// Compares framework root labels after normalizing empty labels to workspace root.
fn same_root_path(left: &str, right: &str) -> bool {
    normalize_root_path(left) == normalize_root_path(right)
}

/// Returns whether `candidate` is a strict workspace-relative ancestor of `child`.
fn is_proper_ancestor_root(candidate: &str, child: &str) -> bool {
    let candidate = normalize_root_path(candidate);
    let child = normalize_root_path(child);

    if candidate == child {
        return false;
    }

    if candidate == "." {
        return child != ".";
    }

    child
        .strip_prefix(candidate)
        .map(|suffix| suffix.starts_with('/'))
        .unwrap_or(false)
}

/// Normalizes root labels emitted by detector helpers.
fn normalize_root_path(root_path: &str) -> &str {
    if root_path.is_empty() {
        "."
    } else {
        root_path
    }
}
