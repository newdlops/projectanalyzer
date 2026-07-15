/**
 * Public surface for the pure Project Reading Guide domain.
 * Internal scope ownership, area aggregation, and path selection stay behind
 * the reusable projector facade.
 */

export { createProjectReadingGuideProjector } from "./projector";
export {
  createPortableProjectPathNormalizer,
  type PortableProjectPath,
  type PortableProjectPathNormalizer
} from "./portableRootPath";
export {
  PROJECT_READING_AREA_LIMIT,
  PROJECT_READING_FRAMEWORK_LIMIT,
  PROJECT_READING_PATH_LIMIT,
  PROJECT_READING_SCOPE_LIMIT,
  PROJECT_READING_STEP_LIMIT,
  type ProjectReadingAreaBasis,
  type ProjectReadingArchitecture,
  type ProjectReadingBoundaryKind,
  type ProjectReadingBusinessReach,
  type ProjectReadingContextInference,
  type ProjectReadingCue,
  type ProjectReadingExecutionCounts,
  type ProjectReadingGraphQLOperationType,
  type ProjectReadingGuideIndex,
  type ProjectReadingGuideProjector,
  type ProjectReadingPath,
  type ProjectPrimaryReadingFallback,
  type ProjectPrimaryReadingPath,
  type ProjectPrimaryReadingPathDiagnostics,
  type ProjectPrimaryReadingPathResult,
  type ProjectPrimaryReadingStep,
  type ProjectReadingRecommendation,
  type ProjectReadingEvidenceAnchor,
  type ProjectReadingScopeBasis,
  type ProjectReadingScopeSummary,
  type ProjectReadingSourceArea,
  type ProjectReadingStep,
  type ProjectReadingTraceStatus,
  type ProjectReadingTransport,
  type ProjectScopeReadingGuide
} from "./types";
