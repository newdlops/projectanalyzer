/**
 * Factory for empty ProjectGraph values used by the scaffold, tests, and failed
 * analysis fallbacks. The shape matches the persisted graph model from SPEC.
 */

import { nowIso } from "../shared/time";
import type { ProjectGraph } from "../shared/types";

/**
 * Creates an empty graph with initialized metadata.
 */
export function createEmptyProjectGraph(workspaceRoot: string): ProjectGraph {
  return {
    workspaceRoot,
    version: "0.1.0",
    generatedAt: nowIso(),
    nodes: [],
    edges: [],
    diagnostics: [],
    metadata: {
      languages: [],
      languageSummary: [],
      frameworks: [],
      projectPackageRoots: [],
      frameworkUnits: [],
      frameworkUnitEdges: [],
      fileCount: 0,
      symbolCount: 0,
      edgeCount: 0
    }
  };
}
