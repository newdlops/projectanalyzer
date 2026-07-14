/**
 * Public composition boundary for the Project Overview domain feature.
 * The caller supplies one already-built SemanticFlowIndex so Overview creation
 * does not repeat framework linking or bounded downstream traversal.
 */

import type { ProjectGraph } from "../../shared/types";
import type { SemanticFlowIndex } from "../semanticFlow";
import { createProjectBrief } from "./projectBrief";
import { createProjectRiskRadar } from "./riskRadar";
import type { ProjectOverview } from "./types";

/** Creates the complete bounded brief and radar from shared graph evidence. */
export function createProjectOverview(
  graph: ProjectGraph,
  semanticFlows: SemanticFlowIndex
): ProjectOverview {
  return {
    graphVersion: graph.version,
    brief: createProjectBrief(graph, semanticFlows),
    radar: createProjectRiskRadar(graph, semanticFlows)
  };
}
