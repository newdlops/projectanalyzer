/**
 * TypeScript/JavaScript expression-flow regression tests. They verify ternary
 * merge paths and nested ownership, boolean short-circuit routing, nullish
 * fallback, loop identity, source evidence, and bounded whole-region omission.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { analyzeFunctionLogic, type FunctionLogicAnalysis } from "../../analyzer/functionLogic";
import { createFunctionLogicGraphLayout } from "../../application/codeFlow";
import type { SymbolNode } from "../../shared/types";

const projectRoot = path.resolve(__dirname, "../../..");
const fixturePath = path.join(
  projectRoot,
  "src/test/fixtures/functionLogic/expression_branch_flow.ts"
);
const fixtureSource = fs.readFileSync(fixturePath, "utf8");

test("expands ternary and nullish value choices before assignment and return", () => {
  const analysis = analyzeFixtureFunction("chooseDelivery");
  const ready = findBlock(analysis, "check ready");
  const primary = findBlock(analysis, "evaluate loadPrimary()");
  const cached = findBlock(analysis, "check cached is not nullish");
  const fallback = findBlock(analysis, "evaluate loadFallback()");
  const assignment = findBlock(analysis, "const selected =");
  const selected = findBlock(analysis, "check selected");
  const length = findBlock(analysis, "check selected.length > 2");
  const accept = findBlock(analysis, "evaluate accept(selected)");
  const reject = findBlock(analysis, "evaluate reject()");
  const terminalReturn = analysis.blocks.find((block) =>
    block.kind === "return" && block.label.includes("selected &&")
  );

  assert.ok(terminalReturn);
  assertEdge(analysis, ready.id, primary.id, "true");
  assertEdge(analysis, ready.id, cached.id, "false");
  assertEdge(analysis, cached.id, fallback.id, "false", /nullish/u);
  assertEdge(analysis, primary.id, assignment.id, "next", /then value/u);
  assertEdge(analysis, cached.id, assignment.id, "true", /else value/u);
  assertEdge(analysis, fallback.id, assignment.id, "next", /else value/u);
  assertEdge(analysis, selected.id, length.id, "true", /evaluate right/u);
  assertEdge(analysis, length.id, accept.id, "true", /choose then/u);
  assertEdge(analysis, selected.id, reject.id, "false", /choose else/u);
  assertEdge(analysis, accept.id, terminalReturn.id, "next", /then value/u);
  assertEdge(analysis, reject.id, terminalReturn.id, "next", /else value/u);
  assert.deepEqual(
    analysis.blocks.filter((block) => block.kind === "call").map((block) => block.label),
    [
      "evaluate loadPrimary()",
      "evaluate loadFallback()",
      "evaluate accept(selected)",
      "evaluate reject()"
    ]
  );
  assert.deepEqual(analysis.callsites.map((callsite) => callsite.calleeText), [
    "loadPrimary",
    "loadFallback",
    "accept",
    "reject"
  ]);
});

test("retains then/else ownership through ternaries nested in both arms", () => {
  const analysis = analyzeFixtureFunction("chooseNestedDelivery");
  const bounded = analyzeFixtureFunction("chooseNestedDelivery", 4);
  const primary = findBlock(analysis, "check primary");
  const secondary = findBlock(analysis, "check secondary");
  const cached = findBlock(analysis, "check cached");
  const primaryValue = findBlock(analysis, "evaluate loadPrimary()");
  const secondaryValue = findBlock(analysis, "evaluate loadSecondary()");
  const cachedValue = findBlock(analysis, "evaluate loadCached()");
  const fallbackValue = findBlock(analysis, "evaluate loadFallback()");
  const terminalReturn = analysis.blocks.find((block) =>
    block.kind === "return" && block.label.includes("return primary")
  );

  assert.ok(terminalReturn);
  assertEdge(analysis, primary.id, secondary.id, "true", /choose then/u);
  assertEdge(analysis, primary.id, cached.id, "false", /choose else/u);
  assertEdge(analysis, secondary.id, primaryValue.id, "true", /choose then/u);
  assertEdge(analysis, secondary.id, secondaryValue.id, "false", /choose else/u);
  assertEdge(analysis, cached.id, cachedValue.id, "true", /choose then/u);
  assertEdge(analysis, cached.id, fallbackValue.id, "false", /choose else/u);
  for (const value of [primaryValue, secondaryValue, cachedValue, fallbackValue]) {
    assertEdge(analysis, value.id, terminalReturn.id, "next");
  }

  assert.equal(secondary.parentBlockId, primary.id);
  assert.equal(secondary.branchLabel, "then");
  assert.equal(cached.parentBlockId, primary.id);
  assert.equal(cached.branchLabel, "else");
  assert.equal(primaryValue.parentBlockId, secondary.id);
  assert.equal(primaryValue.branchLabel, "then");
  assert.equal(secondaryValue.parentBlockId, secondary.id);
  assert.equal(secondaryValue.branchLabel, "else");
  assert.equal(cachedValue.parentBlockId, cached.id);
  assert.equal(cachedValue.branchLabel, "then");
  assert.equal(fallbackValue.parentBlockId, cached.id);
  assert.equal(fallbackValue.branchLabel, "else");
  assert.equal(secondary.depth, primary.depth + 1);
  assert.equal(primaryValue.depth, secondary.depth + 1);
  assert.equal(analysis.summary.branchCount, 3);

  const layout = createFunctionLogicGraphLayout(analysis.blocks, analysis.edges);
  assert.equal(layout.nodes.length, analysis.blocks.length);
  assert.equal(layout.edges.length, analysis.edges.length);
  assert.deepEqual(bounded.blocks.map((block) => block.kind), ["entry", "return", "exit"]);
  assert.ok(bounded.gaps.some((gap) =>
    gap.code === "parseLimited" && gap.message.includes("ternary/short-circuit")
  ));
});

test("routes complex boolean operands in real short-circuit order", () => {
  const analysis = analyzeFixtureFunction("authorizeWorkspace");
  const session = findBlock(analysis, "check session");
  const owner = findBlock(analysis, "check isOwner(user)");
  const readable = findBlock(analysis, "check canRead(user)");
  const blocked = findBlock(analysis, "check !blocked");
  const allowed = findBlock(analysis, "return loadWorkspace()");
  const denied = findBlock(analysis, "return denyAccess()");

  assert.equal(session.kind, "condition");
  assert.equal(owner.parentBlockId, session.id);
  assert.equal(readable.parentBlockId, session.id);
  assert.equal(blocked.parentBlockId, session.id);
  assertEdge(analysis, session.id, owner.id, "true", /evaluate right/u);
  assertEdge(analysis, session.id, denied.id, "false", /short-circuit/u);
  assertEdge(analysis, owner.id, blocked.id, "true", /evaluate right/u);
  assertEdge(analysis, owner.id, readable.id, "false", /evaluate right/u);
  assertEdge(analysis, readable.id, blocked.id, "true");
  assertEdge(analysis, blocked.id, allowed.id, "true", /negated · truthy/u);
  assertEdge(analysis, blocked.id, denied.id, "false", /negated · falsy/u);
  assert.equal(analysis.summary.branchCount, 4);
});

test("preserves loop ownership, continue targets, and repeat targets after expansion", () => {
  const analysis = analyzeFixtureFunction("drainQueue");
  const loop = findBlock(analysis, "first step: check current");
  const ready = findBlock(analysis, "check isReady(current)");
  const retry = findBlock(analysis, "check canRetry(current)");
  const mutation = findBlock(analysis, "current = next(current)");
  const continuation = findBlock(analysis, "continue");
  const consume = findBlock(analysis, "consume(current)");

  assert.equal(loop.kind, "loop");
  assert.equal(ready.parentBlockId, loop.id);
  assert.equal(retry.parentBlockId, loop.id);
  assert.equal(mutation.parentBlockId, loop.id);
  assertEdge(analysis, loop.id, ready.id, "true");
  assertEdge(analysis, ready.id, mutation.id, "iterate", /short-circuit · iterate/u);
  assertEdge(analysis, ready.id, retry.id, "false", /evaluate right/u);
  assertEdge(analysis, retry.id, mutation.id, "iterate");
  assertEdge(analysis, continuation.id, loop.id, "continue");
  assertEdge(analysis, consume.id, loop.id, "repeat");
  assert.ok(analysis.edges.some((edge) =>
    edge.sourceId === loop.id && edge.kind === "exit"
  ));
  const layout = createFunctionLogicGraphLayout(analysis.blocks, analysis.edges);
  assert.equal(layout.nodes.length, analysis.blocks.length);
  assert.equal(layout.edges.length, analysis.edges.length);
  assert.ok(Number.isFinite(layout.width) && Number.isFinite(layout.height));
});

test("expands concise-arrow ternaries and omits an entire region at its budget", () => {
  const expanded = analyzeFixtureFunction("conciseDecision");
  const bounded = analyzeFixtureFunction("conciseDecision", 1);
  const decision = findBlock(expanded, "check ready");
  const primary = findBlock(expanded, "evaluate loadPrimary()");
  const fallback = findBlock(expanded, "evaluate loadFallback()");
  const implicitReturn = expanded.blocks.find((block) =>
    block.kind === "return" && block.label.includes("ready ?")
  );

  assert.ok(implicitReturn);
  assertEdge(expanded, decision.id, primary.id, "true");
  assertEdge(expanded, decision.id, fallback.id, "false");
  assertEdge(expanded, primary.id, implicitReturn.id, "next");
  assertEdge(expanded, fallback.id, implicitReturn.id, "next");
  assert.deepEqual(bounded.blocks.map((block) => block.kind), ["entry", "return", "exit"]);
  assert.ok(bounded.gaps.some((gap) =>
    gap.code === "parseLimited" && gap.message.includes("ternary/short-circuit")
  ));
});

test("moves branch-local writes out of the containing assignment without duplicates", () => {
  const analysis = analyzeFixtureFunction("chooseMutable");
  const left = findBlock(analysis, "evaluate left = 1");
  const right = findBlock(analysis, "evaluate right = 2");
  const assignment = findBlock(analysis, "selected = flag ?");

  assert.equal(left.kind, "mutation");
  assert.equal(right.kind, "mutation");
  assert.deepEqual(left.valueChanges?.map((change) => change.target), ["left"]);
  assert.deepEqual(right.valueChanges?.map((change) => change.target), ["right"]);
  assert.deepEqual(assignment.valueChanges?.map((change) => change.target), ["selected"]);
  assert.deepEqual(
    analysis.blocks.flatMap((block) => block.valueChanges?.map((change) => change.target) ?? []),
    ["selected", "left", "right", "left", "right", "selected"]
  );
});

test("uses the same expression CFG for JavaScript source", () => {
  const source = "function choose(flag, cached) { return flag && cached ? 'yes' : 'no'; }";
  const filePath = "/workspace/choose.js";
  const selectionRange = {
    startLine: 0,
    startCharacter: source.indexOf("choose"),
    endLine: 0,
    endCharacter: source.indexOf("choose") + "choose".length
  };
  const analysis = analyzeFunctionLogic({
    functionNode: {
      id: "function:choose-js",
      kind: "function",
      name: "choose",
      qualifiedName: "choose",
      filePath,
      range: selectionRange,
      selectionRange,
      language: "javascript"
    },
    sourceText: source
  });
  const flag = findBlock(analysis, "check flag");
  const cached = findBlock(analysis, "check cached");
  const yes = findBlock(analysis, "evaluate 'yes'");
  const no = findBlock(analysis, "evaluate 'no'");

  assert.equal(analysis.language, "javascript");
  assertEdge(analysis, flag.id, cached.id, "true");
  assertEdge(analysis, flag.id, no.id, "false");
  assertEdge(analysis, cached.id, yes.id, "true");
  assertEdge(analysis, cached.id, no.id, "false");
});

test("plans a deep right-associated ternary chain iteratively", () => {
  const decisionCount = 48;
  const flags = Array.from(
    { length: decisionCount },
    (_, index) => `flag${index}`
  );
  const expression = flags
    .map((flag, index) => `${flag} ? ${index} : `)
    .join("") + String(decisionCount);
  const source = `function chooseDeep(${flags.map((flag) =>
    `${flag}: boolean`
  ).join(", ")}): number { return ${expression}; }`;
  const filePath = "/workspace/chooseDeep.ts";
  const analysis = analyzeFunctionLogic({
    functionNode: {
      id: "function:choose-deep",
      kind: "function",
      name: "chooseDeep",
      qualifiedName: "chooseDeep",
      filePath,
      range: createInlineSelectionRange(source, "chooseDeep"),
      selectionRange: createInlineSelectionRange(source, "chooseDeep"),
      language: "typescript"
    },
    sourceText: source,
    maxBlocks: 160
  });

  assert.equal(analysis.summary.branchCount, decisionCount);
  assert.equal(Math.max(...analysis.blocks.map((block) => block.depth)), decisionCount + 1);
  assert.equal(analysis.blocks.length, (decisionCount * 2) + 4);
  assert.equal(analysis.gaps.some((gap) => gap.message.includes("were omitted")), false);
  const layout = createFunctionLogicGraphLayout(analysis.blocks, analysis.edges);
  assert.equal(layout.nodes.length, analysis.blocks.length);
  assert.ok(Number.isFinite(layout.width) && Number.isFinite(layout.height));
});

/** Runs one named fixture callable with its source-backed declaration line. */
function analyzeFixtureFunction(name: string, maxBlocks?: number): FunctionLogicAnalysis {
  const declarationOffset = Math.max(
    fixtureSource.indexOf(`function ${name}`),
    fixtureSource.indexOf(`const ${name}`)
  );
  assert.ok(declarationOffset >= 0, `missing fixture function ${name}`);
  const declarationLine = fixtureSource.slice(0, declarationOffset).split("\n").length - 1;
  return analyzeFunctionLogic({
    functionNode: createFunctionNode(name, declarationLine),
    sourceText: fixtureSource,
    maxBlocks
  });
}

