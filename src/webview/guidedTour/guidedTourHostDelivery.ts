/**
 * Extension-Host delivery boundary for the Project Guided Tour.
 *
 * The adapter publishes one bounded mission, binds its mission/stop/token
 * tuples to the active snapshot, and acknowledges navigation only after the
 * editor open action succeeds. It has no dependency on Webview DOM state.
 */

import type {
  GuidedTourOpenSourceRequest,
  GuidedTourPayload
} from "../../protocol/guidedTour";
import type { ExtensionResponse } from "../../protocol/messages";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import type { SymbolNode } from "../../shared/types";

/** Host capabilities injected so tuple validation can be unit tested without VS Code. */
export type GuidedTourHostDeliveryDependencies = {
  graphMatches(graphVersion: string): boolean;
  resolveSource(sourceToken: SourceNodeToken): SymbolNode | undefined;
  openSource(node: SymbolNode): Promise<void>;
  postMessage(message: ExtensionResponse): Promise<void>;
};

/** Owns source bindings for exactly the most recently published tour payload. */
export class GuidedTourHostDelivery {
  /** Mission/stop ownership prevents swapping a valid token into another stop. */
  private sourceTokensByStop = new Map<string, SourceNodeToken>();

  private activeGraphVersion: string | undefined;

  public constructor(private readonly dependencies: GuidedTourHostDeliveryDependencies) {}

  /** Publishes a bounded projection and replaces all prior tuple bindings. */
  public async publish(payload: GuidedTourPayload): Promise<void> {
    if (!this.dependencies.graphMatches(payload.graphVersion)) {
      return;
    }
    this.activeGraphVersion = payload.graphVersion;
    this.sourceTokensByStop.clear();

    if (payload.availability === "ready") {
      for (const stop of payload.mission.stops) {
        if (!stop.sourceToken) {
          continue;
        }
        this.sourceTokensByStop.set(
          createStopBindingKey(payload.mission.id, stop.id),
          stop.sourceToken
        );
      }
    }

    await this.dependencies.postMessage({ type: "project/guidedTourLoaded", payload });
  }

  /** Opens only a source token bound to the current graph, mission, and stop. */
  public async openSource(request: GuidedTourOpenSourceRequest): Promise<void> {
    if (
      request.graphVersion !== this.activeGraphVersion ||
      !this.dependencies.graphMatches(request.graphVersion)
    ) {
      return;
    }

    const expectedToken = this.sourceTokensByStop.get(
      createStopBindingKey(request.missionId, request.stopId)
    );
    const node = expectedToken === request.sourceToken
      ? this.dependencies.resolveSource(request.sourceToken)
      : undefined;
    if (!node) {
      await this.postFailure(request, "This Guided Tour source is no longer available.");
      return;
    }

    try {
      await this.dependencies.openSource(node);
      await this.dependencies.postMessage({
        type: "project/guidedTourSourceOpened",
        payload: { ...request }
      });
    } catch {
      await this.postFailure(request, "VS Code could not open this Guided Tour source.");
    }
  }

  /** Drops bindings when the active graph or cache is cleared. */
  public clear(): void {
    this.activeGraphVersion = undefined;
    this.sourceTokensByStop.clear();
  }

  /** Keeps failure correlation identical to the request that may be retried. */
  private async postFailure(
    request: GuidedTourOpenSourceRequest,
    message: string
  ): Promise<void> {
    await this.dependencies.postMessage({
      type: "project/guidedTourSourceOpenFailed",
      payload: { ...request, message }
    });
  }
}

/** Collision-safe in-memory key; opaque IDs are never reconstructed from it. */
function createStopBindingKey(missionId: string, stopId: string): string {
  return `${missionId}\0${stopId}`;
}
