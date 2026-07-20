/**
 * JSX/TSX Function Logic regression tests. They cover custom component drill
 * targets, render-flow blocks, callback boundaries, React wrappers, and React
 * language IDs.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  analyzeFunctionLogic,
  findFunctionAtPosition,
  type FunctionLogicAnalysis
} from "../../analyzer/functionLogic";
import { TypeScriptAnalyzer } from "../../analyzer/languages/typescript";
import { createFunctionLogicDrillTargets } from "../../application/codeFlow";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import { createContentHash } from "../../shared/hash";
import type { ProjectGraph, SourceFile, SymbolNode } from "../../shared/types";
import {
  getCodeFlowBrowserSource,
  getFunctionLogicGraphStyles
} from "../../webview/codeFlow";

const projectRoot = path.resolve(__dirname, "../../..");
const fixturePath = path.join(
  projectRoot,
  "src/test/fixtures/functionLogic/jsx_component_flow.tsx"
);
const fixtureSource = fs.readFileSync(fixturePath, "utf8");

test("collects custom JSX components for drill without intrinsic or callback leakage", async () => {
  const symbols = await extractFixtureSymbols();
  const renderCard = findSymbol(symbols, "RenderCard");
  const analysis = analyzeFunctionLogic({ functionNode: renderCard, sourceText: fixtureSource });

  assert.deepEqual(analysis.callsites.map((callsite) => callsite.calleeText), [
    "formatLabel",
    "Badge",
    "UI.Panel",
    "ReadyState",
    "EmptyState"
  ]);
  assert.equal(analysis.callsites.some((callsite) =>
    ["section", "button", "strong", "span", "div"].includes(callsite.calleeText)
  ), false);
  assert.equal(analysis.callsites.some((callsite) =>
    callsite.calleeText === "trackSelection"
  ), false);
  assert.equal(analysis.summary.callCount, 1, "component render sites are not JS calls");
  assert.deepEqual(analysis.blocks.map((block) => block.kind), [
    "entry",
    "render",
    "call",
    "render",
    "render",
    "condition",
    "render",
    "render",
    "render",
    "event",
    "return",
    "exit"
  ]);
  assert.deepEqual(
    analysis.blocks.filter((block) => block.kind === "render").map((block) => block.label),
    [
      "render <section>",
      "render <Badge>",
      "render <UI.Panel>",
      "render <ReadyState>",
      "render <EmptyState>",
      "render <button>"
    ]
  );
  const renderCondition = analysis.blocks.find((block) => block.label === "render if ready");
  const eventBinding = analysis.blocks.find((block) => block.label.startsWith("bind onClick"));
  assert.ok(renderCondition && eventBinding);
  assertEdgeKindsFrom(analysis, renderCondition.id, ["true", "false"]);
  assert.match(eventBinding.detail, /only after event dispatch/u);

  const projection = createFunctionLogicDrillTargets(
    createFixtureGraph(symbols),
    renderCard,
    analysis,
    createSourceToken
  );
  assert.deepEqual(new Set(projection.callees.map((callee) => callee.name)), new Set([
    "formatLabel",
    "Badge",
    "Panel",
    "ReadyState",
    "EmptyState"
  ]));
  assert.equal(
    projection.callees.find((callee) => callee.name === "formatLabel")?.relation,
    undefined
  );
  assert.ok(projection.callees.filter((callee) => callee.name !== "formatLabel")
    .every((callee) => callee.relation === "render"));
  const returnBlock = analysis.blocks.find((block) => block.kind === "return");
  assert.ok(returnBlock);
  assert.equal(projection.targetsByBlockId.has(returnBlock.id), false);
  for (const [blockLabel, targetName] of [
    ["evaluate formatLabel(item.label)", "formatLabel"],
    ["render <Badge>", "Badge"],
    ["render <UI.Panel>", "Panel"],
    ["render <ReadyState>", "ReadyState"],
    ["render <EmptyState>", "EmptyState"]
  ] as const) {
    const block = analysis.blocks.find((candidate) => candidate.label === blockLabel);
    assert.ok(block, `missing JSX block: ${blockLabel}`);
    assert.equal(projection.targetsByBlockId.get(block.id)?.[0]?.name, targetName);
  }
});

test("models concise JSX map callbacks as inferred repeated render flow", async () => {
  const symbols = await extractFixtureSymbols();
  const cardList = findSymbol(symbols, "CardList");
  const analysis = analyzeFunctionLogic({ functionNode: cardList, sourceText: fixtureSource });
  const loop = analysis.blocks.find((block) => block.kind === "loop");
  const renderedCard = analysis.blocks.find((block) => block.label === "render <RenderCard>");

  assert.ok(loop && renderedCard);
  assert.equal(loop.label, "render each item from items");
  assert.equal(loop.confidence, "inferred");
  assertEdgeKindsFrom(analysis, loop.id, ["iterate", "exit"]);
  assertEdgeKindsFrom(analysis, renderedCard.id, ["repeat"]);
  const renderCallsite = analysis.callsites.find((callsite) =>
    callsite.calleeText === "RenderCard"
  );
  assert.ok(renderCallsite);
  assert.equal(renderCallsite.relation, "render");
  assert.equal(renderCallsite.confidence, "inferred");

  const projection = createFunctionLogicDrillTargets(
    createFixtureGraph(symbols),
    cardList,
    analysis,
    createSourceToken
  );
  const target = projection.callees.find((callee) => callee.name === "RenderCard");
  assert.ok(target);
  assert.equal(target.relation, "render");
  assert.equal(target.confidence, "inferred");
  assert.equal(projection.targetsByBlockId.get(renderedCard.id)?.[0]?.name, "RenderCard");
});

test("shares the configured block budget between statements and JSX render regions", async () => {
  const symbols = await extractFixtureSymbols();
  const renderCard = findSymbol(symbols, "RenderCard");
  const analysis = analyzeFunctionLogic({
    functionNode: renderCard,
    sourceText: fixtureSource,
    maxBlocks: 4
  });

  assert.equal(analysis.blocks.length, 6, "entry and exit stay outside the shared budget");
  assert.equal(
    analysis.blocks.filter((block) => block.kind !== "entry" && block.kind !== "exit").length,
    4
  );
  assert.ok(analysis.gaps.some((gap) =>
    gap.code === "parseLimited" && gap.message.includes("JSX render region")
  ));
});

test("renders JSX and event semantics with distinct accessible graph cues", () => {
  const browserSource = getCodeFlowBrowserSource();
  const styles = getFunctionLogicGraphStyles();

  assert.match(browserSource, /kind === "render"\) return "JSX"/u);
  assert.match(browserSource, /kind === "event"\) return "EVENT"/u);
  assert.match(browserSource, /Control & JSX render flow/u);
  assert.match(browserSource, /"rendered component"/u);
  assert.match(browserSource, /"event handler"/u);
  assert.match(browserSource, /Event handlers open as dispatch branches/u);
  assert.match(styles, /\.logic-node-render\s*\{/u);
  assert.match(styles, /\.logic-node-event\s*\{/u);
  assert.match(styles, /\.logic-edge-event\s*\{/u);
});

test("keeps inline JSX handlers independently selectable and analyzable", () => {
  const outer = analyzeAt(
    fixtureSource,
    "<button onClick",
    fixturePath,
    "typescriptreact"
  );
  const callback = analyzeAt(
    fixtureSource,
    "trackSelection(item.id)",
    fixturePath,
    "typescriptreact"
  );

  assert.equal(outer.functionNode.name, "RenderCard");
  assert.equal(outer.callsites.some((callsite) =>
    callsite.calleeText === "trackSelection"
  ), false);
  assert.equal(callback.functionNode.name, "anonymous function");
  assert.deepEqual(callback.callsites.map((callsite) => callsite.calleeText), [
    "trackSelection"
  ]);
});

test("attaches named JSX handlers as separately dispatched event targets", async () => {
  const symbols = await extractFixtureSymbols();
  const component = findSymbol(symbols, "NamedHandlerCard");
  const analysis = analyzeFunctionLogic({ functionNode: component, sourceText: fixtureSource });
  const eventBlock = analysis.blocks.find((block) => block.kind === "event");

  assert.deepEqual(analysis.callsites.map((callsite) => ({
    name: callsite.calleeText,
    relation: callsite.relation
  })), [{ name: "handleNamedClick", relation: "event" }]);
  assert.equal(analysis.summary.callCount, 0);
  assert.ok(eventBlock);
  assert.equal(eventBlock.label, "bind onClick → handleNamedClick");

  const projection = createFunctionLogicDrillTargets(
    createFixtureGraph(symbols),
    component,
    analysis,
    createSourceToken
  );
  const handler = projection.callees.find((target) => target.name === "handleNamedClick");
  assert.ok(handler);
  assert.equal(handler.relation, "event");
  assert.equal(projection.targetsByBlockId.get(eventBlock.id)?.[0]?.relation, "event");
});

test("recognizes memo and forwardRef component bindings as functions", async () => {
  const symbols = await extractFixtureSymbols();
  assert.equal(findSymbol(symbols, "MemoCard").kind, "function");
  assert.equal(findSymbol(symbols, "ForwardCard").kind, "function");

  const memo = analyzeAt(
    fixtureSource,
    "<RenderCard item",
    fixturePath,
    "typescriptreact"
  );
  const forwarded = analyzeAt(
    fixtureSource,
    "<MemoCard ref",
    fixturePath,
    "typescriptreact"
  );

  assert.equal(memo.functionNode.name, "MemoCard");
  assert.deepEqual(memo.callsites.map((callsite) => callsite.calleeText), ["RenderCard"]);
  assert.equal(forwarded.functionNode.name, "ForwardCard");
  assert.deepEqual(forwarded.callsites.map((callsite) => callsite.calleeText), ["MemoCard"]);
});

test("uses React language IDs for extensionless TypeScript and JavaScript JSX", () => {
  const typedSource = [
    "const TypedCard = (props: { label: string }) => (",
    "  <Badge label={props.label} />",
    ");"
  ].join("\n");
  const javascriptSource = [
    "const JavaScriptCard = (props) => (",
    "  <Badge label={props.label} />",
    ");"
  ].join("\n");
  const typed = analyzeAt(
    typedSource,
    "<Badge",
    "/workspace/typed-component",
    "typescriptreact"
  );
  const javascript = analyzeAt(
    javascriptSource,
    "<Badge",
    "/workspace/javascript-component",
    "javascriptreact"
  );

  assert.equal(typed.language, "typescript");
  assert.equal(javascript.language, "javascript");
  assert.deepEqual(typed.callsites.map((callsite) => callsite.calleeText), ["Badge"]);
  assert.deepEqual(javascript.callsites.map((callsite) => callsite.calleeText), ["Badge"]);
  assert.equal(typed.gaps.some((gap) => gap.code === "functionNotFound"), false);
  assert.equal(javascript.gaps.some((gap) => gap.code === "functionNotFound"), false);
});

/** Parses the fixture through the same TypeScript analyzer used by the pipeline. */
async function extractFixtureSymbols(): Promise<SymbolNode[]> {
  const analyzer = new TypeScriptAnalyzer();
  const file: SourceFile = {
    path: fixturePath,
    languageId: "typescriptreact",
    content: fixtureSource,
    sizeBytes: Buffer.byteLength(fixtureSource, "utf8"),
    contentHash: createContentHash(fixtureSource)
  };
  return analyzer.extractSymbols(await analyzer.parse(file));
}

