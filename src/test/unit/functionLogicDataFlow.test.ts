/**
 * Function Logic data-flow tests cover parameter/local/constant discovery,
 * definition/use projection across branch merges, Python/Java language
 * semantics, and bounded cycle-safe reaching-definition traversal.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeFunctionLogic,
  createFunctionLogicDataFlowProjection,
  type FunctionLogicAnalysis,
  type FunctionLogicBlock,
  type FunctionLogicEdge,
  type FunctionLogicValueBinding,
  type FunctionLogicValueFacts
} from "../../analyzer/functionLogic";
import type { SourceRange, SymbolNode } from "../../shared/types";

test("tracks TypeScript parameters, locals, constants, and branch-reaching definitions", () => {
  const analysis = analyzeSource(
    "typescript",
    "/workspace/src/calculate.ts",
    "calculate",
    [
      "function calculate(user: User, factor = 2) {",
      "  const LIMIT = 3;",
      "  let total = user.count;",
      "  if (total > LIMIT) {",
      "    total += factor;",
      "  }",
      "  return total;",
      "}"
    ].join("\n")
  );

  assertBinding(analysis, "user", "parameter", "exact");
  assertBinding(analysis, "factor", "parameter", "exact");
  assertBinding(analysis, "LIMIT", "constant", "exact");
  const total = assertBinding(analysis, "total", "local", "exact");
  assertBlockAccess(analysis, "let total", "user", "read");
  assertBlockAccess(analysis, "if total", "LIMIT", "read");
  assertBlockAccess(analysis, "total += factor", "total", "readwrite");

  const returnBlock = findBlock(analysis, "return total");
  const sourceLabels = new Set((analysis.valueFlows ?? [])
    .filter((flow) => flow.bindingId === total.id && flow.targetBlockId === returnBlock.id)
    .map((flow) => analysis.blocks.find((block) => block.id === flow.sourceBlockId)?.label));
  assert.deepEqual(sourceLabels, new Set(["let total = user.count;", "total += factor;"]));
});

test("uses language-specific constant semantics for Python and Java", () => {
  const python = analyzeSource(
    "python",
    "/workspace/src/calculate.py",
    "calculate",
    [
      "def calculate(user, factor=2):",
      "    LIMIT = 3",
      "    total = user.count",
      "    total += factor",
      "    return total"
    ].join("\n"),
    4
  );
  const java = analyzeSource(
    "java",
    "/workspace/src/Calculator.java",
    "calculate",
    [
      "class Calculator {",
      "  int calculate(User user, int factor) {",
      "    final int LIMIT = 3;",
      "    int total = user.count();",
      "    total += factor;",
      "    return total;",
      "  }",
      "}"
    ].join("\n"),
    6,
    "Calculator.calculate"
  );

  assertBinding(python, "LIMIT", "constant", "inferred");
  assertBinding(python, "total", "local", "exact");
  assertBlockAccess(python, "total += factor", "factor", "read");
  assertBinding(java, "LIMIT", "constant", "exact");
  assertBinding(java, "user", "parameter", "exact");
  assertBlockAccess(java, "int total", "user", "read");
});

test("omits ambiguous shadowed TypeScript names instead of inventing binding identity", () => {
  const analysis = analyzeSource(
    "typescript",
    "/workspace/src/shadow.ts",
    "shadow",
    [
      "function shadow(input: number) {",
      "  let value = input;",
      "  if (input > 0) {",
      "    const value = input + 1;",
      "    consume(value);",
      "  }",
      "  return value;",
      "}"
    ].join("\n")
  );

  assert.equal(analysis.valueBindings?.some((binding) => binding.name === "value"), false);
  assert.ok(analysis.valueBindings?.some((binding) => binding.name === "input"));
});

test("bounds iterative reaching-definition traversal and deduplicates cyclic edges", () => {
  const blocks = [
    block("entry", "entry", 0),
    block("define", "operation", 1),
    block("loop", "loop", 2),
    block("body", "operation", 3),
    block("read", "return", 4)
  ];
  const edges: FunctionLogicEdge[] = [
    edge("enter", "entry", "define"),
    edge("start-loop", "define", "loop"),
    edge("iterate", "loop", "body", "iterate"),
    edge("duplicate-iterate", "loop", "body", "iterate"),
    edge("repeat", "body", "loop", "repeat"),
    edge("leave", "body", "read")
  ];
  const facts: FunctionLogicValueFacts = {
    bindings: [{
      id: "binding:total",
      name: "total",
      kind: "local",
      declarationRange: range(1),
      definitionPlacement: "source",
      confidence: "exact"
    }],
    accesses: [{
      bindingId: "binding:total",
      access: "read",
      range: range(4),
      confidence: "exact"
    }]
  };
  const tooShallow = createFunctionLogicDataFlowProjection(blocks, edges, facts, 2);
  const complete = createFunctionLogicDataFlowProjection(blocks, edges, facts, 5);

  assert.equal(tooShallow.valueFlows.length, 0);
  assert.deepEqual(complete.valueFlows.map((flow) => [
    flow.sourceBlockId,
    flow.targetBlockId
  ]), [["define", "read"]]);
});

/** Runs one selected callable against its source snapshot. */
function analyzeSource(
  language: string,
  filePath: string,
  name: string,
  sourceText: string,
  selectionCharacter = 9,
  qualifiedName = name
): FunctionLogicAnalysis {
  const line = sourceText.slice(0, sourceText.indexOf(name)).split("\n").length - 1;
  return analyzeFunctionLogic({
    functionNode: createFunctionNode(
      language,
      filePath,
      name,
      qualifiedName,
      line,
      selectionCharacter
    ),
    sourceText
  });
}

