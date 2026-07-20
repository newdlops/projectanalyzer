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
  assert.match(browser, /static code text/u);
  assert.match(browser, /kind === "embedded"/u);
  assert.match(browser, /kind === "callable"/u);
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

/** Finds one expected block with a focused assertion failure. */
function requireBlock(
  blocks: readonly FunctionLogicBlock[],
  predicate: (block: FunctionLogicBlock) => boolean
): FunctionLogicBlock {
  const block = blocks.find(predicate);
  assert.ok(block, "missing expected embedded-code block");
  return block;
}
