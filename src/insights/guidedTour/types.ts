/**
 * Public host-independent contracts for one evidence-backed Guided Tour.
 *
 * The model separates analyzer facts from educational instructions. Source
 * identities remain host-side so an application adapter can later replace
 * them with opaque tokens before crossing the Webview protocol boundary.
 */

import type { SourceRange } from "../../shared/types";
import type { ProjectReadingArchitecture } from "../projectReadingGuide";

/** Exactly one mission or one honest explanation for its absence. */
export type GuidedTourProjection =
  | {
      graphVersion: string;
      availability: "ready";
      mission: GuidedTourMission;
    }
  | {
      graphVersion: string;
      availability: "unavailable";
      unavailable: GuidedTourUnavailable;
    };

/** Evidence class explaining why the selected path is educationally useful. */
export type GuidedTourSelectionEvidence =
  | "domainCandidate"
  | "applicationCandidate"
  | "workflowBridgeCandidate"
  | "mappedBoundaryPath"
  | "concreteHandlerInvestigation";

/** One bounded project-specific learning mission. */
export type GuidedTourMission = {
  id: string;
  scopeId: string;
  pathId: string;
  title: string;
  trigger: string;
  objective: string;
  selection: {
    evidenceKind: GuidedTourSelectionEvidence;
    reasons: string[];
    unknowns: string[];
  };
  stops: GuidedTourStop[];
  explainBack: string[];
  exitCriteria: string;
};

/** Host-side source location retained until an adapter creates an opaque token. */
export type GuidedTourSourceAnchor = {
  id: string;
  locationKind: "definition" | "callsite" | "frameworkEvidence";
  functionId?: string;
  ownerFunctionId?: string;
  filePath: string;
  range: SourceRange;
  label: string;
};

/** One source-bound observation prompt. */
export type GuidedTourLookFor = {
  instruction: string;
  anchorId: string;
  evidenceRuleId: string;
};

/** Evidence describing why the reader moves from one stop to the next. */
export type GuidedTourTransitionEvidence = {
  explanation: string;
  kind: "frameworkMapping" | "call" | "boundary" | "analysisGap";
  anchorId?: string;
};

/** Shared educational fields for source-backed and evidence-only stops. */
export type GuidedTourStopBase = {
  id: string;
  order: number;
  label: string;
  whyNow: string;
  lookFor: GuidedTourLookFor[];
  question: string;
  moveOnWhen: string;
  evidence: string[];
  unknowns: string[];
  transitionToNext?: GuidedTourTransitionEvidence;
};

/** Stop category stated only from reading-path evidence. */
export type GuidedTourStopKind =
  | "handler"
  | "decisionCandidate"
  | "collaborator"
  | "boundary"
  | "evidenceGap"
  | "verification";

/** A stop with at least one exact source range. */
export type GuidedTourNavigableStop = GuidedTourStopBase & {
  mode: "navigable";
  kind: GuidedTourStopKind;
  functionId?: string;
  filePath: string;
  range: SourceRange;
  architecture?: ProjectReadingArchitecture;
  anchors: [GuidedTourSourceAnchor, ...GuidedTourSourceAnchor[]];
  primaryAnchorId: string;
  requiredAnchorIds: [string, ...string[]];
};

/** A visible analysis gap with no location that can honestly be opened. */
export type GuidedTourEvidenceOnlyStop = GuidedTourStopBase & {
  mode: "evidenceOnly";
  kind: "evidenceGap";
  functionId?: string;
  architecture?: ProjectReadingArchitecture;
  anchors: [];
};

export type GuidedTourStop = GuidedTourNavigableStop | GuidedTourEvidenceOnlyStop;

/** Why a mission could not be created and the single best next action. */
export type GuidedTourUnavailable = {
  reason: "noSupportedEntrypoint" | "handlerNotMapped" | "noNavigableAnchor";
  explanation: string;
  observedEvidence: string[];
  nextAction:
    | {
        kind: "openAnchor";
        target: GuidedTourSourceAnchor;
        label: string;
        lookFor: string;
      }
    | {
        kind: "openPrefilteredExplore";
        destination: "mappingGaps" | "supportedEntrypoints";
        scopeId?: string;
        label: string;
        lookFor: string;
      }
    | {
        kind: "none";
        explanation: string;
      };
};
