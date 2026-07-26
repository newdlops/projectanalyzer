/** Unit coverage for the deterministic, DOM-free Function Logic attention model. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createFunctionLogicAttentionProjection,
  createFunctionLogicComprehensionState,
  reduceFunctionLogicComprehensionState,
  type FunctionLogicAttentionBlock,
  type FunctionLogicAttentionEdge,
  type FunctionLogicComprehensionState
} from "../../webview/codeFlow/comprehension";

const blocks: FunctionLogicAttentionBlock[] = [
  { id: "entry", kind: "entry" },
  { id: "condition", kind: "condition" },
  { id: "left", kind: "operation", valueAccesses: [{ bindingId: "total" }] },
  { id: "right", kind: "call", drillTargets: [{}] },
  { id: "effect", kind: "mutation", valueChanges: [{}] },
  { id: "exit", kind: "exit" },
  { id: "eval", kind: "embedded" },
  { id: "eval-member", kind: "operation", parentBlockId: "eval" }
];
const edges: FunctionLogicAttentionEdge[] = [
  { id: "entry-condition", sourceId: "entry", targetId: "condition", kind: "next" },
  { id: "condition-left", sourceId: "condition", targetId: "left", kind: "true" },
  { id: "condition-right", sourceId: "condition", targetId: "right", kind: "false" },
  { id: "left-effect", sourceId: "left", targetId: "effect", kind: "next" },
  { id: "right-effect", sourceId: "right", targetId: "effect", kind: "next" },
  { id: "effect-exit", sourceId: "effect", targetId: "exit", kind: "next" },
  { id: "eval-loop", sourceId: "eval", targetId: "eval-member", kind: "next" },
  { id: "loop-eval", sourceId: "eval-member", targetId: "eval", kind: "next" }
];

test("keeps Flow context and makes the selected neighbourhood related", () => {
  const projection = createFunctionLogicAttentionProjection(blocks, edges, createState({ selectedBlockId: "left" }));

  assert.equal(projection.nodeLevelById.get("left"), "active");
  assert.equal(projection.nodeLevelById.get("condition"), "related");
  assert.equal(projection.nodeLevelById.get("effect"), "related");
  assert.equal(projection.nodeLevelById.get("right"), "context");
});

test("preserves an explicitly selected node outside the current branch", () => {
  const projection = createFunctionLogicAttentionProjection(blocks, edges, createState({ selectedBlockId: "right" }), {
    reachableBlockIds: new Set(["entry", "condition", "left", "effect", "exit"]),
    reachableEdgeIds: new Set(["entry-condition", "condition-left", "left-effect", "effect-exit"])
  });

  assert.equal(projection.nodeLevelById.get("right"), "active");
  assert.equal(projection.excludedNodeIds.has("right"), true);
  assert.equal(projection.edgeLevelById.get("condition-right"), "related");
});

test("does not foreground a Values route until a binding is selected", () => {
  const withoutBinding = createFunctionLogicAttentionProjection(blocks, edges, createState({ lens: "values" }));
  const withBinding = createFunctionLogicAttentionProjection(blocks, edges, createState({
    lens: "values",
    selectedBindingId: "total"
  }));

  assert.equal(withoutBinding.nodeLevelById.get("left"), "context");
  assert.equal(withBinding.nodeLevelById.get("left"), "related");
});

test("gives a playback endpoint priority over a different selected node", () => {
  const projection = createFunctionLogicAttentionProjection(blocks, edges, createState({
    selectedBlockId: "left",
    playback: { status: "playing", activeHopIndex: 1 }
  }), { valueHopBlockIds: ["left", "effect"] });

  assert.equal(projection.nodeLevelById.get("effect"), "active");
  assert.equal(projection.nodeLevelById.get("left"), "related");
  assert.equal(projection.reasonByNodeId.get("effect"), "playback-endpoint");
});

test("keeps Guide evidence visible without overriding an existing graph selection", () => {
  const state = reduceFunctionLogicComprehensionState(createState({ selectedBlockId: "left" }), {
    type: "set-guide-focus",
    primaryBlockId: "effect",
    blockIds: ["effect", "exit"],
    edgeIds: ["effect-exit"]
  });
  const projection = createFunctionLogicAttentionProjection(blocks, edges, state);

  assert.equal(projection.nodeLevelById.get("left"), "active");
  assert.equal(projection.reasonByNodeId.get("left"), "selected");
  assert.equal(projection.nodeLevelById.get("effect"), "active");
  assert.equal(projection.reasonByNodeId.get("effect"), "guide-primary");
  assert.equal(projection.nodeLevelById.get("exit"), "related");
  assert.equal(projection.edgeLevelById.get("effect-exit"), "related");
});

test("bounds focus membership and terminates malformed cyclic graph relations", () => {
  const projection = createFunctionLogicAttentionProjection(blocks, edges, createState({
    embeddedFocusBoundaryId: "eval"
  }));

  assert.equal(projection.nodeLevelById.get("eval"), "related");
  assert.equal(projection.nodeLevelById.get("eval-member"), "context");
  assert.equal(projection.nodeLevelById.get("entry"), "muted");
});

test("uses an explicit embedded boundary identity when virtual nodes have another control parent", () => {
  const projection = createFunctionLogicAttentionProjection([
    { id: "host", kind: "operation" },
    { id: "eval", kind: "embedded" },
    { id: "embedded-return", kind: "return", parentBlockId: "host", embeddedBoundaryId: "eval" }
  ], [], createState({ embeddedFocusBoundaryId: "eval" }));

  assert.equal(projection.nodeLevelById.get("eval"), "related");
  assert.equal(projection.nodeLevelById.get("embedded-return"), "related");
  assert.equal(projection.nodeLevelById.get("host"), "muted");
});

test("preserves reader state within a session and resets only for a new graph", () => {
  const initial = createFunctionLogicComprehensionState("graph-a");
  const values = reduceFunctionLogicComprehensionState(initial, { type: "set-lens", lens: "values" });
  const selected = reduceFunctionLogicComprehensionState(values, {
    type: "select-binding",
    bindingId: "total"
  });
  const chosen = reduceFunctionLogicComprehensionState(selected, {
    type: "set-branch-choice",
    sourceId: "condition",
    edgeId: "condition-left"
  });

  assert.equal(values.selectedBindingId, undefined);
  assert.equal(chosen.branchChoiceEdgeIdsBySourceId.get("condition"), "condition-left");
  assert.equal(reduceFunctionLogicComprehensionState(chosen, {
    type: "reset-session",
    sessionKey: "graph-a"
  }), chosen);
  const reset = reduceFunctionLogicComprehensionState(chosen, {
    type: "reset-session",
    sessionKey: "graph-b"
  });
  assert.equal(reset.lens, "flow");
  assert.equal(reset.selectedBindingId, undefined);
  assert.equal(reset.branchChoiceEdgeIdsBySourceId.size, 0);
});

/** Produces a fully defined state so each test changes only relevant semantics. */
function createState(overrides: Partial<FunctionLogicComprehensionState> = {}): FunctionLogicComprehensionState {
  return {
    sessionKey: "test",
    view: "map",
    lens: "flow",
    branchChoiceEdgeIdsBySourceId: new Map(),
    inspectorOpen: true,
    playback: { status: "idle", activeHopIndex: 0 },
    ...overrides
  };
}
