//! Framework semantic unit extraction dispatch.
//!
//! This module keeps framework-specific conventions behind adapters and returns
//! graph-ready units without coupling language analyzers to framework details.

mod django;

#[cfg(test)]
mod tests;

use std::path::Path;

use crate::model::{DetectedFramework, FrameworkUnit, FrameworkUnitEdge};

/// Graph additions produced by framework-specific semantic analysis.
#[derive(Default)]
pub struct FrameworkUnitExtraction {
    pub units: Vec<FrameworkUnit>,
    pub edges: Vec<FrameworkUnitEdge>,
}

impl FrameworkUnitExtraction {
    /// Appends another adapter result while preserving adapter scan order.
    fn extend(&mut self, other: FrameworkUnitExtraction) {
        self.units.extend(other.units);
        self.edges.extend(other.edges);
    }
}

/// Runs semantic unit extraction for frameworks already detected in the workspace.
pub fn analyze_framework_units(
    workspace_root: &Path,
    frameworks: &[DetectedFramework],
) -> Result<FrameworkUnitExtraction, String> {
    let mut extraction = FrameworkUnitExtraction::default();

    for framework in frameworks {
        if is_django_framework(framework) {
            extraction.extend(django::analyze(workspace_root, framework)?);
        }
    }

    Ok(extraction)
}

/// Matches the manifest detector's canonical Django framework row.
fn is_django_framework(framework: &DetectedFramework) -> bool {
    framework.name == "Django" && framework.ecosystem == "python"
}
