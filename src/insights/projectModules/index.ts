/**
 * Public surface for the pure project-module insight.
 * Boundary inference, ownership, and relation aggregation remain internal.
 */

export { createProjectModuleIndex } from "./projectModuleIndex";
export {
  PROJECT_MODULE_RELATION_EVIDENCE_LIMIT,
  PROJECT_MODULE_REPRESENTATIVE_FILE_LIMIT,
  type CreateProjectModuleIndexOptions,
  type ProjectModule,
  type ProjectModuleBasis,
  type ProjectModuleBoundaryEvidence,
  type ProjectModuleConfidenceCounts,
  type ProjectModuleIndex,
  type ProjectModuleRelation,
  type ProjectModuleRelationCounts,
  type ProjectModuleRelationEvidence,
  type ProjectModuleRelationKind,
  type ProjectModuleRootEvidence,
  type ProjectModuleSummary
} from "./types";