/** Creates the graph identity normally supplied by project analysis. */
function createFunctionNode(name: string, line: number): SymbolNode {
  const selectionRange = {
    startLine: line,
    startCharacter: 0,
    endLine: line,
    endCharacter: name.length
  };
  return {
    id: `function:${name}`,
    kind: "function",
    name,
    qualifiedName: name,
    filePath: fixturePath,
    range: selectionRange,
    selectionRange,
    language: "typescript"
  };
}

/** Creates an exact one-line selection for generated parser stress fixtures. */
function createInlineSelectionRange(source: string, name: string) {
  const startCharacter = source.indexOf(name);
  assert.ok(startCharacter >= 0, `missing inline function ${name}`);
  return {
    startLine: 0,
    startCharacter,
    endLine: 0,
    endCharacter: startCharacter + name.length
  };
}

/** Finds one uniquely named block by a stable label fragment. */
function findBlock(analysis: FunctionLogicAnalysis, label: string) {
  const block = analysis.blocks.find((candidate) => candidate.label.includes(label));
  assert.ok(block, `missing block containing ${label}`);
  return block;
}

/** Verifies one exact source/target/kind transfer and optional semantic label. */
function assertEdge(
  analysis: FunctionLogicAnalysis,
  sourceId: string,
  targetId: string,
  kind: string,
  label?: RegExp
): void {
  const edge = analysis.edges.find((candidate) =>
    candidate.sourceId === sourceId
      && candidate.targetId === targetId
      && candidate.kind === kind
  );
  assert.ok(edge, `missing ${kind} edge ${sourceId} -> ${targetId}`);
  if (label) {
    assert.match(edge.label ?? "", label);
  }
}
