/**
 * Pure state creation and reduction for one Function Logic reading session.
 * Session resets are intentional; ordinary graph relayouts keep reader choices.
 */

import type {
  FunctionLogicComprehensionEvent,
  FunctionLogicComprehensionState
} from "./types";

/** Creates the conservative Flow-first state for a new root graph session. */
export function createFunctionLogicComprehensionState(
  sessionKey: string
): FunctionLogicComprehensionState {
  return {
    sessionKey,
    view: "map",
    lens: "flow",
    branchChoiceEdgeIdsBySourceId: new Map(),
    inspectorOpen: true,
    playback: { status: "idle", activeHopIndex: 0 }
  };
}

/**
 * Applies one explicit reader event without mutating previous session state.
 * Selecting Values never synthesizes a binding: the reader must choose one.
 */
export function reduceFunctionLogicComprehensionState(
  state: FunctionLogicComprehensionState,
  event: FunctionLogicComprehensionEvent
): FunctionLogicComprehensionState {
  if (event.type === "reset-session") {
    return event.sessionKey === state.sessionKey
      ? state
      : createFunctionLogicComprehensionState(event.sessionKey);
  }
  if (event.type === "set-lens") {
    return { ...state, lens: event.lens };
  }
  if (event.type === "set-view") {
    return { ...state, view: event.view };
  }
  if (event.type === "select-block") {
    return { ...state, selectedBlockId: event.blockId };
  }
  if (event.type === "select-binding") {
    return { ...state, selectedBindingId: event.bindingId };
  }
  if (event.type === "set-branch-choice") {
    const choices = new Map(state.branchChoiceEdgeIdsBySourceId);
    if (event.edgeId) {
      choices.set(event.sourceId, event.edgeId);
    } else {
      choices.delete(event.sourceId);
    }
    return {
      ...state,
      branchChoiceEdgeIdsBySourceId: choices,
      playback: { status: "idle", activeHopIndex: 0 }
    };
  }
  if (event.type === "set-body-focus") {
    return { ...state, bodyFocusOwnerId: event.ownerId };
  }
  if (event.type === "set-embedded-focus") {
    return { ...state, embeddedFocusBoundaryId: event.boundaryId };
  }
  if (event.type === "set-guide-focus") {
    return {
      ...state,
      guideFocus: {
        primaryBlockId: event.primaryBlockId,
        blockIds: [...event.blockIds],
        edgeIds: [...event.edgeIds]
      }
    };
  }
  if (event.type === "clear-guide-focus") {
    return { ...state, guideFocus: undefined };
  }
  if (event.type === "set-inspector-open") {
    return { ...state, inspectorOpen: event.open };
  }
  return { ...state, playback: { ...event.playback } };
}

/** Serializes state helpers for the CSP-restricted Webview runtime. */
export function getFunctionLogicComprehensionStateBrowserSource(): string {
  return `
    ${createFunctionLogicComprehensionState.toString()}
    ${reduceFunctionLogicComprehensionState.toString()}
  `;
}