/** Creates one graph symbol with cursor-backed fallback for parser selection. */
function createFunctionNode(
  language: string,
  filePath: string,
  name: string,
  qualifiedName: string,
  line: number,
  character: number
): SymbolNode {
  const selectionRange: SourceRange = {
    startLine: line,
    startCharacter: character,
    endLine: line,
    endCharacter: character + name.length
  };
  return {
    id: `function:${qualifiedName}`,
    kind: "function",
    name,
    qualifiedName,
    filePath,
    range: selectionRange,
    selectionRange,
    language,
    metadata: { cursorResolved: true }
  };
}

/** Asserts and returns one binding by source name. */
function assertBinding(
  analysis: FunctionLogicAnalysis,
  name: string,
  kind: FunctionLogicValueBinding["kind"],
  confidence: FunctionLogicValueBinding["confidence"]
): FunctionLogicValueBinding {
  const binding = analysis.valueBindings?.find((candidate) => candidate.name === name);
  assert.ok(binding, `missing ${name} binding`);
  assert.equal(binding.kind, kind);
  assert.equal(binding.confidence, confidence);
  return binding;
}

/** Asserts one block-local definition/use role. */
function assertBlockAccess(
  analysis: FunctionLogicAnalysis,
  labelPrefix: string,
  name: string,
  access: "define" | "read" | "write" | "readwrite"
): void {
  const block = findBlock(analysis, labelPrefix);
  assert.ok(block.valueAccesses?.some((candidate) =>
    candidate.name === name && candidate.access === access
  ), `missing ${access} ${name} on ${block.label}`);
}

/** Finds one visible block by complete source-label prefix. */
function findBlock(analysis: FunctionLogicAnalysis, labelPrefix: string): FunctionLogicBlock {
  const result = analysis.blocks.find((block) => block.label.startsWith(labelPrefix));
  assert.ok(result, `missing block ${labelPrefix}`);
  return result;
}

/** Creates a compact pure-projection block fixture. */
function block(id: string, kind: FunctionLogicBlock["kind"], line: number): FunctionLogicBlock {
  return {
    id,
    kind,
    label: id,
    detail: id,
    depth: 0,
    confidence: "exact",
    filePath: "/workspace/value.ts",
    range: range(line)
  };
}

/** Creates a compact exact control edge fixture. */
function edge(
  id: string,
  sourceId: string,
  targetId: string,
  kind: FunctionLogicEdge["kind"] = "next"
): FunctionLogicEdge {
  return { id, sourceId, targetId, kind, confidence: "exact" };
}

/** Returns one non-overlapping line range for fact-to-block mapping. */
function range(line: number): SourceRange {
  return {
    startLine: line,
    startCharacter: 0,
    endLine: line,
    endCharacter: 10
  };
}
