/**
 * Analyzer pipeline entrypoint. It coordinates workspace scanning and language
 * analyzers while keeping the scaffold safe before full parser integrations land.
 */

import { createEmptyProjectGraph } from "../../graph/emptyGraph";
import type { ProjectGraph, SourceFile } from "../../shared/types";
import type { LanguageAnalyzer } from "./languageAnalyzer";
import { WorkspaceScanner } from "./workspaceScanner";
import type { WorkspaceFileSystem } from "./workspaceScanner";

/** Result returned by workspace and file analysis commands. */
export type AnalyzeResult = {
  graph: ProjectGraph;
};

/**
 * Coordinates static analysis for workspaces and individual files.
 */
export class AnalyzerPipeline {
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
    const graph = createEmptyProjectGraph(workspaceRoot);

    graph.metadata.fileCount = files.length;
    graph.metadata.languages = getLanguages(files);

    return { graph };
  }

  /**
   * Analyzes a single source file. Parser integration will populate symbols and
   * edges in later milestones.
   */
  public async analyzeFile(file: SourceFile): Promise<AnalyzeResult> {
    const workspaceRoot = this.fileSystem.getWorkspaceRoot() ?? "";
    const graph = createEmptyProjectGraph(workspaceRoot);

    graph.metadata.fileCount = 1;
    graph.metadata.languages = [file.languageId];

    return { graph };
  }

  /**
   * Returns the analyzer registered for a source file path.
   */
  public getAnalyzerForPath(filePath: string): LanguageAnalyzer | undefined {
    const extension = getFileExtension(filePath);
    return this.analyzersByExtension.get(extension);
  }
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
