/**
 * Analyzer pipeline entrypoint. It coordinates workspace scanning and language
 * analyzers and normalizes extracted results into a project graph.
 */

import { InMemoryGraphStore } from "../../graph/graphStore";
import { createEdgeId } from "../../shared/ids";
import { createEmptyProjectGraph } from "../../graph/emptyGraph";
import type { GraphEdge, ProjectGraph, SourceFile, SymbolNode } from "../../shared/types";
import { createFileNode } from "./graphNodes";
import type { LanguageAnalyzer } from "./languageAnalyzer";
import { WorkspaceScanner } from "./workspaceScanner";
import type { WorkspaceFileSystem } from "./workspaceScanner";
import type { AnalysisBackend } from "./analysisBackend";

/** Result returned by workspace and current-file analysis requests. */
export type AnalyzeResult = {
  graph: ProjectGraph;
};

/**
 * Coordinates static analysis for workspaces and individual files.
 */
export class AnalyzerPipeline implements AnalysisBackend {
  /** Language analyzers keyed by supported file extension. */
  private readonly analyzersByExtension = new Map<string, LanguageAnalyzer>();

  public constructor(
    private readonly fileSystem: WorkspaceFileSystem,
    analyzers: readonly LanguageAnalyzer[]
  ) {
    for (const analyzer of analyzers) {
      for (const extension of analyzer.extensions) {
        this.analyzersByExtension.set(extension, analyzer);
      }
    }
  }

  /**
   * Analyzes the configured workspace and returns a normalized graph.
   */
  public async analyzeWorkspace(): Promise<AnalyzeResult> {
    const workspaceRoot = this.fileSystem.getWorkspaceRoot() ?? "";
    const scanner = new WorkspaceScanner(this.fileSystem);
    const files = await scanner.scan();
    return { graph: await this.buildGraph(workspaceRoot, files) };
  }

  /**
   * Analyzes a single source file and returns a normalized graph.
   */
  public async analyzeFile(file: SourceFile): Promise<AnalyzeResult> {
    const workspaceRoot = this.fileSystem.getWorkspaceRoot() ?? "";
    return { graph: await this.buildGraph(workspaceRoot, [file]) };
  }

  /** Analyzes an already acquired source collection without rescanning VS Code. */
  public async analyzeFiles(files: readonly SourceFile[]): Promise<AnalyzeResult> {
    const workspaceRoot = this.fileSystem.getWorkspaceRoot() ?? "";
    return { graph: await this.buildGraph(workspaceRoot, files) };
  }

  /**
   * Returns the analyzer registered for a source file path.
   */
  public getAnalyzerForPath(filePath: string): LanguageAnalyzer | undefined {
    const extension = getFileExtension(filePath);
    return this.analyzersByExtension.get(extension);
  }

  /**
   * Runs language analyzers over source files and merges their nodes and edges.
   */
  private async buildGraph(workspaceRoot: string, files: readonly SourceFile[]): Promise<ProjectGraph> {
    const graph = createEmptyProjectGraph(workspaceRoot);
    const store = new InMemoryGraphStore(graph);

    graph.metadata.fileCount = files.length;
    graph.metadata.languages = getLanguages(files);

    for (const file of files) {
      const fileNode = createFileNode(file, workspaceRoot);
      store.addNode(fileNode);
      await this.analyzeFileIntoStore(file, fileNode, files, workspaceRoot, store, graph);
    }

    return store.toProjectGraph();
  }

  /**
   * Parses one file and appends extracted symbols and edges into the graph store.
   */
  private async analyzeFileIntoStore(
    file: SourceFile,
    fileNode: SymbolNode,
    files: readonly SourceFile[],
    workspaceRoot: string,
    store: InMemoryGraphStore,
    graph: ProjectGraph
  ): Promise<void> {
    const analyzer = this.getAnalyzerForPath(file.path);

    if (!analyzer) {
      return;
    }

    try {
      const parsed = await analyzer.parse(file);
      const symbols = await analyzer.extractSymbols(parsed);
      const edges = await analyzer.extractEdges(parsed, { sourceFiles: files, workspaceRoot });

      for (const symbol of symbols) {
        store.addNode(symbol);
        store.addEdge(createContainsEdge(symbol.parentId ?? fileNode.id, symbol));
      }

      for (const edge of edges) {
        store.addEdge(edge);
      }
    } catch (error) {
      graph.diagnostics.push({
        severity: "error",
        code: "analysis.fileFailed",
        message: error instanceof Error ? error.message : "Unknown file analysis failure",
        filePath: file.path
      });
    }
  }
}

/**
 * Creates a structural containment edge for a symbol node.
 */
function createContainsEdge(parentId: string, child: SymbolNode): GraphEdge {
  return {
    id: createEdgeId("contains", parentId, child.id),
    kind: "contains",
    sourceId: parentId,
    targetId: child.id,
    filePath: child.filePath,
    range: child.range,
    confidence: "exact"
  };
}

/**
 * Returns unique language IDs from source files.
 */
function getLanguages(files: readonly SourceFile[]): string[] {
  return [...new Set(files.map((file) => file.languageId))].sort();
}

/**
 * Extracts a lower-case file extension including the leading dot.
 */
function getFileExtension(filePath: string): string {
  const index = filePath.lastIndexOf(".");
  return index >= 0 ? filePath.slice(index).toLowerCase() : "";
}
