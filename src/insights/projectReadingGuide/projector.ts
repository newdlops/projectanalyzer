/**
 * Public two-stage projector for the Project Reading Guide domain.
 *
 * Graph-wide scope ownership is indexed once. The small index is returned
 * immediately, while source areas and recommended paths are calculated only
 * for the scope identity explicitly requested by a caller.
 */

import type { ProjectGraph } from "../../shared/types";
import {
  createFunctionArchitectureIndex,
  type FunctionArchitectureIndex
} from "../architecturalLayers";
import type { SemanticFlowIndex } from "../semanticFlow";
import { createPortableProjectPathNormalizer } from "./portableRootPath";
import { createProjectPrimaryReadingPath } from "./projectPrimaryReadingPath";
import { createProjectReadingPaths } from "./readingPath";
import { createProjectReadingScopeIndex } from "./scopeIndex";
import { createProjectReadingSourceAreas } from "./sourceAreas";
import type {
  ProjectReadingGuideProjector,
  ProjectPrimaryReadingPathResult,
  ProjectScopeReadingGuide
} from "./types";

/** Creates a reusable pure projector over one immutable graph snapshot. */
export function createProjectReadingGuideProjector(
  graph: ProjectGraph,
  semanticFlows: SemanticFlowIndex,
  architectureIndex: FunctionArchitectureIndex = createFunctionArchitectureIndex(graph)
): ProjectReadingGuideProjector {
  const normalizer = createPortableProjectPathNormalizer(graph.workspaceRoot);
  const scopeIndex = createProjectReadingScopeIndex(graph, semanticFlows, normalizer);
  let primaryPathResult: ProjectPrimaryReadingPathResult | undefined;

  return {
    projectIndex: () => scopeIndex.projectIndex,

    projectPrimaryPath(): ProjectPrimaryReadingPathResult {
      primaryPathResult ??= createProjectPrimaryReadingPath(
        graph,
        scopeIndex,
        architectureIndex
      );
      return primaryPathResult;
    },

    projectScope(scopeId: string): ProjectScopeReadingGuide | undefined {
      const scope = scopeIndex.scopesById.get(scopeId);
      if (!scope) {
        return undefined;
      }

      const areaProjection = createProjectReadingSourceAreas(
        scope,
        scopeIndex.workspaceRootKey,
        normalizer
      );
      const pathProjection = createProjectReadingPaths(scope, architectureIndex);

      return {
        graphVersion: scopeIndex.graphVersion,
        workspaceRoot: graph.workspaceRoot,
        scope: scope.summary,
        areas: areaProjection.areas,
        totalAreaCount: areaProjection.totalAreaCount,
        omittedAreaCount: areaProjection.omittedAreaCount,
        readingPaths: pathProjection.readingPaths,
        mappedFlowCount: pathProjection.mappedFlowCount,
        omittedMappedFlowCount: pathProjection.omittedMappedFlowCount,
        unmappedEntrypointCount: pathProjection.unmappedEntrypointCount
      };
    }
  };
}
