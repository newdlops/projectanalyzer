/**
 * Bounded Project Guided Tour messages shared by the Extension Host and Webview.
 * The POC carries one mission and at most five source-reading stops. Analyzer
 * identities and absolute paths remain behind snapshot-local source tokens.
 */

import type { FunctionArchitecturePayload } from "./functionArchitecture";
import type { SourceNodeToken } from "./sourceNavigation";

/** Opaque mission identity scoped to one sidebar graph snapshot. */
export type GuidedTourMissionPayloadId = `guided-mission:${string}`;

/** Opaque stop identity scoped to one bounded mission payload. */
export type GuidedTourStopPayloadId = `guided-stop:${string}`;

/** Source-backed teaching step rendered one at a time by the Guide surface. */
export type GuidedTourStopPayload = {
  id: GuidedTourStopPayloadId;
  order: number;
  kind: "handler" | "decisionCandidate" | "collaborator" | "boundary" | "evidenceGap";
  label: string;
  sourceLocation?: string;
  sourceToken?: SourceNodeToken;
  architecture: FunctionArchitecturePayload;
  whyNow: string;
  lookFor: string[];
  question: string;
  moveOnWhen: string;
  evidence: string[];
  unknowns: string[];
};

/** One automatically selected project-specific learning mission. */
export type GuidedTourMissionPayload = {
  id: GuidedTourMissionPayloadId;
  scopeLabel: string;
  title: string;
  trigger: string;
  objective: string;
  selectionReasons: string[];
  unknowns: string[];
  stops: GuidedTourStopPayload[];
  omittedStopCount: number;
  limitations: string[];
  explainBack: string[];
  exitCriteria: string;
};

/** Honest result when current analysis cannot produce a source-backed mission. */
export type GuidedTourUnavailablePayload = {
  reason: "noSupportedEntrypoint" | "handlerNotMapped" | "noConcreteStop";
  explanation: string;
  observedEvidence: string[];
  nextAction?: {
    destination: "explore";
    label: string;
    lookFor: string;
  };
};

/** Initial bounded Guided Tour projection for one immutable sidebar graph. */
export type GuidedTourPayload =
  | {
      graphVersion: string;
      availability: "ready";
      mission: GuidedTourMissionPayload;
    }
  | {
      graphVersion: string;
      availability: "unavailable";
      unavailable: GuidedTourUnavailablePayload;
    };

/** Correlated request to open the current stop's snapshot-local source token. */
export type GuidedTourOpenSourceRequest = {
  graphVersion: string;
  missionId: GuidedTourMissionPayloadId;
  stopId: GuidedTourStopPayloadId;
  sourceToken: SourceNodeToken;
  requestId: number;
};

/** Successful source navigation acknowledged only after VS Code opens the editor. */
export type GuidedTourSourceOpenedPayload = GuidedTourOpenSourceRequest;

/** Failed source navigation retaining the tuple needed for an in-place retry. */
export type GuidedTourSourceOpenFailurePayload = GuidedTourOpenSourceRequest & {
  message: string;
};
