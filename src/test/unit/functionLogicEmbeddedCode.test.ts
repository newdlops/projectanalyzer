/**
 * Embedded-code Function Logic tests prove literal-only discovery, multiple
 * callable scopes, execution timing, bounded parsing, data flow, and UI kinds.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import type { FunctionLogicBlock } from "../../analyzer/functionLogic";
import type { SymbolNode } from "../../shared/types";
import { getFunctionLogicGraphStyles } from "../../webview/codeFlow";
import { getFunctionLogicBrowserSource } from "../../webview/codeFlow/functionLogicBrowserSource";

const projectRoot = path.resolve(__dirname, "../../..");
const fixturePath = path.join(
  projectRoot,
  "src/test/fixtures/functionLogic/embedded_code_programs.ts"
);
const fixtureSource = fs.readFileSync(fixturePath, "utf8");

test("parses stored text as a program with multiple isolated callable bodies", () => {
  const analysis = analyzeFixture();
  const storedBoundary = requireBlock(analysis.blocks, (block) =>
    block.kind === "embedded" && block.label.includes("stored code text")
  );
  const callableLabels = analysis.blocks
    .filter((block) => block.kind === "callable")
    .map((block) => block.label);

  for (const name of ["normalize", "clamp", "choose", "run", "stop", "nested", "tagged"]) {
    assert.ok(
      callableLabels.some((label) => label.includes(name)),
      `missing embedded callable ${name}`
    );
  }
  assert.match(storedBoundary.label, /5 functions/u);
  assert.ok(analysis.edges.some((edge) =>
    edge.kind === "defines" && edge.targetId === storedBoundary.id
  ));
  for (const callable of analysis.blocks.filter((block) => block.kind === "callable")) {
    assert.ok(analysis.edges.some((edge) =>
      edge.sourceId === callable.id && edge.kind === "defines"
    ), `missing non-invoked body edge for ${callable.label}`);
  }
  assert.ok(analysis.blocks.some((block) =>
    block.kind === "condition" && block.label.includes("current > 10")
  ));
  assert.ok(analysis.blocks.some((block) =>
    block.kind === "condition" && block.label.includes("check value")
  ));
  assert.ok(analysis.blocks.some((block) =>
    block.kind === "condition" && block.label.includes("value > 0")
  ));
});

test("separates immediate, deferred, generated, tagged, ordinary, and dynamic text", () => {
  const analysis = analyzeFixture();
  const boundaries = analysis.blocks.filter((block) => block.kind === "embedded");
  const immediate = requireBlock(boundaries, (block) => block.label.includes("execute code text · eval"));
  const deferred = requireBlock(boundaries, (block) => block.label.includes("schedule code text"));
  const generated = requireBlock(boundaries, (block) => block.label.includes("create callable from"));
  const tagged = requireBlock(boundaries, (block) => block.label.includes("code-tagged text"));
  const immediateExit = requireBlock(analysis.blocks, (block) =>
    block.kind === "exit"
      && block.parentBlockId === immediate.id
      && block.label === "End embedded program"
  );

  assert.equal(boundaries.length, 5, "ordinary and runtime-built strings stay excluded");
  assert.ok(analysis.edges.some((edge) =>
    edge.sourceId === immediateExit.id
      && edge.kind === "next"
      && edge.label === "resume host flow"
  ));
  assert.ok(analysis.edges.some((edge) =>
    edge.targetId === deferred.id && edge.kind === "deferred"
  ));
  assert.ok(analysis.edges.some((edge) =>
    edge.targetId === generated.id && edge.kind === "defines"
  ));
  assert.ok(analysis.edges.some((edge) =>
    edge.targetId === tagged.id && edge.kind === "defines"
  ));
  assert.ok(analysis.gaps.some((gap) =>
    gap.code === "dynamicBehavior" && gap.message.includes("runtime-built text")
  ));
  assert.equal(analysis.blocks.some((block) => block.label.includes("hello")
    && block.kind === "embedded"), false);
});

test("retains embedded lexical values, callsites, host evidence, and nested ternaries", () => {
  const analysis = analyzeFixture();
  const bindingNames = new Set(analysis.valueBindings?.map((binding) => binding.name));
  const callsiteNames = new Set(analysis.callsites.map((callsite) => callsite.calleeName));
  const embeddedBlocks = analysis.blocks.filter((block) =>
    block.kind === "embedded" || block.detail.includes("Embedded text line")
  );

  for (const name of ["value", "current", "total", "delta", "reason"]) {
    assert.ok(bindingNames.has(name), `missing embedded binding ${name}`);
  }
  for (const name of ["clamp", "normalize", "fallback", "audit", "notify", "nested"]) {
    assert.ok(callsiteNames.has(name), `missing embedded callsite ${name}`);
  }
  assert.ok(analysis.valueFlows?.some((flow) =>
    analysis.valueBindings?.find((binding) => binding.id === flow.bindingId)?.name === "current"
  ));
  assert.ok(embeddedBlocks.length > 20);
  assert.ok(embeddedBlocks.every((block) => block.filePath === fixturePath));
  assert.ok(embeddedBlocks.every((block) =>
    block.range.startLine >= 0 && block.range.endLine < fixtureSource.split("\n").length
  ));
});

test("joins literal-only concatenation and rejects interpolated code text", () => {
  const sourceText = [
    "function concatenate(dynamicValue: number) {",
    "  eval(\"let value = 1;\" + \"value += 2;\");",
    "  eval(`notify(${dynamicValue});`);",
    "}"
  ].join("\n");
  const selectionRange = {
    startLine: 0,
    startCharacter: 9,
    endLine: 0,
    endCharacter: 20
  };
  const analysis = analyzeFunctionLogic({
    functionNode: {
      id: "fixture:function:concatenate",
      kind: "function",
      name: "concatenate",
      qualifiedName: "concatenate",
      filePath: "/workspace/embedded-concatenation.ts",
      range: selectionRange,
      selectionRange,
      language: "typescript"
    },
    sourceText
  });

  assert.equal(analysis.blocks.filter((block) => block.kind === "embedded").length, 1);
  assert.ok(analysis.blocks.some((block) => block.label.includes("let value = 1")));
  assert.ok(analysis.blocks.some((block) => block.label.includes("value += 2")));
  assert.ok(analysis.gaps.some((gap) =>
    gap.code === "dynamicBehavior" && gap.message.includes("1 code-consuming call")
  ));
});

test("resolves const eval text and bridges direct-eval reads and writes to host bindings", () => {
  const sourceText = [
    "function evaluateInline(input: number) {",
    "  let total = input;",
    "  const code = \"total += 2; if (total > 5) audit(total);\";",
    "  eval(code);",
    "  return total;",
    "}"
  ].join("\n");
  const analysis = analyzeSource("evaluateInline", sourceText);
  const totalBinding = analysis.valueBindings?.find((binding) => binding.name === "total");
  assert.ok(totalBinding, "host total binding is retained");
  assert.equal(analysis.blocks.filter((block) => block.kind === "embedded").length, 1);
  const embeddedAccesses = analysis.blocks.flatMap((block) => block.detail.includes("Embedded text line")
    ? block.valueAccesses ?? []
    : []);
  assert.ok(embeddedAccesses.some((access) =>
    access.bindingId === totalBinding.id && access.access === "readwrite"
  ));
  assert.ok(analysis.valueFlows?.some((flow) =>
    flow.bindingId === totalBinding.id
      && analysis.blocks.find((block) => block.id === flow.targetBlockId)?.detail.includes("Embedded text line")
  ));
  assert.equal(analysis.gaps.some((gap) => gap.message.includes("runtime-built text")), false);
});

test("does not treat a shadowed eval parameter as an embedded-code consumer", () => {
  const sourceText = [
    "function shadowed(eval: (code: string) => void) {",
    "  eval(\"audit('not global eval')\");",
    "}"
  ].join("\n");
  const analysis = analyzeSource("shadowed", sourceText);
  assert.equal(analysis.blocks.some((block) => block.kind === "embedded"), false);
  assert.equal(analysis.gaps.some((gap) => gap.message.includes("runtime-built text")), false);
});

test("keeps global eval immediate but does not bridge caller lexical bindings", () => {
  const sourceText = [
    "function globalScope() {",
    "  let total = 0;",
    "  globalThis.eval(\"total += 1;\");",
    "  return total;",
    "}"
  ].join("\n");
  const analysis = analyzeSource("globalScope", sourceText);
  const totalBinding = analysis.valueBindings?.find((binding) => binding.name === "total");
  assert.ok(totalBinding);
  const embeddedBlocks = analysis.blocks.filter((block) => block.detail.includes("Embedded text line"));
  assert.ok(embeddedBlocks.length > 0);
  assert.equal(embeddedBlocks.some((block) => block.valueAccesses?.some((access) =>
    access.bindingId === totalBinding.id
  )), false);
});

test("splices an eval nested in short-circuit syntax onto the true expression branch", () => {
  const analysis = analyzeSource("branchEval", [
    "function branchEval(flag: boolean) {",
    "  flag && eval(\"audit();\");",
    "  after();",
    "}"
  ].join("\n"));
  const condition = requireBlock(analysis.blocks, (block) => block.label === "check flag");
  const boundary = requireBlock(analysis.blocks, (block) => block.kind === "embedded");
  assert.ok(analysis.edges.some((edge) =>
    edge.sourceId === condition.id && edge.targetId === boundary.id && edge.kind === "true"
  ));
  assert.equal(analysis.edges.some((edge) =>
    edge.sourceId === condition.id && edge.targetId === boundary.id && edge.kind === "false"
  ), false);
});

test("gives plain eval text nodes their own host evidence ranges for editor highlighting", () => {
  const analysis = analyzeSource("literalEvidence", [
    "function literalEvidence() {",
    "  eval(\"let total = 1; audit(total);\");",
    "}"
  ].join("\n"));
  const boundary = requireBlock(analysis.blocks, (block) => block.kind === "embedded");
  const declaration = requireBlock(analysis.blocks, (block) => block.label === "let total = 1;");
  const audit = requireBlock(analysis.blocks, (block) => block.label === "audit(total);");
  assert.ok(declaration.range.startCharacter > boundary.range.startCharacter);
  assert.ok(audit.range.startCharacter > declaration.range.endCharacter);
  assert.ok(audit.range.endCharacter < boundary.range.endCharacter);
});

test("rejects invalid top-level eval control syntax before planning an inner CFG", () => {
  const analysis = analyzeSource("invalidEval", [
    "function invalidEval() {",
    "  eval(\"return 1;\");",
    "  after();",
    "}"
  ].join("\n"));
  assert.ok(analysis.gaps.some((gap) => gap.code === "parseLimited"
    && gap.message.includes("embedded-code parser diagnostic")));
  assert.equal(analysis.blocks.some((block) => block.label === "return 1"), false);
});

test("bounds embedded regions and exposes distinct graph semantics", () => {
  const bounded = analyzeFixture(8);
  const styles = getFunctionLogicGraphStyles();
  const browser = getFunctionLogicBrowserSource();

  assert.ok(bounded.gaps.some((gap) =>
    gap.code === "parseLimited" && gap.message.includes("embedded")
  ));
  assert.ok(bounded.blocks.length <= 10, "entry/exit remain outside the shared block budget");
  assert.match(styles, /\.logic-node-embedded\s*\{/u);
  assert.match(styles, /\.logic-node-callable\s*\{/u);
  assert.match(styles, /\.logic-edge-defines/u);
  assert.match(styles, /\.logic-edge-deferred/u);
  assert.match(browser, /embeddedPresentationKind === "directEval"/u);
  assert.doesNotMatch(browser, /label\.startsWith/u);
  assert.match(browser, /describeEmbeddedBoundaryTiming/u);
  assert.match(browser, /focus-embedded/u);
  assert.match(browser, /const key = "logic-" \+ String\(kind \|\| "unknown"\)/u);
  assert.match(browser, /projectAnalyzerText\(key\)/u);
});

/** Runs the public analyzer against the source-backed fixture callable. */
function analyzeFixture(maxBlocks = 180): ReturnType<typeof analyzeFunctionLogic> {
  const declarationOffset = fixtureSource.indexOf("function loadEmbeddedPrograms");
  assert.ok(declarationOffset >= 0);
  const declarationLine = fixtureSource.slice(0, declarationOffset).split("\n").length - 1;
  const declarationCharacter = fixtureSource.split("\n")[declarationLine]
    .indexOf("loadEmbeddedPrograms");
  return analyzeFunctionLogic({
    functionNode: createFunctionNode(declarationLine, declarationCharacter),
    sourceText: fixtureSource,
    maxBlocks
  });
}

