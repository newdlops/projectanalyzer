/**
 * Event-boundary Function Logic tests. They verify imperative listener syntax,
 * property handlers, call counts, and separately dispatched drill targets.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { TypeScriptAnalyzer } from "../../analyzer/languages/typescript";
import { createFunctionLogicDrillTargets } from "../../application/codeFlow";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import { createContentHash } from "../../shared/hash";
import type { GraphEdge, ProjectGraph, SourceFile, SymbolNode } from "../../shared/types";

const projectRoot = path.resolve(__dirname, "../../..");
const fixturePath = path.join(
  projectRoot,
  "src/test/fixtures/functionLogic/event_handler_flow.ts"
);
const fixtureSource = fs.readFileSync(fixturePath, "utf8");

test("models listener registrations as event boundaries instead of direct handler calls", async () => {
  const symbols = await extractFixtureSymbols();
  const setup = findSymbol(symbols, "setupEventHandlers");
  const analysis = analyzeFunctionLogic({ functionNode: setup, sourceText: fixtureSource });

  assert.deepEqual(analysis.callsites.map((callsite) => ({
    name: callsite.calleeText,
    relation: callsite.relation,
    confidence: callsite.confidence ?? "exact"
  })), [
    { name: "handleClick", relation: "event", confidence: "exact" },
    { name: "handleData", relation: "event", confidence: "inferred" },
    { name: "handleClose", relation: "event", confidence: "inferred" },
    { name: "handleNotification", relation: "event", confidence: "inferred" },
    { name: "handleMessage", relation: "event", confidence: "inferred" },
    { name: "afterSetup", relation: "call", confidence: "exact" }
  ]);
  assert.equal(analysis.callsites.some((callsite) =>
    ["addEventListener", "on", "once", "subscribe"].includes(callsite.calleeName)
  ), false);
  assert.equal(analysis.summary.callCount, 1);

  const visible = analysis.blocks.filter((block) =>
    block.kind !== "entry" && block.kind !== "exit"
  );
  assert.deepEqual(visible.map((block) => block.kind), [
    "event", "event", "event", "event", "event", "call"
  ]);
  assert.deepEqual(visible.slice(0, 5).map((block) => block.label), [
    "bind click → handleClick",
    "bind data → handleData",
    "bind close → handleClose",
    "bind subscription notification → handleNotification",
    "bind onmessage → handleMessage"
  ]);
  assert.ok(visible.slice(0, 5).every((block) =>
    block.detail.includes("does not return into this function's control path")
  ));
});

test("projects named handlers onto their event blocks with an event relation", async () => {
  const symbols = await extractFixtureSymbols();
  const setup = findSymbol(symbols, "setupEventHandlers");
  const analysis = analyzeFunctionLogic({ functionNode: setup, sourceText: fixtureSource });
  const firstBinding = analysis.callsites.find((callsite) =>
    callsite.calleeName === "handleClick"
  );
  assert.ok(firstBinding);
  const registrationMethod: SymbolNode = {
    ...setup,
    id: "fixture:add-event-listener-method",
    kind: "method",
    name: "addEventListener",
    qualifiedName: "EventTargetLike.addEventListener"
  };
  const registrationEdge: GraphEdge = {
    id: "fixture:add-event-listener-call",
    kind: "calls",
    sourceId: setup.id,
    targetId: registrationMethod.id,
    filePath: setup.filePath,
    range: firstBinding.range,
    confidence: "resolved"
  };
  const projection = createFunctionLogicDrillTargets(
    createFixtureGraph([...symbols, registrationMethod], [registrationEdge]),
    setup,
    analysis,
    createSourceToken
  );

  const handlerNames = new Set([
    "handleClick",
    "handleData",
    "handleClose",
    "handleNotification",
    "handleMessage"
  ]);
  const handlers = projection.callees.filter((target) => handlerNames.has(target.name));
  assert.equal(handlers.length, handlerNames.size);
  assert.ok(handlers.every((target) => target.relation === "event"));
  assert.equal(projection.callees.some((target) =>
    target.name === "addEventListener"
  ), false);
  assert.equal(
    projection.callees.find((target) => target.name === "afterSetup")?.relation,
    undefined
  );

  for (const block of analysis.blocks.filter((candidate) => candidate.kind === "event")) {
    const targets = projection.targetsByBlockId.get(block.id) ?? [];
    assert.equal(targets.length, 1, `missing handler target for ${block.label}`);
    assert.equal(targets[0].relation, "event");
  }
});

/** Parses the fixture with the production TypeScript symbol adapter. */
async function extractFixtureSymbols(): Promise<SymbolNode[]> {
  const analyzer = new TypeScriptAnalyzer();
  const file: SourceFile = {
    path: fixturePath,
    languageId: "typescript",
    content: fixtureSource,
    sizeBytes: Buffer.byteLength(fixtureSource, "utf8"),
    contentHash: createContentHash(fixtureSource)
  };
  return analyzer.extractSymbols(await analyzer.parse(file));
}

/** Finds one named fixture function with a focused assertion failure. */
function findSymbol(symbols: SymbolNode[], name: string): SymbolNode {
  const symbol = symbols.find((candidate) => candidate.name === name);
  assert.ok(symbol, `missing ${name} fixture symbol`);
  return symbol;
}

/** Creates the bounded graph used by syntax-backed handler resolution. */
function createFixtureGraph(nodes: SymbolNode[], edges: GraphEdge[] = []): ProjectGraph {
  return {
    workspaceRoot: projectRoot,
    version: "event-handler-function-logic-fixture",
    generatedAt: "2026-07-20T00:00:00.000Z",
    nodes,
    edges,
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: 1,
      symbolCount: nodes.length,
      edgeCount: edges.length
    }
  };
}

/** Creates a deterministic opaque source token for a resolved handler. */
function createSourceToken(nodeId: string): SourceNodeToken {
  return `source-node:${nodeId}` as SourceNodeToken;
}
