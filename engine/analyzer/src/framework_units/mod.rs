//! Framework semantic unit extraction dispatch.
//!
//! This module keeps framework-specific conventions behind adapters and returns
//! graph-ready units without coupling language analyzers to framework details.

mod django;
mod django_deep_relations;
mod django_model_relations;
mod django_relations;
mod django_routes;
mod fastapi;
mod fastapi_relations;
mod flask;
mod flask_relations;
mod js_backend;
mod js_backend_relations;
mod js_backend_support;
mod js_frontend;
mod js_frontend_relations;

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
            django_extraction
                .edges
                .extend(django_model_relations::relation_edges(
                    &django_extraction.units,
                ));
            django_extraction
                .edges
                .extend(django_deep_relations::relation_edges(
                    &django_extraction.units,
                ));
            extraction.extend(django_extraction);
        }
        if is_fastapi_framework(framework) {
            let mut fastapi_extraction = fastapi::analyze(workspace_root, framework)?;
            fastapi_extraction
                .edges
                .extend(fastapi_relations::relation_edges(&fastapi_extraction.units));
            extraction.extend(fastapi_extraction);
        }
        if is_flask_framework(framework) {
            let mut flask_extraction = flask::analyze(workspace_root, framework)?;
            flask_extraction
                .edges
                .extend(flask_relations::relation_edges(&flask_extraction.units));
            extraction.extend(flask_extraction);
        }
        if is_javascript_frontend_framework(framework) {
            let mut frontend_extraction = js_frontend::analyze(workspace_root, framework)?;
            frontend_extraction
                .edges
                .extend(js_frontend_relations::relation_edges(
                    &frontend_extraction.units,
                ));
            extraction.extend(frontend_extraction);
        }
        if is_javascript_backend_framework(framework) {
            let mut backend_extraction = js_backend::analyze(workspace_root, framework)?;
            backend_extraction
                .edges
                .extend(js_backend_relations::relation_edges(
                    &backend_extraction.units,
                ));
            extraction.extend(backend_extraction);
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
