/**
 * Function Logic branch-choice tests cover true/false and case selection,
 * shared merge continuation, nested choices, cycle termination, toggle reset,
 * stale identity pruning, and serialized Webview parity.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createFunctionLogicBranchChoiceProjection,
  getFunctionLogicBranchChoicesBrowserSource,
  pruneFunctionLogicBranchChoices,
  toggleFunctionLogicBranchChoice,
  type FunctionLogicBranchChoiceBlock,
  type FunctionLogicBranchChoiceEdge
} from "../../webview/codeFlow/branchChoices";

const diamondBlocks: FunctionLogicBranchChoiceBlock[] = [
  { id: "entry", kind: "entry" },
  { id: "decision", kind: "condition" },
  { id: "accepted", kind: "operation" },
  { id: "rejected", kind: "operation" },
  { id: "merge", kind: "operation" },
  { id: "exit", kind: "exit" }
];
const diamondEdges: FunctionLogicBranchChoiceEdge[] = [
  edge("enter", "entry", "decision", "next"),
  edge("true", "decision", "accepted", "true"),
  edge("false", "decision", "rejected", "false"),
  edge("accepted-merge", "accepted", "merge", "next"),
  edge("rejected-merge", "rejected", "merge", "next"),
  edge("finish", "merge", "exit", "next")
];

test("keeps the selected branch and shared merge continuation reachable", () => {
  const unconstrained = createFunctionLogicBranchChoiceProjection(
    diamondBlocks,
    diamondEdges,
    new Map()
  );
  const selected = createFunctionLogicBranchChoiceProjection(
    diamondBlocks,
    diamondEdges,
    new Map([["decision", "true"]])
  );

  assert.deepEqual(sorted(unconstrained.activeBlockIds), sortedIds(diamondBlocks));
  assert.deepEqual(sorted(unconstrained.activeEdgeIds), sortedEdgeIds(diamondEdges));
  assert.deepEqual(sorted(selected.activeBlockIds), [
    "accepted", "decision", "entry", "exit", "merge"
  ]);
  assert.deepEqual(sorted(selected.activeEdgeIds), [
    "accepted-merge", "enter", "finish", "true"
  ]);
  assert.deepEqual(sorted(selected.selectedEdgeIds), ["true"]);
});

test("composes nested choices and retains them while an outer branch is inactive", () => {
  const blocks: FunctionLogicBranchChoiceBlock[] = [
    { id: "entry", kind: "entry" },
    { id: "outer", kind: "condition" },
    { id: "inner", kind: "condition" },
    { id: "inner-true" },
    { id: "inner-false" },
    { id: "fallback" },
    { id: "merge" }
  ];
  const edges: FunctionLogicBranchChoiceEdge[] = [
    edge("enter", "entry", "outer", "next"),
    edge("outer-true", "outer", "inner", "true"),
    edge("outer-false", "outer", "fallback", "false"),
    edge("inner-true-edge", "inner", "inner-true", "true"),
    edge("inner-false-edge", "inner", "inner-false", "false"),
    edge("inner-true-merge", "inner-true", "merge", "next"),
    edge("inner-false-merge", "inner-false", "merge", "next"),
    edge("fallback-merge", "fallback", "merge", "next")
  ];
  const nestedChoices = new Map([
    ["outer", "outer-true"],
    ["inner", "inner-false-edge"]
  ]);
  const nested = createFunctionLogicBranchChoiceProjection(blocks, edges, nestedChoices);
  const switched = createFunctionLogicBranchChoiceProjection(blocks, edges, new Map([
    ["outer", "outer-false"],
    ["inner", "inner-false-edge"]
  ]));

  assert.deepEqual(sorted(nested.activeBlockIds), [
    "entry", "inner", "inner-false", "merge", "outer"
  ]);
  assert.deepEqual(sorted(switched.activeBlockIds), [
    "entry", "fallback", "merge", "outer"
  ]);
  assert.deepEqual(sorted(switched.selectedEdgeIds), [
    "inner-false-edge", "outer-false"
  ]);
});

test("selects one case edge and terminates a selected cyclic path iteratively", () => {
  const caseBlocks: FunctionLogicBranchChoiceBlock[] = [
    { id: "entry", kind: "entry" },
    { id: "switch", kind: "switch" },
    { id: "open" },
    { id: "closed" },
    { id: "done" }
  ];
  const caseEdges: FunctionLogicBranchChoiceEdge[] = [
    edge("enter", "entry", "switch", "next"),
    edge("case-open", "switch", "open", "case"),
    edge("case-closed", "switch", "closed", "case"),
    edge("open-done", "open", "done", "next"),
    edge("closed-done", "closed", "done", "next")
  ];
  const caseProjection = createFunctionLogicBranchChoiceProjection(
    caseBlocks,
    caseEdges,
    new Map([["switch", "case-closed"]])
  );
  const cycleBlocks: FunctionLogicBranchChoiceBlock[] = [
    { id: "entry", kind: "entry" },
    { id: "loop", kind: "condition" },
    { id: "body" },
    { id: "exit", kind: "exit" }
  ];
  const cycleEdges: FunctionLogicBranchChoiceEdge[] = [
    edge("cycle-enter", "entry", "loop", "next"),
    edge("cycle-true", "loop", "body", "true"),
    edge("cycle-false", "loop", "exit", "false"),
    edge("repeat", "body", "loop", "repeat")
  ];
  const cycleProjection = createFunctionLogicBranchChoiceProjection(
    cycleBlocks,
    cycleEdges,
    new Map([["loop", "cycle-true"]])
  );

  assert.deepEqual(sorted(caseProjection.activeBlockIds), ["closed", "done", "entry", "switch"]);
  assert.deepEqual(sorted(caseProjection.activeEdgeIds), ["case-closed", "closed-done", "enter"]);
  assert.deepEqual(sorted(cycleProjection.activeBlockIds), ["body", "entry", "loop"]);
  assert.deepEqual(sorted(cycleProjection.activeEdgeIds), ["cycle-enter", "cycle-true", "repeat"]);
});

test("honors an explicit traversal depth limit", () => {
  const projection = createFunctionLogicBranchChoiceProjection(
    diamondBlocks,
    diamondEdges,
    new Map([["decision", "true"]]),
    2
  );

  assert.deepEqual(sorted(projection.activeBlockIds), ["accepted", "decision", "entry"]);
  assert.deepEqual(sorted(projection.activeEdgeIds), ["enter", "true"]);
});

test("toggles a source choice and prunes stale or non-choice identities", () => {
  const trueEdge = diamondEdges.find((candidate) => candidate.id === "true");
  const enterEdge = diamondEdges.find((candidate) => candidate.id === "enter");
  assert.ok(trueEdge && enterEdge);
  const selected = toggleFunctionLogicBranchChoice(new Map(), trueEdge);
  const cleared = toggleFunctionLogicBranchChoice(selected, trueEdge);
  const ignored = toggleFunctionLogicBranchChoice(selected, enterEdge);
  const pruned = pruneFunctionLogicBranchChoices(new Map([
    ["decision", "true"],
    ["missing", "missing-edge"]
  ]), diamondEdges);

  assert.deepEqual([...selected], [["decision", "true"]]);
  assert.equal(cleared.size, 0);
  assert.deepEqual([...ignored], [...selected]);
  assert.deepEqual([...pruned], [["decision", "true"]]);
});

test("exports identical branch reachability into the Webview runtime", () => {
  const source = getFunctionLogicBranchChoicesBrowserSource();
  const browser = new Function(`${source}\nreturn {
    createFunctionLogicBranchChoiceProjection,
    toggleFunctionLogicBranchChoice
  };`)() as {
    createFunctionLogicBranchChoiceProjection: typeof createFunctionLogicBranchChoiceProjection;
    toggleFunctionLogicBranchChoice: typeof toggleFunctionLogicBranchChoice;
  };
  const choices = new Map([["decision", "false"]]);
  const host = createFunctionLogicBranchChoiceProjection(
    diamondBlocks,
    diamondEdges,
    choices
  );
  const webview = browser.createFunctionLogicBranchChoiceProjection(
    diamondBlocks,
    diamondEdges,
    choices
  );

  assert.deepEqual(sorted(webview.activeBlockIds), sorted(host.activeBlockIds));
  assert.deepEqual(sorted(webview.activeEdgeIds), sorted(host.activeEdgeIds));
  assert.deepEqual(
    [...browser.toggleFunctionLogicBranchChoice(choices, diamondEdges[2])],
    []
  );
});

/** Creates a compact edge fixture without presentation-only fields. */
function edge(
  id: string,
  sourceId: string,
  targetId: string,
  kind: string
): FunctionLogicBranchChoiceEdge {
  return { id, sourceId, targetId, kind };
}

/** Produces deterministic set assertions without locale-dependent ordering. */
function sorted(values: ReadonlySet<string>): string[] {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

/** Reads sorted block identities from one fixture. */
function sortedIds(blocks: readonly FunctionLogicBranchChoiceBlock[]): string[] {
  return blocks.map((block) => block.id).sort();
}

/** Reads sorted edge identities from one fixture. */
function sortedEdgeIds(edges: readonly FunctionLogicBranchChoiceEdge[]): string[] {
  return edges.map((value) => value.id).sort();
}