/** Resolves the innermost callable at a marker and runs public Function Logic. */
function analyzeAt(
  sourceText: string,
  marker: string,
  filePath: string,
  languageId: "typescriptreact" | "javascriptreact"
): FunctionLogicAnalysis {
  const offset = sourceText.indexOf(marker);
  assert.notEqual(offset, -1, `missing marker: ${marker}`);
  const before = sourceText.slice(0, offset).split("\n");
  const target = findFunctionAtPosition({
    filePath,
    languageId,
    sourceText,
    position: {
      line: before.length - 1,
      character: before.at(-1)?.length ?? 0
    }
  });
  assert.ok(target, `missing callable target at ${marker}`);
  const node: SymbolNode = {
    id: `cursor:${target.qualifiedName}`,
    kind: target.kind,
    name: target.name,
    qualifiedName: target.qualifiedName,
    filePath,
    range: target.range,
    selectionRange: target.selectionRange,
    language: languageId,
    metadata: {
      cursorResolved: true,
      anonymous: target.anonymous
    }
  };
  return analyzeFunctionLogic({ functionNode: node, sourceText });
}

/** Returns one named graph symbol or fails with a focused fixture message. */
function findSymbol(symbols: SymbolNode[], name: string): SymbolNode {
  const symbol = symbols.find((candidate) => candidate.name === name);
  assert.ok(symbol, `missing ${name} fixture symbol`);
  return symbol;
}

/** Creates the smallest project graph needed for syntax-backed drill fallback. */
function createFixtureGraph(nodes: SymbolNode[]): ProjectGraph {
  return {
    workspaceRoot: projectRoot,
    version: "jsx-function-logic-fixture",
    generatedAt: "2026-07-19T00:00:00.000Z",
    nodes,
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["typescriptreact"],
      fileCount: 1,
      symbolCount: nodes.length,
      edgeCount: 0
    }
  };
}

/** Creates a deterministic opaque token for every fixture symbol. */
function createSourceToken(nodeId: string): SourceNodeToken {
  return `source-node:${nodeId}` as SourceNodeToken;
}

/** Asserts the exact outgoing relation vocabulary for one JSX logic block. */
function assertEdgeKindsFrom(
  analysis: FunctionLogicAnalysis,
  sourceId: string,
  expectedKinds: string[]
): void {
  assert.deepEqual(
    analysis.edges.filter((edge) => edge.sourceId === sourceId).map((edge) => edge.kind).sort(),
    [...expectedKinds].sort()
  );
}
