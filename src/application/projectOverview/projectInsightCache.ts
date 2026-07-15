/**
 * Graph-wide semantic insight cache for presentation-only explorer refreshes.
 *
 * Expanding a row or selecting a function must not rebuild every bounded flow.
 * This service owns that lifecycle independently from VS Code and Webview APIs.
 */

import { createProjectOverview } from "../../insights/projectOverview";
import {
  createGuidedTourProjection,
  type GuidedTourProjection
} from "../../insights/guidedTour";
import { createFunctionFrameworkSemantics } from "../../graph/functionFrameworkSemantics";
import {
  createFunctionArchitectureIndex,
  type FunctionArchitectureIndex
} from "../../insights/architecturalLayers";
import {
  createProjectReadingGuideProjector,
  type ProjectReadingGuideProjector
} from "../../insights/projectReadingGuide";
import {
  createSemanticFlowIndex,
  type SemanticFlowIndex
} from "../../insights/semanticFlow";
import type { ProjectOverviewPayload } from "../../protocol/projectOverview";
import type {
  ProjectReadingGuidePayload,
  ProjectReadingScopePayloadId
} from "../../protocol/projectReadingGuide";
import type { ProjectGraph } from "../../shared/types";
import {
  createProjectReadingGuidePayload,
  createProjectReadingScopePayloadId
} from "../projectReadingGuide";
import { createProjectOverviewPayload } from "./projectOverviewPayload";

/** Cached domain and protocol products for one immutable graph snapshot. */
export type ProjectInsightSnapshot = {
  functionArchitecture: FunctionArchitectureIndex;
  guidedTour: GuidedTourProjection;
  semanticFlows: SemanticFlowIndex;
  projectReadingGuidePayload: ProjectReadingGuidePayload;
  readingGuideProjector: ProjectReadingGuideProjector;
};

/** Reuses graph-wide insights until a different graph snapshot is supplied. */
export class ProjectInsightCache {
  /** Exact immutable graph object represented by the cached products. */
  private cachedGraph: ProjectGraph | undefined;

  private cached: ProjectInsightSnapshot | undefined;

  /** Lazily-created Analysis Details payload for the current graph object. */
  private cachedOverviewPayload: ProjectOverviewPayload | undefined;

  /** Host-only reverse lookup from opaque wire identity to canonical scope identity. */
  private cachedReadingGuideScopeIds: ReadonlyMap<ProjectReadingScopePayloadId, string> = new Map();

  /** Returns the cached snapshot or computes it exactly once for this graph. */
  public get(graph: ProjectGraph): ProjectInsightSnapshot {
    if (this.cached && this.cachedGraph === graph) {
      return this.cached;
    }

    const frameworkSemantics = createFunctionFrameworkSemantics(graph);
    const semanticFlows = createSemanticFlowIndex(graph, {}, frameworkSemantics);
    const functionArchitecture = createFunctionArchitectureIndex(graph, frameworkSemantics);
    const readingGuideProjector = createProjectReadingGuideProjector(
      graph,
      semanticFlows,
      functionArchitecture
    );
    const readingGuideIndex = readingGuideProjector.projectIndex();
    const snapshot: ProjectInsightSnapshot = {
      functionArchitecture,
      guidedTour: createGuidedTourProjection(readingGuideProjector.projectPrimaryPath()),
      semanticFlows,
      projectReadingGuidePayload: createProjectReadingGuidePayload(
        graph,
        semanticFlows,
        readingGuideIndex
      ),
      readingGuideProjector
    };
    this.cachedGraph = graph;
    this.cached = snapshot;
    this.cachedReadingGuideScopeIds = createReadingGuideScopeIdLookup(readingGuideIndex.scopes);
    this.cachedOverviewPayload = undefined;
    return snapshot;
  }

  /** Resolves a scope token only against the supplied immutable graph snapshot. */
  public resolveReadingGuideScopeDomainId(
    graph: ProjectGraph,
    payloadScopeId: ProjectReadingScopePayloadId
  ): string | undefined {
    this.get(graph);
    return this.cachedReadingGuideScopeIds.get(payloadScopeId);
  }

  /** Builds Analysis Details only after its disclosure is explicitly opened. */
  public getOverview(graph: ProjectGraph): ProjectOverviewPayload {
    const snapshot = this.get(graph);
    if (this.cachedOverviewPayload) {
      return this.cachedOverviewPayload;
    }

    this.cachedOverviewPayload = createProjectOverviewPayload(
      createProjectOverview(graph, snapshot.semanticFlows)
    );
    return this.cachedOverviewPayload;
  }

  /** Drops references when the active graph cache is cleared. */
  public clear(): void {
    this.cachedGraph = undefined;
    this.cached = undefined;
    this.cachedReadingGuideScopeIds = new Map();
    this.cachedOverviewPayload = undefined;
  }
}

/** Builds a collision-guarded host-only reverse lookup for visible scope cards. */
function createReadingGuideScopeIdLookup(
  scopes: readonly { id: string }[]
): ReadonlyMap<ProjectReadingScopePayloadId, string> {
  const domainIdsByPayloadId = new Map<ProjectReadingScopePayloadId, string>();

  for (const scope of scopes) {
    const payloadId = createProjectReadingScopePayloadId(scope.id);
    const existingDomainId = domainIdsByPayloadId.get(payloadId);
    if (existingDomainId !== undefined && existingDomainId !== scope.id) {
      throw new Error(`Project Reading Guide scope identity collision: ${payloadId}`);
    }
    domainIdsByPayloadId.set(payloadId, scope.id);
  }

  return domainIdsByPayloadId;
}
