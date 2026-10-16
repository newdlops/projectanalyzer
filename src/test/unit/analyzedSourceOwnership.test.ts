/** Actual scalar ownership, native graph bindings and lazy manifest regression tests. */
import assert from "node:assert/strict";
import test from "node:test";
import { snapshotSourceFiles, createAnalyzedSourceSnapshot } from "../../shared/sourceSnapshots";
import { createContentHash } from "../../shared/hash";
import { bindAnalyzedSourceFiles } from "../../graph/sourceBindings";
import { createEmptyProjectGraph } from "../../graph/emptyGraph";
import { createWorkspaceSourceManifestInput } from "../../analyzer/rust/workspaceSourceManifest";
import { AnalyzerPipeline } from "../../analyzer/core/analyzerPipeline";
import type { LanguageAnalyzer } from "../../analyzer/core/languageAnalyzer";
import type { SourceFile, SymbolNode } from "../../shared/types";
import { withNarrativeWorkspace, rootText } from "../helpers/narrativeSourceWorkspace";

/** Deliberately incorrect caller metadata must not become source authority. */
function source(): SourceFile { return { path: "/workspace/a.ts", languageId: "typescript", content: "export const a = '😀';\r\n", sizeBytes: 0, contentHash: "untrusted" }; }

test("input ownership preserves original strings and computes actual hashes once", () => {
  const input = source(), snapshot = createAnalyzedSourceSnapshot([input]), original = input.content;
  input.content = "changed"; input.path = "/changed.ts";
  assert.equal(snapshot.files[0].content, original); assert.equal(snapshot.files[0].path, "/workspace/a.ts");
  assert.equal(snapshot.bindings[0].contentHash, createContentHash(original));
  assert.equal(snapshot.bindings[0].sizeBytes, Buffer.byteLength(original));
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.files) && Object.isFrozen(snapshot.files[0]) && Object.isFrozen(snapshot.bindings[0]));
  assert.throws(() => snapshotSourceFiles([source(), source()]), /Duplicate/u);
});

test("lazy Rust manifest remains byte-for-byte stable after caller record mutation", () => {
  const input = source(), manifest = createWorkspaceSourceManifestInput([input]);
  const first = Buffer.concat([...manifest.chunks]);
  input.content = "a different program"; input.path = "/different.ts"; input.languageId = "python";
  const second = Buffer.concat([...manifest.chunks]);
  assert.deepEqual(second, first); assert.equal(second.byteLength, manifest.byteLength);
});

test("native file bindings preserve graph identities and reject conflicting supplemental bytes", () => {
  const graph = createEmptyProjectGraph("/workspace"), range = { startLine: 0, startCharacter: 0, endLine: 1, endCharacter: 0 };
  const node: SymbolNode = { id: "file:a", kind: "file", name: "a.ts", qualifiedName: "a.ts", filePath: "/workspace/a.ts", language: "typescript", range, selectionRange: range, metadata: { native: true } };
  graph.nodes.push(node);
  const { bindings } = createAnalyzedSourceSnapshot([source()]), bound = bindAnalyzedSourceFiles(graph, bindings);
  assert.equal(bound.nodes[0].id, node.id); assert.deepEqual(bound.nodes[0].range, range); assert.strictEqual(bound.edges, graph.edges);
  assert.equal(bound.nodes[0].metadata!.contentHash, bindings[0].contentHash); assert.equal(bound.nodes[0].metadata!.native, true);
  assert.equal(graph.nodes[0].metadata!.contentHash, undefined);
  graph.nodes[0].metadata!.contentHash = "0".repeat(64);
  assert.throws(() => bindAnalyzedSourceFiles(graph, bindings), /differs/u);
});

test("in-process analyzer awaits retain the exact acquired source and file binding", async () => {
  let resume!: () => void, observed: SourceFile | undefined;
  const gate = new Promise<void>((resolve) => { resume = resolve; }), input = source(), original = input.content;
  const analyzer: LanguageAnalyzer = { languageId: "typescript", extensions: [".ts"],
    async parse(file) { observed = file; await gate; return { file, ast: undefined }; },
    async extractSymbols() { return []; }, async extractEdges() { return []; } };
  const pipeline = new AnalyzerPipeline({ getWorkspaceRoot: () => "/workspace", findSourceFiles: async () => [input] }, [analyzer]);
  const pending = pipeline.analyzeFiles([input]); input.content = "changed while parser awaited"; resume();
  const { graph } = await pending;
  assert.equal(observed!.content, original); assert.ok(Object.isFrozen(observed));
  assert.equal(graph.nodes[0].metadata!.contentHash, createContentHash(original));
});

test("actual Rust and Kotlin supplemental graph bind the source acquired before native start", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const file = workspace.graph.nodes.find((node) => node.kind === "file" && node.filePath === workspace.rootPath)!;
    assert.equal(file.metadata!.contentHash, createContentHash(rootText));
    const lease = await workspace.capture();
    try { assert.ok(lease.capture.declarations.find((row) => row.name === "root")!.text.includes('"😀 / 219"')); }
    finally { lease.dispose(); }
  }, (files) => { files[0].content = "caller mutation after lazy manifest creation"; files[0].contentHash = "wrong"; });
});
