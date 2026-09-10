/** Parser-backed graph fixtures shared by call-mode context, projection and Host tests. */
import fs from "node:fs";
import path from "node:path";
import { TypeScriptAnalyzer } from "../../../analyzer/languages/typescript";
import { PythonAnalyzer } from "../../../analyzer/languages/python";
import { analyzeFunctionLogic } from "../../../analyzer/functionLogic";
import { createContentHash } from "../../../shared/hash";
import type { ProjectGraph, SourceFile } from "../../../shared/types";
import type { SourceNodeToken } from "../../../protocol/sourceNavigation";

/** Builds real declaration identities; direct calls intentionally exercise syntax recovery. */
export async function loadFunctionCallsFixture(language: "typescript" | "python" = "typescript", fixtureName = "workflow") {
  const extension = language === "python" ? "py" : "ts";
  const content = fs.readFileSync(path.resolve(__dirname, `../../../../src/test/fixtures/functionCalls/${fixtureName}.${extension}`), "utf8");
  const file: SourceFile = { path: `/workspace/${fixtureName}.${extension}`, languageId: language, content, sizeBytes: Buffer.byteLength(content), contentHash: createContentHash(content) };
  const analyzer = language === "python" ? new PythonAnalyzer() : new TypeScriptAnalyzer();
  const parsed = await analyzer.parse(file);
  const nodes = await analyzer.extractSymbols(parsed);
  const graph: ProjectGraph = { workspaceRoot: "/workspace", version: "1", generatedAt: "2026-09-10T00:00:00.000Z",
    nodes, edges: [], diagnostics: [], metadata: { languages: [language], fileCount: 1, symbolCount: nodes.length, edgeCount: 0 } };
  const analysis = (name: string) => {
    const functionNode = nodes.find(node => node.name === name);
    if (!functionNode) throw new Error(`Missing fixture function: ${name}`);
    return analyzeFunctionLogic({ functionNode, sourceText: content, maxBlocks: 512 });
  };
  return { graph, file, analysis };
}

/** Uses protocol-shaped, deterministic opaque identities rather than raw symbol IDs. */
export function functionCallsToken(id: string): SourceNodeToken {
  return `source-node:${createContentHash(id)}` as SourceNodeToken;
}
