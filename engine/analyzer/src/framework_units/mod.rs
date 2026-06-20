//! Framework semantic unit extraction dispatch.
//!
//! This module keeps framework-specific conventions behind adapters and returns
//! graph-ready units without coupling language analyzers to framework details.

mod django;
mod django_relations;
mod django_routes;
mod fastapi;
mod flask;
mod js_backend;
mod js_backend_support;
mod js_frontend;

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
            let mut django_extraction = django::analyze(workspace_root, framework)?;
            django_extraction
                .edges
                .extend(django_relations::relation_edges(&django_extraction.units));
            extraction.extend(django_extraction);
        }
        if is_fastapi_framework(framework) {
            extraction.extend(fastapi::analyze(workspace_root, framework)?);
        }
        if is_flask_framework(framework) {
            extraction.extend(flask::analyze(workspace_root, framework)?);
        }
        if is_javascript_frontend_framework(framework) {
            extraction.extend(js_frontend::analyze(workspace_root, framework)?);
        }
        if is_javascript_backend_framework(framework) {
            extraction.extend(js_backend::analyze(workspace_root, framework)?);
        }
    }

    Ok(extraction)
}

/// Matches the manifest detector's canonical Django framework row.
fn is_django_framework(framework: &DetectedFramework) -> bool {
    framework.name == "Django" && framework.ecosystem == "python"
}

/// Matches the manifest detector's canonical FastAPI framework row.
fn is_fastapi_framework(framework: &DetectedFramework) -> bool {
    framework.name == "FastAPI" && framework.ecosystem == "python"
}

/// Matches the manifest detector's canonical Flask framework row.
fn is_flask_framework(framework: &DetectedFramework) -> bool {
    framework.name == "Flask" && framework.ecosystem == "python"
}

/// Matches React and Next.js framework rows for TypeScript/TSX semantic units.
fn is_javascript_frontend_framework(framework: &DetectedFramework) -> bool {
    matches!(framework.name.as_str(), "React" | "Next.js") && framework.ecosystem == "javascript"
}

/// Matches Express and NestJS framework rows for TypeScript backend semantics.
fn is_javascript_backend_framework(framework: &DetectedFramework) -> bool {
    matches!(framework.name.as_str(), "Express" | "NestJS") && framework.ecosystem == "javascript"
}
