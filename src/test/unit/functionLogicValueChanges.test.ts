/**
 * Cross-language Function Logic value-change fixtures. They prove exact
 * variable/property writes, inferred receiver mutations, loop bindings, and
 * complete source text/counts without relying on runtime values.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import type {
  FunctionLogicAnalysis,
  FunctionLogicLanguage,
  FunctionLogicValueChange
} from "../../analyzer/functionLogic";
import type { SymbolNode } from "../../shared/types";

test("exposes variable, property, and receiver changes in TypeScript", () => {
  const analysis = analyzeValueChanges(
    "typescript",
    "/workspace/src/update.ts",
    "update",
    0,
    [
      "function update(item: Item) {",
      "  let total = 0;",
      "  total += item.price;",
      "  this.status = item.status;",
      "  items.push(item);",
      "  return queue.shift();",
      "}"
    ].join("\n")
  );

  assertExactWrite(requireChange(analysis, "total", "initialize"), "=", "0");
  assertExactWrite(requireChange(analysis, "total", "update"), "+=", "item.price");
  assertExactWrite(requireChange(analysis, "this.status", "assign"), "=", "item.status");
  assertReceiverChange(requireChange(analysis, "items", "mutate"), "push()", "item");
  assertReceiverChange(requireChange(analysis, "queue", "mutate"), "shift()", undefined);
  assert.equal(analysis.summary.valueChangeCount, 5);
});

test("reuses the value-change contract for JavaScript", () => {
  const analysis = analyzeValueChanges(
    "javascript",
    "/workspace/src/update.js",
    "update",
    0,
    "function update(item) { count++; cache.set(item.id, item); }"
  );

  assertExactWrite(requireChange(analysis, "count", "update"), "++", "");
  assertReceiverChange(
    requireChange(analysis, "cache", "mutate"),
    "set()",
    "item.id, item"
  );
  assert.equal(analysis.summary.valueChangeCount, 2);
});

test("exposes variable, property, and receiver changes in Python", () => {
  const analysis = analyzeValueChanges(
    "python",
    "/workspace/src/update.py",
    "update",
    0,
    [
      "def update(self, item):",
      "    total = 0",
      "    total += item.price",
      "    self.status = item.status",
      "    items.append(item)",
      "    return queue.pop()"
    ].join("\n")
  );

  assertExactWrite(requireChange(analysis, "total", "assign"), "=", "0");
  assertExactWrite(requireChange(analysis, "total", "update"), "+=", "item.price");
  assertExactWrite(requireChange(analysis, "self.status", "assign"), "=", "item.status");
  assertReceiverChange(requireChange(analysis, "items", "mutate"), "append()", "item");
  assertReceiverChange(requireChange(analysis, "queue", "mutate"), "pop()", undefined);
  assert.equal(analysis.summary.valueChangeCount, 5);
});

test("exposes variable, field, and receiver changes in Java", () => {
  const analysis = analyzeValueChanges(
    "java",
    "/workspace/src/Updater.java",
    "update",
    1,
    [
      "class Updater {",
      "  void update(Item item) {",
      "    int total = 0;",
      "    total += item.price;",
      "    this.status = item.status;",
      "    items.add(item);",
      "    return queue.poll();",
      "  }",
      "}"
    ].join("\n"),
    "Updater.update"
  );

  assertExactWrite(requireChange(analysis, "total", "initialize"), "=", "0");
  assertExactWrite(requireChange(analysis, "total", "update"), "+=", "item.price");
  assertExactWrite(requireChange(analysis, "this.status", "assign"), "=", "item.status");
  assertReceiverChange(requireChange(analysis, "items", "mutate"), "add()", "item");
  assertReceiverChange(requireChange(analysis, "queue", "mutate"), "poll()", undefined);
  assert.equal(analysis.summary.valueChangeCount, 5);
});

test("shows loop bindings on the loop block without absorbing body changes", () => {
  const analyses = [
    analyzeValueChanges(
      "typescript",
      "/workspace/src/loops.ts",
      "read",
      0,
      "function read(items) { for (const item of items) { queue.pop(); } }"
    ),
    analyzeValueChanges(
      "python",
      "/workspace/src/loops.py",
      "read",
      0,
      "def read(items):\n    for item in items:\n        queue.pop()"
    ),
    analyzeValueChanges(
      "java",
      "/workspace/src/Loops.java",
      "read",
      1,
      "class Loops { void read(List<Item> items) { for (Item item : items) { queue.poll(); } } }",
      "Loops.read"
    )
  ];

  for (const analysis of analyses) {
    const loop = analysis.blocks.find((block) => block.kind === "loop");
    const receiver = analysis.blocks.find((block) =>
      block.valueChanges?.some((change) => change.target === "queue")
    );
    assert.equal(loop?.valueChanges?.[0]?.target, "item");
    assert.equal(loop?.valueChanges?.[0]?.operation, "iterate");
    assert.notEqual(receiver?.id, loop?.id);
  }
});

test("keeps every change from one statement instead of silently dropping later targets", () => {
  const declarations = Array.from(
    { length: 8 },
    (_, index) => `value${index} = ${index}`
  ).join(", ");
  const analysis = analyzeValueChanges(
    "typescript",
    "/workspace/src/complete-values.ts",
    "completeValues",
    0,
    `function completeValues() { let ${declarations}; }`
  );
  const changes = analysis.blocks.flatMap((block) => block.valueChanges ?? []);

  assert.deepEqual(changes.map((change) => change.target), [
    "value0",
    "value1",
    "value2",
    "value3",
    "value4",
    "value5",
    "value6",
    "value7"
  ]);
  assert.equal(analysis.summary.valueChangeCount, 8);
});

test("preserves long targets and right-hand values through every language adapter", () => {
  const literal = `"${"source-value-".repeat(24)}graph_value_tail"`;
  const memberPath = `${"completeSegment.".repeat(12)}graph_target_tail`;
  const typescriptTarget = `state.${memberPath}`;
  const pythonTarget = `self.${memberPath}`;
  const javaTarget = `this.${memberPath}`;
  const analyses = [{
    analysis: analyzeValueChanges(
      "typescript",
      "/workspace/src/complete-value.ts",
      "completeValue",
      0,
      `function completeValue() { ${typescriptTarget} = ${literal}; }`
    ),
    target: typescriptTarget
  }, {
    analysis: analyzeValueChanges(
      "python",
      "/workspace/src/complete_value.py",
      "complete_value",
      0,
      `def complete_value(self):\n    ${pythonTarget} = ${literal}`
    ),
    target: pythonTarget
  }, {
    analysis: analyzeValueChanges(
      "java",
      "/workspace/src/CompleteValue.java",
      "completeValue",
      1,
      `class CompleteValue {\n  void completeValue() { ${javaTarget} = ${literal}; }\n}`,
      "CompleteValue.completeValue"
    ),
    target: javaTarget
  }];

  for (const fixture of analyses) {
    const change = requireChange(fixture.analysis, fixture.target, "assign");
    assert.equal(change.target, fixture.target);
    assert.equal(change.value, literal);
    assert.ok(change.target.length > 80);
    assert.doesNotMatch(change.value ?? "", /…/u);
    assert.ok((change.value?.length ?? 0) > 120);
  }
});

/** Runs one public analyzer adapter with a cursor-backed callable identity. */
function analyzeValueChanges(
  language: Exclude<FunctionLogicLanguage, "unsupported">,
  filePath: string,
  name: string,
  line: number,
  sourceText: string,
  qualifiedName = name
): FunctionLogicAnalysis {
  return analyzeFunctionLogic({
    functionNode: createFunctionNode(language, filePath, name, qualifiedName, line),
    sourceText
  });
}

