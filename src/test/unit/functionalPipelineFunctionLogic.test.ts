/**
 * True functional-language pipeline regressions. F#, OCaml, and Elixir must
 * preserve pipe order, argument insertion semantics, graph targets, and drill.
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
import { FunctionalLanguageAnalyzer } from "../../analyzer/languages/functional";
import { createFunctionLogicDrillTargets } from "../../application/codeFlow";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import { createContentHash } from "../../shared/hash";
import type { ProjectGraph, SourceFile, SymbolNode } from "../../shared/types";

const projectRoot = path.resolve(__dirname, "../../..");
const fixtureRoot = path.join(
  projectRoot,
  "src/test/fixtures/functionLogic/functional"
);

type PipelineFixture = {
  fileName: string;
  language: "fsharp" | "ocaml" | "elixir";
  callerQualifiedName: string;
  stageNames: string[];
  stageTexts: string[];
  targetQualifiedNames: string[];
  insertion: "first" | "final";
};

const fixtures: readonly PipelineFixture[] = [{
  fileName: "functional_pipeline.fs",
  language: "fsharp",
  callerQualifiedName: "BillingPipeline.runFunctionalChain",
  stageNames: ["keepBillable", "normalizeAll", "expandAll", "auditAll", "summarize"],
  stageTexts: ["keepBillable", "normalizeAll", "expandAll", "auditAll audit", "summarize"],
  targetQualifiedNames: [
    "BillingPipeline.keepBillable",
    "BillingPipeline.normalizeAll",
    "BillingPipeline.expandAll",
    "BillingPipeline.auditAll",
    "BillingPipeline.summarize"
  ],
  insertion: "final"
}, {
  fileName: "functional_pipeline.ml",
  language: "ocaml",
  callerQualifiedName: "run_functional_chain",
  stageNames: ["keep_billable", "normalize_all", "expand_all", "summarize"],
  stageTexts: ["keep_billable", "normalize_all", "expand_all", "summarize"],
  targetQualifiedNames: ["keep_billable", "normalize_all", "expand_all", "summarize"],
  insertion: "final"
}, {
  fileName: "functional_pipeline.ex",
  language: "elixir",
  callerQualifiedName: "BillingPipeline.run_functional_chain",
  stageNames: ["keep_billable", "normalize_all", "expand_all", "audit_all", "summarize"],
  stageTexts: [
    "keep_billable()",
    "normalize_all()",
    "expand_all()",
    "audit_all(audit)",
    "summarize()"
  ],
  targetQualifiedNames: [
    "BillingPipeline.keep_billable",
    "BillingPipeline.normalize_all",
    "BillingPipeline.expand_all",
    "BillingPipeline.audit_all",
    "BillingPipeline.summarize"
  ],
  insertion: "first"
}];

for (const fixture of fixtures) {
  test(`${fixture.language} pipe stages retain order, semantics, and drill targets`, async () => {
    const loaded = await loadFixture(fixture);
    const stageBlocks = loaded.analysis.blocks.filter((block) =>
      block.label.startsWith("pipe → ")
    );

    assert.equal(loaded.analysis.language, fixture.language);
    assert.deepEqual(
      loaded.analysis.callsites.map((callsite) => ({
        name: callsite.calleeName,
        chain: callsite.callChain
      })),
      fixture.stageNames.map((name) => ({ name, chain: "pipeline" }))
    );
    assert.deepEqual(
      stageBlocks.map((block) => block.label),
      fixture.stageTexts.map((stage) => `pipe → ${stage} · previous result`)
    );
    assert.ok(stageBlocks.every((block) =>
      block.detail === `Passes the previous result as this stage's ${fixture.insertion} argument.`
    ));
    assert.deepEqual(
      loaded.graph.edges
        .filter((edge) => edge.kind === "calls" && edge.sourceId === loaded.caller.id)
        .map((edge) => loaded.graph.nodes.find((node) => node.id === edge.targetId)?.qualifiedName),
      fixture.targetQualifiedNames
    );
    assert.deepEqual(
      stageBlocks.map((block) =>
        loaded.projection.targetsByBlockId.get(block.id)?.[0]?.qualifiedName
      ),
      fixture.targetQualifiedNames
    );
    assert.doesNotMatch(
      JSON.stringify({ blocks: loaded.analysis.blocks, callsites: loaded.analysis.callsites }),
      /not \|>|ignoredMarker|ignored_marker/u
    );

    const finalStageOffset = loaded.source.lastIndexOf(`|> ${fixture.stageTexts.at(-1)}`);
    assert.ok(finalStageOffset >= 0);
    const position = offsetPosition(loaded.source, finalStageOffset);
    const selected = findFunctionAtPosition({
      filePath: loaded.file.path,
      languageId: fixture.language,
      sourceText: loaded.source,
      position
    });
    assert.equal(selected?.qualifiedName, fixture.callerQualifiedName);
  });
}

test("separates independent F# pipelines and ignores pipe text in strings", async () => {
  const source = [
    "let normalize value = value",
    "let expand value = value",
    "let runTwoPipelines first second =",
    "    let marker = \"not |> fakeStage\"",
    "    let firstResult = first |> normalize",
    "    let secondResult = second |> expand",
    "    firstResult, secondResult"
  ].join("\n");
  const file: SourceFile = {
    path: "/workspace/src/two_pipelines.fs",
    languageId: "fsharp",
    content: source,
    sizeBytes: Buffer.byteLength(source, "utf8"),
    contentHash: createContentHash(source)
  };
  const analyzer = new FunctionalLanguageAnalyzer();
  const parsed = await analyzer.parse(file);
  const nodes = await analyzer.extractSymbols(parsed);
  const caller = nodes.find((node) => node.qualifiedName === "runTwoPipelines");
  assert.ok(caller);
  const analysis = analyzeFunctionLogic({ functionNode: caller, sourceText: source });

  assert.deepEqual(
    analysis.blocks
      .filter((block) => block.label.startsWith("pipeline input · "))
      .map((block) => block.label),
    ["pipeline input · first", "pipeline input · second"]
  );
  assert.deepEqual(
    analysis.callsites.map((callsite) => callsite.calleeName),
    ["normalize", "expand"]
  );
  assert.doesNotMatch(JSON.stringify(analysis), /fakeStage/u);
});

/** Loads one real fixture through graph, Function Logic, and drill projection. */
async function loadFixture(fixture: PipelineFixture): Promise<{
  source: string;
  file: SourceFile;
  caller: SymbolNode;
  graph: ProjectGraph;
  analysis: FunctionLogicAnalysis;
  projection: ReturnType<typeof createFunctionLogicDrillTargets>;
}> {
  const fixturePath = path.join(fixtureRoot, fixture.fileName);
  const source = fs.readFileSync(fixturePath, "utf8");
  const file: SourceFile = {
    path: `/workspace/src/${fixture.fileName}`,
    languageId: fixture.language,
    content: source,
    sizeBytes: Buffer.byteLength(source, "utf8"),
    contentHash: createContentHash(source)
  };
  const analyzer = new FunctionalLanguageAnalyzer();
  const parsed = await analyzer.parse(file);
  const nodes = await analyzer.extractSymbols(parsed);
  const edges = await analyzer.extractEdges(parsed, {
    sourceFiles: [file],
    workspaceRoot: "/workspace"
  });
  const caller = nodes.find((node) => node.qualifiedName === fixture.callerQualifiedName);
  assert.ok(caller, `missing ${fixture.callerQualifiedName}`);
  const graph = createGraph(nodes, edges, fixture.language);
  const analysis = analyzeFunctionLogic({ functionNode: caller, sourceText: source });
  const projection = createFunctionLogicDrillTargets(
    graph,
    caller,
    analysis,
    createSourceToken
  );
  return { source, file, caller, graph, analysis, projection };
}

/** Creates a complete graph shell around one language adapter result. */
function createGraph(
  nodes: ProjectGraph["nodes"],
  edges: ProjectGraph["edges"],
  language: string
): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "functional-pipeline-test",
    generatedAt: "2026-07-20T00:00:00.000Z",
    nodes,
    edges,
    diagnostics: [],
    metadata: {
      languages: [language],
      fileCount: 1,
      symbolCount: nodes.length,
      edgeCount: edges.length
    }
  };
}

/** Creates an opaque deterministic token for pure drill projection tests. */
function createSourceToken(nodeId: string): SourceNodeToken {
  return `source-node:${createContentHash(nodeId)}` as SourceNodeToken;
}

/** Converts one fixture offset into the editor's zero-based position. */
function offsetPosition(source: string, offset: number): { line: number; character: number } {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return {
    line: lines.length - 1,
    character: lines.at(-1)?.length ?? 0
  };
}
