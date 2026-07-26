/**
 * Rust analyzer backend adapter. It runs the low-level Rust CLI and converts its
 * ProjectGraph JSON output into the same result shape used by the Webview.
 */

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import type { AnalysisBackend } from "../core/analysisBackend";
import type { AnalyzeResult } from "../core/analyzerPipeline";
import type { WorkspaceFileSystem } from "../core/workspaceScanner";
import { normalizeProjectGraphMetadata } from "../../graph/graphMetadata";
import type { ProjectAnalyzerLogger } from "../../observability/logger";
import type { ProjectGraph, SourceFile } from "../../shared/types";
import { createWorkspaceSourceManifestInput } from "./workspaceSourceManifest";
import {
  type CollectedProcessOutput,
  ProcessOutputCollector
} from "./processOutputCollector";
import { mergeSupplementalLanguageGraph } from "./supplementalLanguageGraph";

/** Languages whose symbols are supplied by the in-process analyzer for now. */
const SUPPLEMENTAL_LANGUAGE_IDS = new Set([
  "java",
  "fsharp",
  "ocaml",
  "elixir"
]);

/** Options required to run the Rust analyzer engine. */
export type RustAnalyzerBackendOptions = {
  engineRoot: string;
  workspaceFileSystem: WorkspaceFileSystem;
  maxFileSizeKb: number;
  fallbackBackend: AnalysisBackend;
  logger: ProjectAnalyzerLogger;
};

/** Spawn command and arguments for one engine invocation. */
type EngineInvocation = {
  command: string;
  args: string[];
};

/** Backpressure-aware stdin plus its diagnostic byte count. */
type EngineStdin = {
  content: string | Buffer | Iterable<Uint8Array>;
  byteLength: number;
};

/**
 * Analysis backend that delegates workspace and current-file analysis to Rust.
 */
export class RustAnalyzerBackend implements AnalysisBackend {
  /** Child engines still running during this Extension Host session. */
  private readonly activeProcesses = new Set<childProcess.ChildProcess>();

  public constructor(private readonly options: RustAnalyzerBackendOptions) {}

  /** Terminates only analyzer engines owned by this backend during deactivation. */
  public dispose(): void {
    for (const process of this.activeProcesses) {
      process.stdin?.destroy();
      process.kill();
    }
    this.activeProcesses.clear();
  }

  /**
   * Analyzes the workspace through the Rust CLI, falling back only when the engine
   * cannot be executed in the local development environment.
   */
  public async analyzeWorkspace(): Promise<AnalyzeResult> {
    const workspaceRoot = this.options.workspaceFileSystem.getWorkspaceRoot();

    if (!workspaceRoot) {
      this.options.logger.warn("rust.workspace.noWorkspaceRoot");
      return this.options.fallbackBackend.analyzeWorkspace();
    }

    try {
      // The VS Code adapter is the source of truth for configured globs and dirty
      // documents; Rust deliberately does not attempt to reproduce VS Code glob semantics.
      const sourceFiles = await this.options.workspaceFileSystem.findSourceFiles();
      const manifest = createWorkspaceSourceManifestInput(sourceFiles);
      this.options.logger.info("rust.workspace.start", {
        manifestBytes: manifest.byteLength,
        maxFileSizeKb: this.options.maxFileSizeKb,
        sourceFiles: sourceFiles.length,
        workspaceRoot
      });
      const graph = await this.runEngine([
        "analyze-workspace",
        "--workspace",
        workspaceRoot,
        "--source-manifest-stdin",
        "--max-file-size-kb",
        String(this.options.maxFileSizeKb)
      ], { content: manifest.chunks, byteLength: manifest.byteLength });

      const enrichedGraph = await this.addSupplementalLanguages(graph, sourceFiles);
      this.options.logger.info("rust.workspace.complete", summarizeGraph(enrichedGraph));
      return { graph: enrichedGraph };
    } catch (error) {
      this.options.logger.error("rust.workspace.failed", { error: formatError(error) });
      return this.analyzeWithFallback("analysis.rustWorkspaceFailed", error, () =>
        this.options.fallbackBackend.analyzeWorkspace()
      );
    }
  }

