/**
 * Function Logic analyzer tests. Fixtures cover structured branch/loop paths,
 * syntax-backed evidence, bounded traversal, concise arrows, and honest gaps.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import type { SymbolNode } from "../../shared/types";

const source = [
  "export async function processOrder(order: Order, limit: number) {",
  "  if (!order.items.length) {",
  "    throw new Error('empty');",
  "  }",
  "  let total = 0;",
  "  for (const item of order.items) {",
  "    total += item.price;",
  "  }",
  "  if (total > limit) {",
  "    await audit.publish(total);",
  "  } else {",
  "    await repository.save(order);",
  "  }",
  "  return { total };",
  "}"
].join("\n");

test("builds statement, branch, repeat, effect, and exit paths inside a function", () => {
  const analysis = analyzeFunctionLogic({
    functionNode: createFunctionNode("processOrder", "/workspace/src/orders.ts", 0),
    sourceText: source
  });

  assert.equal(analysis.language, "typescript");
  assert.match(analysis.signature, /processOrder\(order: Order, limit: number\)/u);
  assert.deepEqual(analysis.blocks.map((block) => block.kind), [
    "entry",
    "condition",
    "throw",
    "operation",
    "loop",
    "mutation",
    "condition",
    "effect",
    "effect",
    "return",
    "exit"
  ]);

  const firstCondition = analysis.blocks.find((block) => block.label.startsWith("if !order.items"));
  const loop = analysis.blocks.find((block) => block.kind === "loop");
  const mutation = analysis.blocks.find((block) => block.kind === "mutation");
  const secondCondition = analysis.blocks.find((block) => block.label.startsWith("if total > limit"));
  const effects = analysis.blocks.filter((block) => block.kind === "effect");
  assert.ok(firstCondition && loop && mutation && secondCondition);
  assert.equal(firstCondition.range.startLine, 1);
  assert.equal(mutation.range.startLine, 6);
  assert.deepEqual(effects.map((block) => block.confidence), ["inferred", "inferred"]);
  assert.deepEqual(effects.map((block) => block.branchLabel), ["true", "false"]);

  assertEdgeKindsFrom(analysis, firstCondition.id, ["true", "false"]);
  assertEdgeKindsFrom(analysis, loop.id, ["iterate", "exit"]);
  assertEdgeKindsFrom(analysis, mutation.id, ["repeat"]);
  assertEdgeKindsFrom(analysis, secondCondition.id, ["true", "false"]);
  assert.ok(analysis.edges.some((edge) => edge.kind === "return"));
  assert.ok(analysis.edges.some((edge) => edge.kind === "throw"));
  assert.deepEqual(analysis.summary, {
    blockCount: 11,
    branchCount: 2,
    loopCount: 1,
    callCount: 2,
    effectCount: 2,
    mutationCount: 1,
    exitCount: 2
  });
});

test("models a concise arrow body as an implicit return", () => {
  const arrowSource = "const normalize = (value: string) => value.trim();";
  const analysis = analyzeFunctionLogic({
    functionNode: createFunctionNode("normalize", "/workspace/src/text.ts", 0),
    sourceText: arrowSource
  });

  assert.deepEqual(analysis.blocks.map((block) => block.kind), ["entry", "return", "exit"]);
  assert.deepEqual(analysis.edges.map((edge) => edge.kind), ["next", "return"]);
  assert.equal(analysis.blocks[1]?.range.startCharacter, arrowSource.indexOf("value.trim"));
});

test("does not attach a changed source file to a different nearby function", () => {
  const analysis = analyzeFunctionLogic({
    functionNode: createFunctionNode("processOrder", "/workspace/src/orders.ts", 0),
    sourceText: "export function anotherFunction() { return true; }"
  });

  assert.equal(analysis.blocks.length, 0);
  assert.equal(analysis.gaps[0]?.code, "functionNotFound");
});

test("reports unsupported languages and enforces the visible block budget", () => {
  const unsupported = analyzeFunctionLogic({
    functionNode: {
      ...createFunctionNode("process_order", "/workspace/src/orders.py", 0),
      language: "python"
    },
    sourceText: "def process_order(order):\n    return order"
  });
  const bounded = analyzeFunctionLogic({
    functionNode: createFunctionNode("processOrder", "/workspace/src/orders.ts", 0),
    sourceText: source,
    maxBlocks: 3
  });

  assert.equal(unsupported.language, "unsupported");
  assert.equal(unsupported.gaps[0]?.code, "languageUnsupported");
  assert.equal(bounded.blocks.length, 5, "entry and exit remain outside the statement budget");
  assert.ok(bounded.gaps.some((gap) => gap.message.includes("3-block reading limit")));
});

/** Creates the source-backed callable identity supplied by graph analysis. */
function createFunctionNode(name: string, filePath: string, line: number): SymbolNode {
  const selectionRange = {
    startLine: line,
    startCharacter: 22,
    endLine: line,
    endCharacter: 22 + name.length
  };
  return {
    id: `function:${name}`,
    kind: "function",
    name,
    qualifiedName: name,
    filePath,
    range: selectionRange,
    selectionRange,
    language: "typescript"
  };
}

/** Asserts the complete outgoing transfer vocabulary for one block. */
function assertEdgeKindsFrom(
  analysis: ReturnType<typeof analyzeFunctionLogic>,
  sourceId: string,
  expectedKinds: string[]
): void {
  assert.deepEqual(
    analysis.edges.filter((edge) => edge.sourceId === sourceId).map((edge) => edge.kind),
    expectedKinds
  );
}
