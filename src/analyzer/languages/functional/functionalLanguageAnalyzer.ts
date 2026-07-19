/**
 * In-process graph analyzer for F#, OCaml, and Elixir pipe-forward functions.
 * It shares syntax snapshots with Function Logic and emits only proven stages.
 */

import { createFileNodeId } from "../../core/graphNodes";
import type { AnalysisContext, LanguageAnalyzer, ParsedFile } from "../../core/languageAnalyzer";
import { createNodeId } from "../../../shared/ids";
import type { EdgeConfidence, GraphEdge, SourceFile, SymbolNode } from "../../../shared/types";
import { FUNCTIONAL_PIPELINE_EXTENSIONS } from "./functionalLanguageProfiles";
import { collectFunctionalPipelineChains } from "./functionalPipelineSyntax";
import { functionalOffsetsRange } from "./functionalSourceText";
import { parseFunctionalSource } from "./functionalSyntax";
import type { FunctionalCallableSyntax, FunctionalSourceSnapshot } from "./types";

type FunctionalSourceCacheEntry = {
  contentHash: string;
  source: FunctionalSourceSnapshot;
};

type FunctionalCallableRecord = {
  syntax: FunctionalCallableSyntax;
  source: FunctionalSourceSnapshot;
  node: SymbolNode;
};

/** Fallback analyzer registered for every supported functional file extension. */
export class FunctionalLanguageAnalyzer implements LanguageAnalyzer {
  public readonly languageId = "functionalPipeline";

  public readonly extensions = FUNCTIONAL_PIPELINE_EXTENSIONS;

  /** Immutable source cache avoids repeating lexical scans during one graph build. */
  private readonly sourceCache = new Map<string, FunctionalSourceCacheEntry>();

  /** Workspace callable records are rebuilt only when path/content identity changes. */
  private workspaceIndex?: { key: string; records: FunctionalCallableRecord[] };

  /** Parses one source according to its canonical language profile. */
  public async parse(file: SourceFile): Promise<ParsedFile> {
    return { file, ast: this.getSource(file) };
  }

  /** Extracts every named function as a source-backed graph callable. */
  public async extractSymbols(parsed: ParsedFile): Promise<SymbolNode[]> {
    return createFunctionalSymbols(parsed.file, asFunctionalSource(parsed.ast));
  }

  /** Resolves named pipe stages without treating callbacks as already executed. */
  public async extractEdges(
    parsed: ParsedFile,
    context: AnalysisContext
  ): Promise<GraphEdge[]> {
    const source = asFunctionalSource(parsed.ast);
    const workspaceRecords = this.getWorkspaceRecords(context.sourceFiles);
    const callers = workspaceRecords.filter((record) =>
      samePath(record.node.filePath, parsed.file.path)
    );
    const edges: GraphEdge[] = [];
    for (const caller of callers) {
      const chains = collectFunctionalPipelineChains(source, caller.syntax);
      for (const chain of chains) {
        for (const stage of chain.stages) {
          if (!stage.calleeName || !stage.calleeText) {
            continue;
          }
          const resolution = resolveFunctionalStage(caller, stage.calleeText, stage.calleeName, workspaceRecords);
          if (!resolution) {
            continue;
          }
          edges.push({
            id: createNodeId([
              "edge",
              "calls",
              caller.node.id,
              resolution.node.id,
              String(stage.range.startLine),
              String(stage.range.startCharacter)
            ]),
            kind: "calls",
            sourceId: caller.node.id,
            targetId: resolution.node.id,
            filePath: caller.node.filePath,
            range: stage.range,
            confidence: resolution.confidence,
            metadata: {
              functionalPipeline: true,
              pipeInsertion: source.profile.pipeInsertion
            }
          });
        }
      }
    }
    return edges;
  }

  /** Returns a cached syntax snapshot or reports an unsupported extension. */
  private getSource(file: SourceFile): FunctionalSourceSnapshot {
    const cached = this.sourceCache.get(file.path);
    if (cached?.contentHash === file.contentHash) {
      return cached.source;
    }
    const source = parseFunctionalSource(file.content, file.languageId, file.path);
    if (!source) {
      throw new Error(`Unsupported functional pipeline source: ${file.path}`);
    }
    this.sourceCache.set(file.path, { contentHash: file.contentHash, source });
    return source;
  }

