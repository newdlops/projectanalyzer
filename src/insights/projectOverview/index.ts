/**
 * Public API for the Project Overview insight domain.
 * Internal grouping and ranking helpers remain private to their modules.
 */

export { createProjectBrief } from "./projectBrief";
export { createProjectOverview } from "./projectOverview";
export { createProjectRiskRadar } from "./riskRadar";
export {
  PROJECT_BRIEF_ENTRYPOINT_GROUP_LIMIT,
  PROJECT_RISK_EVIDENCE_IDENTITY_LIMIT,
  PROJECT_RISK_RADAR_ITEM_LIMIT
} from "./types";
export type {
  ProjectAnalysisCoverageRisk,
  ProjectBrief,
  ProjectBriefAnalysisCoverage,
  ProjectBriefEntrypointGroup,
  ProjectBriefExecutionSurface,
  ProjectBriefFrameworkRoot,
  ProjectBriefGraphQLOperationType,
  ProjectBriefLanguage,
  ProjectBriefScope,
  ProjectBriefStack,
  ProjectEntrypointCoverageRisk,
  ProjectOverview,
  ProjectRiskEvidence,
  ProjectRiskItem,
  ProjectRiskItemBase,
  ProjectRiskLocation,
  ProjectRiskRadar,
  ProjectUnresolvedExecutionRisk
} from "./types";
