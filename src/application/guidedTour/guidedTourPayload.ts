/**
 * Protocol adapter for the bounded Project Guided Tour.
 *
 * The POC deliberately promotes only concrete function definitions to Webview
 * stops. Callsite and framework-evidence anchors remain in the host-side domain
 * model until the navigation protocol can open exact arbitrary ranges.
 */

import type {
  GuidedTourProjection,
  GuidedTourStop,
  GuidedTourUnavailable
} from "../../insights/guidedTour";
import type { FunctionArchitecturePayload } from "../../protocol/functionArchitecture";
import type {
  GuidedTourMissionPayloadId,
  GuidedTourPayload,
  GuidedTourStopPayload,
  GuidedTourStopPayloadId
} from "../../protocol/guidedTour";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import { createContentHash } from "../../shared/hash";
import {
  createSourceDisplayFormatter,
  type SourceDisplayFormatter
} from "../sourcePresentation";

/** Independent wire budgets keep future domain growth from expanding the sidebar. */
const STOP_LIMIT = 5;
const REASON_LIMIT = 3;
const LOOK_FOR_LIMIT = 3;
const EVIDENCE_LIMIT = 2;
const UNKNOWN_LIMIT = 3;
const TEXT_LIMIT = 240;

/** Host callback replacing a canonical function identity with a snapshot token. */
export type GuidedTourSourceTokenFactory = (
  functionId: string
) => SourceNodeToken | undefined;

/** Converts one token-free domain projection into a bounded Webview payload. */
export function createGuidedTourPayload(
  projection: GuidedTourProjection,
  deliveryVersion: string,
  workspaceRoot: string,
  createSourceToken: GuidedTourSourceTokenFactory
): GuidedTourPayload {
  if (projection.availability === "unavailable") {
    return {
      graphVersion: deliveryVersion,
      availability: "unavailable",
      unavailable: {
        reason: mapUnavailableReason(projection.unavailable.reason),
        explanation: safeText(projection.unavailable.explanation, "No guided path is available."),
        observedEvidence: safeList(projection.unavailable.observedEvidence, EVIDENCE_LIMIT),
        nextAction: createUnavailableNextAction(projection.unavailable.nextAction)
      }
    };
  }

  const sourceDisplay = createSourceDisplayFormatter(workspaceRoot);
  const missionId = createMissionId(projection.mission.id, deliveryVersion);
  const stopProjection = createStopPayloads(
    projection.mission.stops,
    missionId,
    sourceDisplay,
    createSourceToken
  );
  if (stopProjection.stops.length === 0) {
    return {
      graphVersion: deliveryVersion,
      availability: "unavailable",
      unavailable: {
        reason: "noConcreteStop",
        explanation: "The selected path has no concrete function definition that this POC can open safely.",
        observedEvidence: safeList(projection.mission.selection.reasons, EVIDENCE_LIMIT),
        nextAction: {
          destination: "explore",
          label: "Inspect the selected path evidence",
          lookFor: "Find the callsite or mapping evidence that lacks a concrete definition target."
        }
      }
    };
  }

  return {
    graphVersion: deliveryVersion,
    availability: "ready",
    mission: {
      id: missionId,
      scopeLabel: "Primary analyzed scope",
      title: safeText(projection.mission.title, "Trace one request through the code"),
      trigger: safeTriggerText(projection.mission.trigger),
      objective: safeText(projection.mission.objective, "Follow the source-backed path."),
      selectionReasons: safeList(projection.mission.selection.reasons, REASON_LIMIT),
      unknowns: safeList(projection.mission.selection.unknowns, UNKNOWN_LIMIT),
      stops: stopProjection.stops,
      omittedStopCount: stopProjection.omittedStopCount,
      limitations: stopProjection.omittedStopCount > 0
        ? [
            `${stopProjection.omittedStopCount} non-definition or unavailable stop(s) are deferred in this POC.`,
            "Use Explore to inspect callsite and unresolved mapping evidence."
          ]
        : [],
      explainBack: safeList(projection.mission.explainBack, REASON_LIMIT),
      exitCriteria: safeText(
        projection.mission.exitCriteria,
        "You can explain the exposed source path and its remaining unknowns."
      )
    }
  };
}