  /** Builds a stable callable index for conservative cross-file stage resolution. */
  private getWorkspaceRecords(files: readonly SourceFile[]): FunctionalCallableRecord[] {
    const supportedFiles = files.filter((file) =>
      FUNCTIONAL_PIPELINE_EXTENSIONS.some((extension) => file.path.toLowerCase().endsWith(extension))
    );
    const key = supportedFiles
      .map((file) => `${file.path}\0${file.contentHash}`)
      .sort()
      .join("\0");
    if (this.workspaceIndex?.key === key) {
      return this.workspaceIndex.records;
    }
    const records = supportedFiles.flatMap((file) => {
      const source = this.getSource(file);
      const nodes = createFunctionalSymbols(file, source);
      const nodesBySelection = new Map(nodes.map((node) => [
        `${node.selectionRange.startLine}:${node.selectionRange.startCharacter}`,
        node
      ]));
      return source.callables.flatMap((syntax) => {
        const selection = functionalOffsetsRange(source.lines, syntax.selectionFrom, syntax.selectionTo);
        const node = nodesBySelection.get(`${selection.startLine}:${selection.startCharacter}`);
        return node ? [{ syntax, source, node }] : [];
      });
    });
    this.workspaceIndex = { key, records };
    return records;
  }
}

/** Creates graph symbols with canonical profile language and stable source identity. */
function createFunctionalSymbols(
  file: SourceFile,
  source: FunctionalSourceSnapshot
): SymbolNode[] {
  const fileId = createFileNodeId(file.path);
  return source.callables.map((callable) => {
    const range = functionalOffsetsRange(
      source.lines,
      callable.declarationFrom,
      callable.declarationTo
    );
    const selectionRange = functionalOffsetsRange(
      source.lines,
      callable.selectionFrom,
      callable.selectionTo
    );
    return {
      id: createNodeId([
        "functional-function",
        file.path,
        source.profile.language,
        callable.qualifiedName,
        String(selectionRange.startLine),
        String(selectionRange.startCharacter)
      ]),
      kind: "function",
      name: callable.name,
      qualifiedName: callable.qualifiedName,
      filePath: file.path,
      range,
      selectionRange,
      language: source.profile.language,
      parentId: fileId,
      metadata: {
        functionalPipelineSyntax: true,
        pipeInsertion: source.profile.pipeInsertion
      }
    };
  });
}

/** Prefers explicit qualification, then lexical module, file, and workspace uniqueness. */
function resolveFunctionalStage(
  caller: FunctionalCallableRecord,
  calleeText: string,
  calleeName: string,
  records: readonly FunctionalCallableRecord[]
): { node: SymbolNode; confidence: EdgeConfidence } | undefined {
  if (calleeText.includes(".")) {
    const qualified = records.filter((record) =>
      record.node.qualifiedName === calleeText
      || record.node.qualifiedName.endsWith(`.${calleeText}`)
    );
    if (qualified.length === 1) {
      return { node: qualified[0].node, confidence: "resolved" };
    }
  }
  const owner = caller.node.qualifiedName.split(".").slice(0, -1).join(".");
  if (owner) {
    const owned = records.filter((record) =>
      record.node.qualifiedName === `${owner}.${calleeName}`
    );
    if (owned.length === 1) {
      return { node: owned[0].node, confidence: "resolved" };
    }
  }
  const sameFile = records.filter((record) =>
    samePath(record.node.filePath, caller.node.filePath)
    && record.node.name === calleeName
  );
  if (sameFile.length === 1) {
    return { node: sameFile[0].node, confidence: "inferred" };
  }
  const workspace = records.filter((record) => record.node.name === calleeName);
  return workspace.length === 1
    ? { node: workspace[0].node, confidence: "inferred" }
    : undefined;
}

/** Validates the opaque parsed-file boundary used by AnalyzerPipeline. */
function asFunctionalSource(value: unknown): FunctionalSourceSnapshot {
  if (!value || typeof value !== "object" || !("profile" in value) || !("callables" in value)) {
    throw new Error("Functional analyzer received an invalid syntax snapshot.");
  }
  return value as FunctionalSourceSnapshot;
}

/** Compares source identities without depending on the Extension Host platform. */
function samePath(left: string, right: string): boolean {
  return left.replace(/\\/gu, "/") === right.replace(/\\/gu, "/");
}
