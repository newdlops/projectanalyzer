/**
 * Extension-Host delivery boundary for the two-stage Project Reading Guide.
 * It owns initial/scope protocol projection while the sidebar provider keeps
 * only command routing and the active graph lifecycle.
 */

import type { ProjectInsightCache } from "../../application/projectOverview";
import { createProjectScopeReadingGuidePayload } from "../../application/projectReadingGuide";
import type { ProjectAnalyzerLogger } from "../../observability/logger";
import type { ExtensionResponse } from "../../protocol/messages";
import type { ProjectReadingScopePayloadId } from "../../protocol/projectReadingGuide";
import type { ProjectGraph } from "../../shared/types";
import {
  type SidebarGraphDelivery,
  withReadingGuideVersion,
  withReadingScopeVersion
} from "../sidebarGraphDelivery";
import type { SourceNodeTokenRegistry } from "../sourceNavigation";

/** Host capabilities injected for projection and unit-testable delivery. */
export type ProjectReadingGuideHostDeliveryDependencies = {
  graphDelivery: SidebarGraphDelivery;
  insightCache: ProjectInsightCache;
  sourceNodeTokens: SourceNodeTokenRegistry;
  logger: ProjectAnalyzerLogger;
  postMessage(message: ExtensionResponse): Promise<void>;
};

/** Publishes the compact index and one explicitly requested scope. */
export class ProjectReadingGuideHostDelivery {
  public constructor(
    private readonly dependencies: ProjectReadingGuideHostDeliveryDependencies
  ) {}

  /** Publishes only the bounded first-read guide; all disclosures stay lazy. */
  public async publishInitial(graph: ProjectGraph, deliveryVersion: string): Promise<void> {
    const payload = withReadingGuideVersion(
      this.dependencies.insightCache.get(graph).projectReadingGuidePayload,
      deliveryVersion
    );

    this.dependencies.logger.info("sidebar.projectGuide.publish", {
      candidateScopes: payload.candidateScopeCount,
      visibleScopes: payload.scopes.length
    });
    await this.dependencies.postMessage({
      type: "project/readingGuideLoaded",
      payload
    });
  }

  /** Projects source areas and reading paths only for the selected current scope. */
  public async publishScope(
    graphVersion: string,
    scopeId: ProjectReadingScopePayloadId
  ): Promise<void> {
    const snapshot = this.dependencies.graphDelivery.current();
    if (!snapshot) {
      await this.dependencies.postMessage({
        type: "analysis/status",
        payload: { state: "idle", message: "Analyze before opening a project scope" }
      });
      return;
    }
    if (!this.dependencies.graphDelivery.matches(graphVersion)) {
      this.logStaleDelivery(graphVersion);
      return;
    }

    const insightSnapshot = this.dependencies.insightCache.get(snapshot.graph);
    const domainScopeId = this.dependencies.insightCache.resolveReadingGuideScopeDomainId(
      snapshot.graph,
      scopeId
    );
    const scopeGuide = domainScopeId
      ? insightSnapshot.readingGuideProjector.projectScope(domainScopeId)
      : undefined;
    if (!scopeGuide) {
      await this.dependencies.postMessage({
        type: "project/readingGuideScopeFailed",
        payload: {
          graphVersion: snapshot.version,
          scopeId,
          message: "Project scope is no longer available"
        }
      });
      return;
    }

    const payload = withReadingScopeVersion(
      createProjectScopeReadingGuidePayload(
        scopeGuide,
        (nodeId) => this.dependencies.sourceNodeTokens.createToken(nodeId)
      ),
      snapshot.version
    );
    this.dependencies.logger.info("sidebar.projectGuideScope.publish", {
      areas: payload.areas.length,
      paths: payload.recommendedFlows.length,
      scopeId
    });
    await this.dependencies.postMessage({ type: "project/readingGuideScopeLoaded", payload });
  }

  /** Records a lazy request rejected because another graph is now active. */
  private logStaleDelivery(requestedVersion: string): void {
    this.dependencies.logger.debug("sidebar.lazyRequest.stale", {
      activeGraphVersion: this.dependencies.graphDelivery.current()?.version,
      feature: "readingGuideScope",
      requestedGraphVersion: requestedVersion
    });
  }
}