  /**
   * Analyzes the active file content through Rust stdin so unsaved editor changes
   * are included.
   */
  public async analyzeFile(file: SourceFile): Promise<AnalyzeResult> {
    const workspaceRoot =
      this.options.workspaceFileSystem.getWorkspaceRoot() ?? path.dirname(file.path);

    try {
      this.options.logger.info("rust.file.start", {
        languageId: file.languageId,
        path: file.path,
        sizeBytes: file.sizeBytes
      });
      const graph = await this.runEngine(
        [
          "analyze-stdin",
          "--workspace",
          workspaceRoot,
          "--path",
          file.path,
          "--language",
          file.languageId
        ],
        { content: file.content, byteLength: file.sizeBytes }
      );

      const enrichedGraph = await this.addSupplementalLanguages(graph, [file]);
      this.options.logger.info("rust.file.complete", summarizeGraph(enrichedGraph));
      return { graph: enrichedGraph };
    } catch (error) {
      this.options.logger.error("rust.file.failed", { error: formatError(error), path: file.path });
      return this.analyzeWithFallback("analysis.rustFileFailed", error, () =>
        this.options.fallbackBackend.analyzeFile(file)
      );
    }
  }

  /**
   * Executes the Rust engine and parses the emitted ProjectGraph JSON.
   */
  private async runEngine(engineArgs: string[], stdin?: EngineStdin): Promise<ProjectGraph> {
    const invocation = resolveEngineInvocation(this.options.engineRoot, engineArgs);
    const startedAt = Date.now();
    this.options.logger.debug("rust.process.spawn", {
      args: invocation.args,
      command: invocation.command,
      stdinBytes: stdin?.byteLength ?? 0
    });
    const output = await runProcess(
      invocation,
      this.options.logger,
      this.activeProcesses,
      stdin?.content
    );
    this.options.logger.debug("rust.process.stdout", {
      durationMs: Date.now() - startedAt,
      stdoutBytes: output.stdoutBytes,
      stdoutChunks: output.stdoutChunks
    });
    const parseStartedAt = Date.now();
    let parsedGraph: unknown;
    try {
      parsedGraph = JSON.parse(output.stdout) as unknown;
    } finally {
      // The parsed graph replaces the potentially very large serialized copy.
      output.stdout = "";
    }
    if (!isProjectGraphPayload(parsedGraph)) {
      throw new Error("Rust analyzer returned an invalid graph payload.");
    }
    const graph = parsedGraph;
    this.options.logger.debug("rust.process.parsed", {
      durationMs: Date.now() - parseStartedAt,
      edges: graph.edges.length,
      nodes: graph.nodes.length
    });

    return normalizeProjectGraphMetadata(graph);
  }

  /** Merges selected fallback-language symbols without duplicating other engines. */
  private async addSupplementalLanguages(
    graph: ProjectGraph,
    sourceFiles: readonly SourceFile[]
  ): Promise<ProjectGraph> {
    const supplementalFiles = sourceFiles.filter((file) =>
      SUPPLEMENTAL_LANGUAGE_IDS.has(file.languageId)
    );
    if (supplementalFiles.length === 0) {
      return graph;
    }
    const fallbackResult = this.options.fallbackBackend.analyzeFiles
      ? await this.options.fallbackBackend.analyzeFiles(supplementalFiles)
      : supplementalFiles.length === 1
        ? await this.options.fallbackBackend.analyzeFile(supplementalFiles[0])
        : await this.options.fallbackBackend.analyzeWorkspace();
    return mergeSupplementalLanguageGraph(
      graph,
      fallbackResult.graph,
      SUPPLEMENTAL_LANGUAGE_IDS
    );
  }

  /**
   * Falls back to the TypeScript backend and records why Rust was skipped.
   */
  private async analyzeWithFallback(
    code: string,
    error: unknown,
    runFallback: () => Promise<AnalyzeResult>
  ): Promise<AnalyzeResult> {
    const result = await runFallback();
    this.options.logger.warn("rust.fallback.complete", summarizeGraph(result.graph));
    result.graph.diagnostics.push({
      severity: "warning",
      code,
      message: error instanceof Error ? error.message : "Unknown Rust analyzer failure"
    });
    return result;
  }
}

/**
 * Resolves the fastest available engine command for development and packaged use.
 */
function resolveEngineInvocation(engineRoot: string, engineArgs: string[]): EngineInvocation {
  const binaryName = process.platform === "win32" ? "project-analyzer-engine.exe" : "project-analyzer-engine";
  const runtimeBinary = path.join(engineRoot, "bin", `${process.platform}-${process.arch}`, binaryName);
  const releaseBinary = path.join(engineRoot, "target", "release", binaryName);
  const debugBinary = path.join(engineRoot, "target", "debug", binaryName);
  const manifestPath = path.join(engineRoot, "Cargo.toml");

  const existingBinary = selectNewestExistingBinary([runtimeBinary, releaseBinary, debugBinary]);

  if (existingBinary) {
    return { command: existingBinary, args: engineArgs };
  }

  return {
    command: "cargo",
    args: ["run", "--quiet", "--manifest-path", manifestPath, "--", ...engineArgs]
  };
}

