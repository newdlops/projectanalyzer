/**
 * Direct-callee projection tests cover callsite-to-block matching, confidence,
 * display bounds, unresolved targets, and self-recursion cycle guards.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionLogicAnalysis, FunctionLogicBlock } from "../../analyzer/functionLogic";
import { createFunctionLogicDrillTargets } from "../../application/codeFlow";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import { createContentHash } from "../../shared/hash";
import type { GraphEdge, ProjectGraph, SourceRange, SymbolNode } from "../../shared/types";

test("maps concrete direct callsites to the narrowest logic blocks", () => {
  const caller = createCallable("caller", "caller", range(0, 0, 8, 1));
  const save = createCallable("save", "Repository.save", range(20, 0, 24, 1));
  const notify = createCallable("notify", "Notifier.notify", range(30, 0, 34, 1));
  const external = createCallable("external", "dynamicTarget", range(2, 2, 2, 15), "external");
  const blocks = [
    createBlock("entry", "entry", range(0, 0, 0, 18)),
    createBlock("save-call", "effect", range(2, 2, 2, 28)),
    createBlock("save-call-again", "call", range(3, 2, 3, 26)),
    createBlock("notify-call", "call", range(4, 2, 4, 25)),
    createBlock("exit", "exit", range(8, 0, 8, 1))
  ];
  const graph = createGraph(
    [caller, save, notify, external],
    [
      createCall("save-1", caller, save, range(2, 2, 2, 17), "resolved"),
      createCall("save-2", caller, save, range(3, 2, 3, 17), "exact"),
      createCall("notify-1", caller, notify, range(4, 2, 4, 17), "inferred"),
      createCall("external-1", caller, external, range(5, 2, 5, 17), "unresolved"),
      createCall("recursive", caller, caller, range(6, 2, 6, 10), "exact")
    ]
  );

  const projection = createFunctionLogicDrillTargets(
    graph,
    caller,
    createAnalysis(caller, blocks),
    createSourceToken
  );

  assert.deepEqual(projection.callees.map((target) => ({
    name: target.qualifiedName,
    confidence: target.confidence,
    count: target.callsiteCount,
    location: target.sourceLocation
  })), [
    { name: "Repository.save", confidence: "exact", count: 2, location: "src/sample.ts:21" },
    { name: "Notifier.notify", confidence: "inferred", count: 1, location: "src/sample.ts:31" }
  ]);
  assert.equal(projection.targetsByBlockId.get("save-call")?.[0]?.callsiteCount, 1);
  assert.equal(projection.targetsByBlockId.get("save-call-again")?.[0]?.callsiteCount, 1);
  assert.equal(projection.targetsByBlockId.get("notify-call")?.[0]?.qualifiedName, "Notifier.notify");
  assert.equal(projection.targetsByBlockId.has("entry"), false);
  assert.equal(projection.targetsByBlockId.has("exit"), false);
  assert.equal(projection.omittedCalleeCount, 0);
  assert.doesNotMatch(JSON.stringify(projection.callees), /\/workspace/u);
});

test("bounds unique callees without recursively traversing their calls", () => {
  const caller = createCallable("caller", "caller", range(0, 0, 40, 1));
  const callees = Array.from({ length: 27 }, (_, index) =>
    createCallable(`callee-${index}`, `callee${index}`, range(50 + index, 0, 50 + index, 8))
  );
  const edges = callees.map((callee, index) =>
    createCall(`call-${index}`, caller, callee, range(index + 1, 2, index + 1, 10), "resolved")
  );
  edges.push(createCall("child-cycle", callees[0], caller, range(50, 2, 50, 10), "resolved"));
  const graph = createGraph([caller, ...callees], edges);

  const projection = createFunctionLogicDrillTargets(
    graph,
    caller,
    createAnalysis(caller, []),
    createSourceToken,
    2
  );

  assert.deepEqual(projection.callees.map((target) => target.name), ["callee0", "callee1"]);
  assert.equal(projection.omittedCalleeCount, 25);
});

/** Creates the minimum Function Logic result required by the pure projector. */
function createAnalysis(
  caller: SymbolNode,
  blocks: FunctionLogicBlock[]
): FunctionLogicAnalysis {
  return {
    functionNode: caller,
    language: "typescript",
    signature: `function ${caller.name}()`,
    blocks,
    edges: [],
    gaps: [],
    summary: {
      blockCount: blocks.length,
      branchCount: 0,
      loopCount: 0,
      callCount: 0,
      effectCount: 0,
      mutationCount: 0,
      exitCount: 0
    }
  };
}

/** Creates one syntax block using the shared source fixture. */
function createBlock(
  id: string,
  kind: FunctionLogicBlock["kind"],
  sourceRange: SourceRange
): FunctionLogicBlock {
  return {
    id,
    kind,
    label: id,
    detail: id,
    depth: 0,
    confidence: "exact",
    filePath: "/workspace/src/sample.ts",
    range: sourceRange
  };
}

/** Creates one callable or external graph node. */
function createCallable(
  id: string,
  qualifiedName: string,
  sourceRange: SourceRange,
  kind: SymbolNode["kind"] = "function"
): SymbolNode {
  return {
    id,
    kind,
    name: qualifiedName.split(".").at(-1) ?? qualifiedName,
    qualifiedName,
    filePath: "/workspace/src/sample.ts",
    range: sourceRange,
    selectionRange: sourceRange,
    language: "typescript"
  };
}

/** Creates one source-positioned call relation. */
function createCall(
  id: string,
  caller: SymbolNode,
  callee: SymbolNode,
  sourceRange: SourceRange,
  confidence: GraphEdge["confidence"]
): GraphEdge {
  return {
    id,
    kind: "calls",
    sourceId: caller.id,
    targetId: callee.id,
    filePath: caller.filePath,
    range: sourceRange,
    confidence
  };
}

/** Creates a complete graph shell for projection tests. */
function createGraph(nodes: SymbolNode[], edges: GraphEdge[]): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "1",
    generatedAt: "2026-07-19T00:00:00.000Z",
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

/** Creates a deterministic protocol-shaped token without leaking the node ID. */
function createSourceToken(nodeId: string): SourceNodeToken {
  return `source-node:${createContentHash(nodeId)}` as SourceNodeToken;
}

/** Short source-range fixture helper. */
function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number
): SourceRange {
  return { startLine, startCharacter, endLine, endCharacter };
}
