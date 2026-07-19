/**
 * Python expression-flow regressions. They prove eager comprehensions become
 * nested CFG regions and receiver-call chains follow Python evaluation order.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  analyzeFunctionLogic,
  type FunctionLogicAnalysis,
  type FunctionLogicBlock
} from "../../analyzer/functionLogic";
import type { SymbolNode } from "../../shared/types";

const projectRoot = path.resolve(__dirname, "../../..");
const fixturePath = path.join(
  projectRoot,
  "src/test/fixtures/functionLogic/python_expression_flow.py"
);
const fixtureSource = fs.readFileSync(fixturePath, "utf8");
const functionalChainFixturePath = path.join(
  projectRoot,
  "src/test/fixtures/functionLogic/python_functional_chaining.py"
);
const functionalChainFixtureSource = fs.readFileSync(functionalChainFixturePath, "utf8");

test("models a list comprehension as loop, filter, item, and final assignment", () => {
  const sourceText = [
    "def collect(values):",
    "    result = [normalize(a) for a in load(values) if allowed(a)]",
    "    return result"
  ].join("\n");
  const analysis = analyzePythonSource("collect", sourceText, "/workspace/collect.py");

  assert.deepEqual(analysis.blocks.map((block) => block.kind), [
    "entry",
    "loop",
    "condition",
    "call",
    "mutation",
    "return",
    "exit"
  ]);
  const loop = findBlock(analysis, (block) => block.label.startsWith("for a in load(values)"));
  const filter = findBlock(analysis, (block) => block.label.startsWith("if allowed(a)"));
  const item = findBlock(analysis, (block) => block.label === "list item ← normalize(a)");
  const assignment = findBlock(analysis, (block) => block.label.startsWith("result = ["));

  assert.equal(filter.parentBlockId, loop.id);
  assert.equal(item.parentBlockId, filter.id);
  assert.deepEqual(loop.valueChanges, [{
    target: "a",
    targetKind: "variable",
    operation: "iterate",
    operator: "← each",
    value: "load(values)",
    confidence: "exact"
  }]);
  assertEdge(analysis, loop, filter, "iterate");
  assertEdge(analysis, loop, assignment, "exit");
  assertEdge(analysis, filter, loop, "false");
  assertEdge(analysis, item, loop, "repeat");
  assert.deepEqual(analysis.callsites.map((callsite) => callsite.calleeText), [
    "load",
    "allowed",
    "normalize"
  ]);
});

test("keeps nested comprehension clauses and call chains at their execution depth", () => {
  const analysis = analyzeFixtureFunction("build_visible_records");
  const outerLoop = findBlock(analysis, (block) =>
    block.kind === "loop" && block.label.includes("for group in")
  );
  const policyFilter = findBlock(analysis, (block) =>
    block.kind === "condition" && block.label.includes("policy.for_group(group).allows()")
  );
  const innerLoop = findBlock(analysis, (block) =>
    block.kind === "loop" && block.label.includes("for record in")
  );
  const resultFreeze = findBlock(analysis, (block) =>
    block.label === "call freeze() on previous result"
      && block.parentBlockId !== undefined
  );
  const returnResult = findBlock(analysis, (block) =>
    block.label === "call result() on previous result" && block.depth === 1
  );

  assert.equal(policyFilter.parentBlockId, outerLoop.id);
  assert.equal(innerLoop.parentBlockId, policyFilter.id);
  assert.ok(resultFreeze.depth > innerLoop.depth);
  assert.equal(returnResult.kind, "call");
  assert.ok(analysis.summary.loopCount >= 3);
  assert.ok(analysis.summary.branchCount >= 3);
  assert.deepEqual(
    analysis.blocks
      .filter((block) => block.depth === 1 && block.label.startsWith("call "))
      .slice(0, 3)
      .map((block) => block.label),
    [
      "call client.load_groups(group_ids)",
      "call active() on previous result",
      "call ordered() on previous result"
    ]
  );
  assert.deepEqual(analysis.callsites.slice(0, 6).map((callsite) => callsite.calleeName), [
    "load_groups",
    "active",
    "ordered",
    "for_group",
    "allows",
    "records"
  ]);
  for (const block of analysis.blocks) {
    assert.doesNotMatch(block.label, /…|\.\.\./u);
  }
});

test("models the functional chaining fixture as execution-ordered stages", () => {
  const analysis = analyzePythonSource(
    "run_functional_chain",
    functionalChainFixtureSource,
    functionalChainFixturePath
  );
  const expectedLabels = [
    "call FunctionalPipeline(records)",
    "call filter(is_billable) on previous result",
    "call map(normalize_record) on previous result",
    "call flat_map(expand_record) on previous result",
    "call tap(audit) on previous result",
    "call reduce(merge_totals, {}) on previous result"
  ];
  const chainBlocks = expectedLabels.map((label) =>
    findBlock(analysis, (block) => block.label === label)
  );

  assert.deepEqual(analysis.callsites.map((callsite) => ({
    name: callsite.calleeName,
    chain: callsite.callChain
  })), [
    { name: "FunctionalPipeline", chain: "start" },
    { name: "filter", chain: "continuation" },
    { name: "map", chain: "continuation" },
    { name: "flat_map", chain: "continuation" },
    { name: "tap", chain: "continuation" },
    { name: "reduce", chain: "continuation" }
  ]);
  assert.deepEqual(chainBlocks.map((block) => block.label), expectedLabels);
  for (let index = 1; index < chainBlocks.length; index += 1) {
    assertEdge(analysis, chainBlocks[index - 1], chainBlocks[index], "next");
  }
});

test("models a variable-rooted functional chain without losing its constructor", () => {
  const analysis = analyzePythonSource(
    "collect_in_batches",
    functionalChainFixtureSource,
    functionalChainFixturePath
  );
  const batch = findBlock(analysis, (block) =>
    block.label === "call pipeline.batch(batch_size)"
  );
  const collect = findBlock(analysis, (block) =>
    block.label === "call collect() on previous result"
  );

  assert.deepEqual(analysis.callsites.map((callsite) => ({
    name: callsite.calleeName,
    chain: callsite.callChain
  })), [
    { name: "FunctionalPipeline", chain: undefined },
    { name: "batch", chain: "start" },
    { name: "collect", chain: "continuation" }
  ]);
  assertEdge(analysis, batch, collect, "next");
});

test("does not mistake the fixture's subscript-key call for a receiver chain", () => {
  const analysis = analyzePythonSource(
    "dispatch_chain_result",
    functionalChainFixtureSource,
    functionalChainFixturePath
  );

  assert.deepEqual(analysis.callsites.map((callsite) => ({
    name: callsite.calleeName,
    chain: callsite.callChain
  })), [
    { name: "run_functional_chain", chain: undefined },
    { name: "select_handler", chain: undefined },
    { name: "handlers[select_handler(handler_key)]", chain: undefined }
  ]);
  assert.equal(
    analysis.blocks.some((block) => block.label.includes("on previous result")),
    false
  );
});

test("leaves lazy generator bodies inside the return block", () => {
  const analysis = analyzeFixtureFunction("create_lazy_records");

  assert.deepEqual(analysis.blocks.map((block) => block.kind), [
    "entry",
    "operation",
    "return",
    "exit"
  ]);
  assert.equal(analysis.blocks.some((block) => block.label.startsWith("call ")), false);
  assert.match(
    analysis.gaps.map((gap) => gap.message).join(" "),
    /lazy generator expressions/u
  );
});

test("expands flat and parenthesized generator arguments with inferred consumption", () => {
  const analysis = analyzeFixtureFunction("add_rtcc_investors");
  const loop = findBlock(analysis, (block) =>
    block.label === "for stakeholder_id in stakeholder_ids_to_add · generator argument"
  );
  const investor = findBlock(analysis, (block) =>
    block.label.startsWith("generator argument item ← RtccInvestor(")
  );
  const bulkCreate = findBlock(analysis, (block) =>
    block.label.startsWith("RtccInvestor.objects.bulk_create(")
  );

  assert.equal(loop.kind, "loop");
  assert.equal(loop.confidence, "inferred");
  assert.equal(investor.kind, "call");
  assert.equal(investor.confidence, "inferred");
  assert.equal(investor.parentBlockId, loop.id);
  assert.equal(bulkCreate.kind, "effect");
  assert.deepEqual(analysis.callsites.map((callsite) => callsite.calleeName), [
    "RtccInvestor",
    "bulk_create"
  ]);
  assertEdge(analysis, loop, investor, "iterate", "inferred");
  assertEdge(analysis, investor, loop, "repeat", "inferred");
  assertEdge(analysis, loop, bulkCreate, "exit", "inferred");
  assert.doesNotMatch(investor.label, /…|\.\.\./u);

  const explicit = analyzePythonSource(
    "consume",
    "def consume(values):\n    publish((build(value) for value in values), batch_size())",
    "/workspace/explicit_generator_argument.py"
  );
  assert.ok(explicit.blocks.some((block) =>
    block.label === "for value in values · generator argument"
      && block.confidence === "inferred"
  ));
});

/** Runs the public dispatcher against one named Python fixture function. */
function analyzeFixtureFunction(name: string): FunctionLogicAnalysis {
  return analyzePythonSource(name, fixtureSource, fixturePath);
}