/**
 * Chooses the newest available binary so dev builds do not accidentally run a
 * stale release artifact left over from packaging.
 */
function selectNewestExistingBinary(binaryPaths: string[]): string | undefined {
  return binaryPaths
    .filter((binaryPath) => fs.existsSync(binaryPath))
    .map((binaryPath) => ({
      binaryPath,
      modifiedMs: fs.statSync(binaryPath).mtimeMs
    }))
    .sort((left, right) => right.modifiedMs - left.modifiedMs)[0]?.binaryPath;
}

/**
 * Runs a child process and returns stdout when it exits successfully.
 */
function runProcess(
  invocation: EngineInvocation,
  logger: ProjectAnalyzerLogger,
  activeProcesses: Set<childProcess.ChildProcess>,
  stdin?: string | Buffer | Iterable<Uint8Array>
): Promise<CollectedProcessOutput> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = childProcess.spawn(invocation.command, invocation.args, {
      stdio: ["pipe", "pipe", "pipe"]
    });
    activeProcesses.add(child);
    /** Lazy manifest source, destroyed explicitly if the engine exits early. */
    let inputStream: Readable | undefined;
    const output = new ProcessOutputCollector();
    let settled = false;

    child.stdout.on("data", (chunk: Buffer) => {
      output.appendStdout(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output.appendStderr(chunk);
    });
    child.stdin.on("error", (error) => {
      // A child that exits early can close stdin before the lazy manifest is
      // exhausted. The close handler below retains its more useful stderr.
      logger.debug("rust.process.stdinClosed", { error: formatError(error) });
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      activeProcesses.delete(child);
      inputStream?.destroy();
      output.release();
      logger.error("rust.process.error", { error: formatError(error) });
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      activeProcesses.delete(child);
      inputStream?.destroy();
      const collected = output.take();
      logger.debug("rust.process.close", {
        code,
        durationMs: Date.now() - startedAt,
        stderrBytes: collected.stderrBytes,
        stderrChunks: collected.stderrChunks,
        stderrOmittedBytes: collected.stderrOmittedBytes,
        stdoutBytes: collected.stdoutBytes,
        stdoutChunks: collected.stdoutChunks
      });
      if (collected.stderrBytes > 0) {
        logger.warn("rust.process.stderr", {
          bytes: collected.stderrBytes,
          omittedBytes: collected.stderrOmittedBytes,
          preview: collected.stderrPreview
        });
      }

      if (code !== 0) {
        collected.stdout = "";
        reject(new Error(
          formatProcessStderr(collected) || `Rust analyzer exited with code ${code ?? "unknown"}`
        ));
        return;
      }

      resolve(collected);
    });

    if (stdin !== undefined && typeof stdin !== "string" && !Buffer.isBuffer(stdin)) {
      inputStream = Readable.from(stdin, { objectMode: false });
      inputStream.on("error", (error) => {
        logger.error("rust.process.stdinError", { error: formatError(error) });
        child.stdin.destroy(error);
      });
      inputStream.pipe(child.stdin);
    } else if (stdin !== undefined) {
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}

/** Adds an explicit omission suffix to a bounded stderr preview. */
function formatProcessStderr(output: CollectedProcessOutput): string {
  const preview = output.stderrPreview.trim();
  if (!preview) return "";
  return output.stderrOmittedBytes > 0
    ? `${preview}\n[${output.stderrOmittedBytes} stderr bytes omitted]`
    : preview;
}

/** Narrows the minimum engine response before metadata normalization. */
function isProjectGraphPayload(value: unknown): value is ProjectGraph {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProjectGraph>;
  return Array.isArray(candidate.nodes) && Array.isArray(candidate.edges);
}

/** Builds a small graph summary for log lines. */
function summarizeGraph(graph: ProjectGraph): Record<string, unknown> {
  return {
    edges: graph.edges.length,
    files: graph.metadata.fileCount,
    frameworks: graph.metadata.frameworks?.length ?? 0,
    languages: graph.metadata.languageSummary?.length ?? graph.metadata.languages.length,
    nodes: graph.nodes.length,
    projectPackages: graph.metadata.projectPackageRoots?.length ?? 0
  };
}

/** Converts an unknown error to a stable log payload. */
function formatError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