/** Keeps only definition-backed stops that can complete the POC open/ack loop. */
function createStopPayloads(
  stops: readonly GuidedTourStop[],
  missionId: GuidedTourMissionPayloadId,
  sourceDisplay: SourceDisplayFormatter,
  createSourceToken: GuidedTourSourceTokenFactory
): { stops: GuidedTourStopPayload[]; omittedStopCount: number } {
  const payloads: GuidedTourStopPayload[] = [];

  for (const stop of stops) {
    if (payloads.length >= STOP_LIMIT || stop.mode !== "navigable") {
      continue;
    }
    const definition = stop.anchors.find((anchor) => anchor.locationKind === "definition");
    const functionId = definition?.functionId ?? stop.functionId;
    const sourceToken = definition && functionId
      ? createSourceToken(functionId)
      : undefined;
    if (!definition || !sourceToken) {
      continue;
    }

    payloads.push({
      id: createStopId(missionId, stop.id),
      order: payloads.length + 1,
      kind: stop.kind === "verification" ? "collaborator" : stop.kind,
      label: safeText(stop.label, "Anonymous callable"),
      sourceLocation: sourceDisplay.location(definition.filePath, definition.range),
      sourceToken,
      architecture: createArchitecturePayload(stop.architecture),
      whyNow: safeText(stop.whyNow, "This function is the next source-backed step."),
      lookFor: safeList(
        stop.lookFor
          .filter((item) => item.anchorId === definition.id)
          .map((item) => item.instruction),
        LOOK_FOR_LIMIT
      ),
      question: safeText(stop.question, "What responsibility does this function own?"),
      moveOnWhen: safeText(stop.moveOnWhen, "Move on after identifying its responsibility."),
      evidence: safeList(stop.evidence, EVIDENCE_LIMIT),
      unknowns: safeList(stop.unknowns, UNKNOWN_LIMIT)
    });
  }

  return {
    stops: payloads,
    omittedStopCount: Math.max(0, stops.length - payloads.length)
  };
}

/** Copies structural facts without strengthening confidence or purity claims. */
function createArchitecturePayload(
  architecture: GuidedTourStop["architecture"]
): FunctionArchitecturePayload {
  if (!architecture) {
    return {
      layer: "unclassified",
      confidence: "unknown",
      businessLogic: "unknown",
      purity: "unknown",
      evidence: [],
      alternatives: [],
      conflicted: false
    };
  }
  return {
    ...architecture,
    evidence: safeList(architecture.evidence, EVIDENCE_LIMIT),
    alternatives: [...architecture.alternatives]
  };
}

/** Maps the richer domain wording to the deliberately small POC protocol. */
function mapUnavailableReason(
  reason: "noSupportedEntrypoint" | "handlerNotMapped" | "noNavigableAnchor"
): "noSupportedEntrypoint" | "handlerNotMapped" | "noConcreteStop" {
  return reason === "noNavigableAnchor" ? "noConcreteStop" : reason;
}

/** Keeps the domain's single best fallback actionable without inventing a source token. */
function createUnavailableNextAction(
  action: GuidedTourUnavailable["nextAction"]
): { destination: "explore"; label: string; lookFor: string } | undefined {
  if (action.kind === "none") {
    return undefined;
  }
  return {
    destination: "explore",
    label: safeText(action.label, "Explore evidence"),
    lookFor: safeText(action.lookFor, "Inspect the available mapping evidence.")
  };
}

/** Hashes host identities so scope/path IDs never cross into the Webview. */
function createMissionId(domainId: string, deliveryVersion: string): GuidedTourMissionPayloadId {
  return `guided-mission:${createContentHash(`${deliveryVersion}\0${domainId}`).slice(0, 24)}`;
}

/** Derives a stop identity inside its mission without exposing path/function IDs. */
function createStopId(
  missionId: GuidedTourMissionPayloadId,
  domainId: string
): GuidedTourStopPayloadId {
  return `guided-stop:${createContentHash(`${missionId}\0${domainId}`).slice(0, 24)}`;
}

/** Bounds analyzer text and removes embedded absolute host paths defensively. */
function safeText(value: string, fallback: string): string {
  const normalized = value
    .replace(/\\/gu, "/")
    .replace(/(?:^|[:=(\s])\/(?:[^/\s:]+\/)+[^/\s:]*/gu, "$1[source]")
    .replace(/(?:^|[:=(\s])[a-z]:\/(?:[^/\s:]+\/)*[^/\s:]*/giu, "$1[source]")
    .replace(/(?:^|[:=(\s])\/\/[a-z0-9._-]+\/[a-z0-9._/-]+/giu, "$1[source]")
    .replace(/\s+/gu, " ")
    .trim();
  const visible = normalized || fallback;
  return visible.length <= TEXT_LIMIT ? visible : `${visible.slice(0, TEXT_LIMIT - 1)}…`;
}

/** Preserves an analyzed HTTP route even when its path has multiple segments. */
function safeTriggerText(value: string): string {
  const normalized = value.replace(/\\/gu, "/").replace(/\s+/gu, " ").trim();
  if (/^(?:DELETE|GET|HEAD|OPTIONS|PATCH|POST|PUT)\s+\//u.test(normalized)) {
    return normalized.length <= TEXT_LIMIT
      ? normalized
      : `${normalized.slice(0, TEXT_LIMIT - 1)}…`;
  }
  return safeText(normalized, "Selected entrypoint");
}

/** Applies display safety and a hard item cap to a wire-facing text list. */
function safeList(values: readonly string[], limit: number): string[] {
  return values
    .map((value) => safeText(value, ""))
    .filter((value) => value.length > 0)
    .slice(0, limit);
}
