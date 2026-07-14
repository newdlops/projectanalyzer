/**
 * Sidebar graph delivery lifecycle and protocol version projection.
 *
 * Analyzer graph versions describe the engine schema and may remain constant
 * across analyses. This module gives each immutable graph object a Webview-only
 * snapshot token so late lazy responses cannot overwrite a newer analysis.
 */

import { randomBytes } from "node:crypto";
import type { FunctionExplorerPayload } from "../protocol/functionExplorer";
import type { ProjectOverviewPayload } from "../protocol/projectOverview";
import type {
  ProjectReadingGuidePayload,
  ProjectScopeReadingGuidePayload
} from "../protocol/projectReadingGuide";
import type { ProjectGraph } from "../shared/types";

/** One active host graph and its opaque browser delivery identity. */
export type SidebarGraphSnapshot = {
  graph: ProjectGraph;
  version: string;
};

/** Owns snapshot identity independently from the analyzer's schema version. */
export class SidebarGraphDelivery {
  /** Provider identity prevents snapshot collisions after an Extension Host restart. */
  private readonly sessionId = randomBytes(12).toString("hex");

  /** Monotonic identity scoped to this extension-host provider instance. */
  private revision = 0;

  private snapshot: SidebarGraphSnapshot | undefined;

  /** Activates a graph, retaining the token when the exact object is republished. */
  public activate(graph: ProjectGraph): { changed: boolean; snapshot: SidebarGraphSnapshot } {
    if (this.snapshot?.graph === graph) {
      return { changed: false, snapshot: this.snapshot };
    }

    this.revision += 1;
    this.snapshot = {
      graph,
      version: `sidebar-snapshot:${this.sessionId}:${this.revision}`
    };
    return { changed: true, snapshot: this.snapshot };
  }

  /** Returns the graph currently represented by the sidebar. */
  public current(): SidebarGraphSnapshot | undefined {
    return this.snapshot;
  }

  /** Rejects a response request originating from an older browser snapshot. */
  public matches(version: string | undefined): boolean {
    return Boolean(version && this.snapshot?.version === version);
  }

  /** Drops graph references while preserving monotonic token generation. */
  public clear(): void {
    this.snapshot = undefined;
  }
}

/** Replaces the engine version on a graph payload crossing to the sidebar. */
export function withSidebarGraphVersion(graph: ProjectGraph, version: string): ProjectGraph {
  return { ...graph, version };
}

/** Tags the bounded first-read guide with its browser snapshot identity. */
export function withReadingGuideVersion(
  payload: ProjectReadingGuidePayload,
  version: string
): ProjectReadingGuidePayload {
  return { ...payload, graphVersion: version };
}

/** Tags one lazy scope detail with its browser snapshot identity. */
export function withReadingScopeVersion(
  payload: ProjectScopeReadingGuidePayload,
  version: string
): ProjectScopeReadingGuidePayload {
  return { ...payload, graphVersion: version };
}

/** Tags lazy Analysis Details with its browser snapshot identity. */
export function withProjectOverviewVersion(
  payload: ProjectOverviewPayload,
  version: string
): ProjectOverviewPayload {
  return { ...payload, graphVersion: version };
}

/** Tags both Function Explorer version fields used by browser stale guards. */
export function withFunctionExplorerVersion(
  payload: FunctionExplorerPayload,
  version: string
): FunctionExplorerPayload {
  return {
    ...payload,
    graphVersion: version,
    summary: { ...payload.summary, graphVersion: version }
  };
}