/** Creates an exact callable identity while allowing parser-position fallback. */
function createFunctionNode(
    language: "typescript" | "javascript" | "python" | "java",
  filePath: string,
  name: string,
  qualifiedName: string,
  line: number
): SymbolNode {
  const range = {
    startLine: line,
    startCharacter: 0,
    endLine: line,
    endCharacter: name.length
  };
  return {
    id: `function:${qualifiedName}`,
    kind: "function",
    name,
    qualifiedName,
    filePath,
    language,
    range,
    selectionRange: range,
    metadata: { cursorResolved: true }
  };
}

/** Finds one change by target and operation across all visible blocks. */
function requireChange(
  analysis: FunctionLogicAnalysis,
  target: string,
  operation: FunctionLogicValueChange["operation"]
): FunctionLogicValueChange {
  const change = analysis.blocks.flatMap((block) => block.valueChanges ?? []).find((candidate) =>
    candidate.target === target && candidate.operation === operation
  );
  assert.ok(change, `missing ${operation} change for ${target}`);
  return change;
}

/** Verifies syntax-proven assignment metadata. */
function assertExactWrite(
  change: FunctionLogicValueChange,
  operator: string,
  value: string
): void {
  assert.equal(change.confidence, "exact");
  assert.notEqual(change.targetKind, "receiver");
  assert.equal(change.operator, operator);
  assert.equal(change.value ?? "", value);
}

/** Verifies that method-name receiver semantics remain visibly conservative. */
function assertReceiverChange(
  change: FunctionLogicValueChange,
  operator: string,
  value: string | undefined
): void {
  assert.equal(change.targetKind, "receiver");
  assert.equal(change.confidence, "inferred");
  assert.equal(change.operator, operator);
  assert.equal(change.value, value);
}
