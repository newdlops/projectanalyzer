/**
 * Shared, browser-safe types for Function Logic comprehension state and its
 * attention projection. This module deliberately describes only graph facts;
 * it does not depend on VS Code, layout, or DOM implementation details.
 */

/** The reader question currently foregrounded in the Function Logic graph. */
export type FunctionLogicLens = "flow" | "values" | "calls" | "effects";

/** The graph representation selected by the reader without changing graph data. */
export type FunctionLogicComprehensionView = "map" | "steps";

/** Playback state used to give the current value-flow hop a single priority. */
export type FunctionLogicPlaybackState = {
  status: "idle" | "playing" | "paused" | "complete";
  activeHopIndex: number;
};

/** Semantic state shared by Map, Steps, graph controls, and Inspector. */
export type FunctionLogicComprehensionState = {
  sessionKey: string;
  view: FunctionLogicComprehensionView;
  lens: FunctionLogicLens;
  selectedBlockId?: string;
  selectedBindingId?: string;
  branchChoiceEdgeIdsBySourceId: ReadonlyMap<string, string>;
  bodyFocusOwnerId?: string;
  embeddedFocusBoundaryId?: string;
  /** Explicit Function Guide evidence; absent until a reader requests graph focus. */
  guideFocus?: {
    primaryBlockId?: string;
    blockIds: readonly string[];
    edgeIds: readonly string[];
  };
  inspectorOpen: boolean;
  playback: FunctionLogicPlaybackState;
};

/** Explicit semantic transitions accepted by the comprehension state reducer. */
export type FunctionLogicComprehensionEvent =
  | { type: "reset-session"; sessionKey: string }
  | { type: "set-lens"; lens: FunctionLogicLens }
  | { type: "set-view"; view: FunctionLogicComprehensionView }
  | { type: "select-block"; blockId?: string }
  | { type: "select-binding"; bindingId?: string }
  | { type: "set-branch-choice"; sourceId: string; edgeId?: string }
  | { type: "set-body-focus"; ownerId?: string }
  | { type: "set-embedded-focus"; boundaryId?: string }
  | { type: "set-guide-focus"; primaryBlockId?: string; blockIds: readonly string[]; edgeIds: readonly string[] }
  | { type: "clear-guide-focus" }
  | { type: "set-inspector-open"; open: boolean }
  | { type: "set-playback"; playback: FunctionLogicPlaybackState };

/** The only four visual priority levels emitted by the central projection. */
export type FunctionLogicAttentionLevel =
  | "active"
  | "related"
  | "context"
  | "muted";

/** Minimal block semantics used to compute relevance without browser imports. */
export type FunctionLogicAttentionBlock = {
  id: string;
  kind: string;
  parentBlockId?: string;
  /** Boundary that owns this embedded-program member, when one exists. */
  embeddedBoundaryId?: string;
  valueAccesses?: ReadonlyArray<{ bindingId: string }>;
  valueChanges?: ReadonlyArray<unknown>;
  drillTargets?: ReadonlyArray<unknown>;
};

/** Minimal directed relation used for neighbourhood and lens relevance. */
export type FunctionLogicAttentionEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
};

/** Precomputed scenario and playback facts supplied by the feature adapters. */
export type FunctionLogicAttentionInputs = {
  /** Blocks and edges reachable under the current branch choices. */
  reachableBlockIds?: ReadonlySet<string>;
  reachableEdgeIds?: ReadonlySet<string>;
  /** The selected value route, in visual hop order. */
  valueHopBlockIds?: readonly string[];
};

/** Deterministic visual result; presentation maps these values to data attributes. */
export type FunctionLogicAttentionProjection = {
  nodeLevelById: ReadonlyMap<string, FunctionLogicAttentionLevel>;
  edgeLevelById: ReadonlyMap<string, FunctionLogicAttentionLevel>;
  excludedNodeIds: ReadonlySet<string>;
  excludedEdgeIds: ReadonlySet<string>;
  reasonByNodeId: ReadonlyMap<string, string>;
};
