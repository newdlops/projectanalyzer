/** Real temporary files and an actual Rust/supplemental workspace graph for source tests. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AnalyzerPipeline } from "../../analyzer/core/analyzerPipeline";
import { TypeScriptAnalyzer } from "../../analyzer/languages/typescript";
import { KotlinAnalyzer } from "../../analyzer/languages/kotlin";
import { RustAnalyzerBackend } from "../../analyzer/rust/rustAnalyzerBackend";
import { InMemoryGraphStore } from "../../graph/graphStore";
import { createWorkspaceSourceGraph, captureNarrativeSources } from "../../application/narrativeSources";
import { VsCodeNarrativeSourceReader } from "../../vscode/narrativeSources";
import { readSourceFileSnapshot } from "../../storage/sourceFiles";
import { createContentHash } from "../../shared/hash";
import type { ProjectGraph, SourceFile } from "../../shared/types";
import type { SourceCaptureLimits } from "../../shared/narrativeSources";

export const sourceLimits: SourceCaptureLimits = {
  maxDepth: 8, maxDeclarations: 40, maxSourceBytes: 196_608, maxFileBytes: 524_288,
  maxTotalFileBytes: 1_048_576, maxGraphNodes: 1000, maxEdges: 4000
};

/** Test source is parsed only. Neither its recursive calls nor its functions execute. */
export const helperText = "export function finish(value: number): number {\r\n"
  + Array.from({ length: 90 }, (_, index) => `  const helper${index} = "원문 😀 / ${index}";\r\n`).join("")
  + "  return value;\r\n}\r\n";
export const rootText = 'import { finish } from "./helpers";\r\nexport function root(value: number): number {\r\n'
  + Array.from({ length: 220 }, (_, index) => `  const 기록${index} = "😀 / ${index}";\r\n`).join("")
  + '  return finish(value);\r\n}\r\n'
  + 'export function left(value: number): number { return right(value); }\r\n'
  + 'export function right(value: number): number { return left(value); }\r\n';

export type NarrativeWorkspace = {
  directory: string; rootPath: string; helperPath: string; sources: SourceFile[];
  graph: ProjectGraph; current: ProjectGraph | undefined; reader: VsCodeNarrativeSourceReader;
  node(name: string): ProjectGraph["nodes"][number];
  authority(): ReturnType<typeof createWorkspaceSourceGraph>;
  capture(names?: readonly string[], overrides?: Partial<SourceCaptureLimits>): ReturnType<typeof captureNarrativeSources>;
};

/** Scope all real files, analyzer child ownership and cleanup to one callback. */
export async function withNarrativeWorkspace<T>(run: (workspace: NarrativeWorkspace) => Promise<T>,
  onNativeStart?: (sources: SourceFile[]) => void): Promise<T> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "narrative-source-"));
  const kotlin = new KotlinAnalyzer();
  const sources: SourceFile[] = [
    { path: path.join(directory, "root.ts"), languageId: "typescript", content: rootText },
    { path: path.join(directory, "helpers.ts"), languageId: "typescript", content: helperText },
    { path: path.join(directory, "sample.kt"), languageId: "kotlin", content: "fun choose(value: Int): Int = keep(value)\nfun keep(value: Int): Int = value\n" }
  ].map((file) => ({ ...file, sizeBytes: Buffer.byteLength(file.content), contentHash: createContentHash(file.content) }));
  await Promise.all(sources.map((file) => fs.writeFile(file.path, file.content)));
  const fileSystem = { getWorkspaceRoot: () => directory, findSourceFiles: async () => sources };
  const fallback = new AnalyzerPipeline(fileSystem, [new TypeScriptAnalyzer(), kotlin]);
  const events: string[] = [];
  const backend = new RustAnalyzerBackend({ engineRoot: path.resolve("engine/analyzer"), workspaceFileSystem: fileSystem,
    maxFileSizeKb: 512, fallbackBackend: fallback,
    logger: { debug() {}, warn(name) { events.push(name); }, error(name) { events.push(name); }, info(name) {
      events.push(name); if (name === "rust.workspace.start") onNativeStart?.(sources);
    } } });
  try {
    const { graph } = await backend.analyzeWorkspace();
    assert.ok(events.includes("rust.workspace.complete"), "Actual Rust child must complete");
    assert.ok(!events.includes("rust.workspace.failed"), "A fallback result cannot stand in for the native integration test");
    const workspace: NarrativeWorkspace = {
      directory, sources, graph, current: graph, rootPath: path.join(directory, "root.ts"), helperPath: path.join(directory, "helpers.ts"),
      reader: new VsCodeNarrativeSourceReader({ textDocuments: [] }, readSourceFileSnapshot),
      node(name) { const node = this.graph.nodes.find((node) => node.name === name && ["function", "method", "constructor"].includes(node.kind)); assert.ok(node, name); return node; },
      authority() { return createWorkspaceSourceGraph({ graph: this.graph, store: new InMemoryGraphStore(this.graph), getCurrentGraph: () => this.current }); },
      capture(names = ["root"], overrides = {}) {
        return captureNarrativeSources({ rootIds: names.map((name) => this.node(name).id), graph: this.authority(), reader: this.reader,
          signal: new AbortController().signal, limits: { ...sourceLimits, ...overrides } });
      }
    };
    return await run(workspace);
  } finally {
    backend.dispose(); kotlin.dispose(); await fs.rm(directory, { recursive: true, force: true });
  }
}