/** Creates the exact source identity supplied by the workspace graph. */
function createFunctionNode(line: number, character: number): SymbolNode {
  const selectionRange = {
    startLine: line,
    startCharacter: character,
    endLine: line,
    endCharacter: character + "loadEmbeddedPrograms".length
  };
  return {
    id: "fixture:function:loadEmbeddedPrograms",
    kind: "function",
    name: "loadEmbeddedPrograms",
    qualifiedName: "loadEmbeddedPrograms",
    filePath: fixturePath,
    range: selectionRange,
    selectionRange,
    language: "typescript"
  };
}

/** Analyzes a compact standalone fixture while preserving real selection evidence. */
function analyzeSource(name: string, sourceText: string): ReturnType<typeof analyzeFunctionLogic> {
  const declarationCharacter = sourceText.split("\n")[0].indexOf(name);
  const selectionRange = {
    startLine: 0,
    startCharacter: declarationCharacter,
    endLine: 0,
    endCharacter: declarationCharacter + name.length
  };
  return analyzeFunctionLogic({
    functionNode: {
      id: `fixture:function:${name}`,
      kind: "function",
      name,
      qualifiedName: name,
      filePath: `/workspace/${name}.ts`,
      range: selectionRange,
      selectionRange,
      language: "typescript"
    },
    sourceText
  });
}

/** Finds one expected block with a focused assertion failure. */
function requireBlock(
  blocks: readonly FunctionLogicBlock[],
  predicate: (block: FunctionLogicBlock) => boolean
): FunctionLogicBlock {
  const block = blocks.find(predicate);
  assert.ok(block, "missing expected embedded-code block");
  return block;
}