/** Creates an exact symbol location before invoking the public analyzer. */
function analyzePythonSource(
  name: string,
  sourceText: string,
  filePath: string
): FunctionLogicAnalysis {
  const declaration = new RegExp(`def\\s+${name}\\b`, "u").exec(sourceText);
  assert.ok(declaration, `missing ${name} declaration`);
  const nameOffset = sourceText.indexOf(name, declaration.index);
  const lineStart = sourceText.lastIndexOf("\n", nameOffset - 1) + 1;
  const startLine = sourceText.slice(0, lineStart).split("\n").length - 1;
  const startCharacter = nameOffset - lineStart;
  return analyzeFunctionLogic({
    functionNode: createPythonFunctionNode(name, filePath, startLine, startCharacter),
    sourceText,
    maxBlocks: 160
  });
}

/** Creates the minimum graph symbol contract required for callable matching. */
function createPythonFunctionNode(
  name: string,
  filePath: string,
  startLine: number,
  startCharacter: number
): SymbolNode {
  const selectionRange = {
    startLine,
    startCharacter,
    endLine: startLine,
    endCharacter: startCharacter + name.length
  };
  return {
    id: `function:${filePath}:${name}`,
    kind: "function",
    name,
    qualifiedName: name,
    filePath,
    language: "python",
    range: selectionRange,
    selectionRange,
    metadata: {}
  };
}

/** Finds a required syntax-backed graph block with a focused failure. */
function findBlock(
  analysis: FunctionLogicAnalysis,
  predicate: (block: FunctionLogicBlock) => boolean
): FunctionLogicBlock {
  const block = analysis.blocks.find(predicate);
  assert.ok(block, "missing expected Python expression-flow block");
  return block;
}

/** Verifies one exact control transfer between two visible blocks. */
function assertEdge(
  analysis: FunctionLogicAnalysis,
  source: FunctionLogicBlock,
  target: FunctionLogicBlock,
  kind: string,
  confidence?: "exact" | "inferred"
): void {
  assert.ok(analysis.edges.some((edge) =>
    edge.sourceId === source.id
      && edge.targetId === target.id
      && edge.kind === kind
      && (confidence === undefined || edge.confidence === confidence)
  ), `missing ${kind} edge from ${source.label} to ${target.label}`);
}
