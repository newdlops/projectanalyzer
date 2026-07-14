/**
 * Public two-stage projector for the Project Reading Guide domain.
 *
 * Graph-wide scope ownership is indexed once. The small index is returned
 * immediately, while source areas and representative paths are calculated only
 * for the scope identity explicitly requested by a caller.
 */

import type { ProjectGraph } from "../../shared/types";
import type { SemanticFlowIndex } from "../semanticFlow";
import { createPortableProjectPathNormalizer } from "./portableRootPath";
import { createProjectReadingPaths } from "./readingPath";
import { createProjectReadingScopeIndex } from "./scopeIndex";
import { createProjectReadingSourceAreas } from "./sourceAreas";
import type {
  ProjectReadingGuideProjector,
  ProjectScopeReadingGuide
} from "./types";

/** Creates a reusable pure projector over one immutable graph snapshot. */
export function createProjectReadingGuideProjector(
  graph: ProjectGraph,
  semanticFlows: SemanticFlowIndex
): ProjectReadingGuideProjector {
  const normalizer = createPortableProjectPathNormalizer(graph.workspaceRoot);
  const scopeIndex = createProjectReadingScopeIndex(graph, semanticFlows, normalizer);

  return {
    projectIndex: () => scopeIndex.projectIndex,

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
      const pathProjection = createProjectReadingPaths(scope);

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
