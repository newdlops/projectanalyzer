/**
 * Pure Function Logic condition-case projection tests. They cover complete
 * short-circuit paths, nested group isolation, bounded output, and cycles.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createFunctionLogicConditionCaseProjection,
  type FunctionLogicConditionCaseBlock,
  type FunctionLogicConditionCaseEdge
} from "../../application/codeFlow/conditionCases";

const blocks: FunctionLogicConditionCaseBlock[] = [
  block("a", "a", 0, true),
  block("b", "b", 1, false),
  block("c", "c", 2, false),
  { id: "allow", kind: "operation" },
  { id: "deny", kind: "operation" }
];
const edges: FunctionLogicConditionCaseEdge[] = [
  edge("a-true", "a", "b", "true"),
  edge("a-false", "a", "deny", "false"),
  edge("b-true", "b", "allow", "true"),
  edge("b-false", "b", "c", "false"),
  edge("c-true", "c", "allow", "true"),
  edge("c-false", "c", "deny", "false")
];

test("enumerates short-circuit paths instead of a Cartesian truth table", () => {
  const projection = createFunctionLogicConditionCaseProjection(blocks, edges, "a");

  assert.ok(projection);
  assert.deepEqual(projection.columns.map((column) => column.expression), ["a", "b", "c"]);
  assert.deepEqual(projection.rows.map((row) => ({
    values: row.values,
    result: row.result,
    choices: row.choiceEdgeIds,
    target: row.targetBlockId
  })), [
    { values: ["false", "skipped", "skipped"], result: "false", choices: ["a-false"], target: "deny" },
    { values: ["true", "true", "skipped"], result: "true", choices: ["a-true", "b-true"], target: "allow" },
    { values: ["true", "false", "true"], result: "true", choices: ["a-true", "b-false", "c-true"], target: "allow" },
    { values: ["true", "false", "false"], result: "false", choices: ["a-true", "b-false", "c-false"], target: "deny" }
  ]);
});

test("ignores nested standalone conditions and bounds visible case rows", () => {
  const nested = {
    id: "nested",
    kind: "condition",
    condition: { groupId: "nested", expression: "nested", memberIndex: 0, root: true }
  };
  const projection = createFunctionLogicConditionCaseProjection(
    [...blocks, nested],
    [...edges, edge("allow-nested", "allow", "nested", "next")],
    "a",
    { maximumRows: 2 }
  );

  assert.ok(projection);
  assert.equal(projection.rows.length, 2);
  assert.equal(projection.omittedCaseCount, 2);
  assert.deepEqual(projection.columns.map((column) => column.blockId), ["a", "b", "c"]);
});

test("rejects ungrouped roots and terminates malformed same-group cycles", () => {
  assert.equal(
    createFunctionLogicConditionCaseProjection([{ id: "plain", kind: "condition" }], [], "plain"),
    undefined
  );
  const cycleProjection = createFunctionLogicConditionCaseProjection(
    [block("root", "root", 0, true), block("child", "child", 1, false), { id: "exit", kind: "exit" }],
    [
      edge("root-true", "root", "child", "true"),
      edge("root-false", "root", "exit", "false"),
      edge("child-true", "child", "root", "true"),
      edge("child-false", "child", "exit", "false")
    ],
    "root"
  );

  assert.ok(cycleProjection);
  assert.deepEqual(cycleProjection.rows.map((row) => row.choiceEdgeIds), [
    ["root-false"],
    ["root-true", "child-false"]
  ]);
});

/** Creates one condition-group member with a stable test-local identity. */
function block(
  id: string,
  expression: string,
  memberIndex: number,
  root: boolean
): FunctionLogicConditionCaseBlock {
  return {
    id,
    kind: "condition",
    condition: { groupId: "group", expression, memberIndex, root }
  };
}

/** Creates one compact explicit CFG edge. */
function edge(
  id: string,
  sourceId: string,
  targetId: string,
  kind: string
): FunctionLogicConditionCaseEdge {
  return { id, sourceId, targetId, kind };
}
