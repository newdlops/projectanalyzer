/**
 * Rust analyzer backend adapter. It runs the low-level Rust CLI and converts its
 * ProjectGraph JSON output into the same result shape used by the Webview.
 */

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AnalysisBackend } from "../core/analysisBackend";
import type { AnalyzeResult } from "../core/analyzerPipeline";
import { normalizeProjectGraphMetadata } from "../../graph/graphMetadata";
import type { ProjectAnalyzerLogger } from "../../observability/logger";
import type { ProjectGraph, SourceFile } from "../../shared/types";

/** Options required to run the Rust analyzer engine. */
export type RustAnalyzerBackendOptions = {
  engineRoot: string;
  getWorkspaceRoot: () => string | undefined;
  maxFileSizeKb: number;
  fallbackBackend: AnalysisBackend;
  logger: ProjectAnalyzerLogger;
};

/** Spawn command and arguments for one engine invocation. */
type EngineInvocation = {
  command: string;
  args: string[];
};

/**
 * Analysis backend that delegates workspace and current-file analysis to Rust.
 */
export class RustAnalyzerBackend implements AnalysisBackend {
  public constructor(private readonly options: RustAnalyzerBackendOptions) {}

  /**
   * Analyzes the workspace through the Rust CLI, falling back only when the engine
   * cannot be executed in the local development environment.
   */
  public async analyzeWorkspace(): Promise<AnalyzeResult> {
    const workspaceRoot = this.options.getWorkspaceRoot();

    if (!workspaceRoot) {
      this.options.logger.warn("rust.workspace.noWorkspaceRoot");
      return this.options.fallbackBackend.analyzeWorkspace();
    }

    try {
      this.options.logger.info("rust.workspace.start", {
        maxFileSizeKb: this.options.maxFileSizeKb,
        workspaceRoot
      });
      const graph = await this.runEngine([
        "analyze-workspace",
        "--workspace",
        workspaceRoot,
        "--max-file-size-kb",
        String(this.options.maxFileSizeKb)
      ]);

      this.options.logger.info("rust.workspace.complete", summarizeGraph(graph));
      return { graph };
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
    const workspaceRoot = this.options.getWorkspaceRoot() ?? path.dirname(file.path);

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
        file.content
      );

      this.options.logger.info("rust.file.complete", summarizeGraph(graph));
      return { graph };
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
  private async runEngine(engineArgs: string[], stdin?: string): Promise<ProjectGraph> {
    const invocation = resolveEngineInvocation(this.options.engineRoot, engineArgs);
    const startedAt = Date.now();
    this.options.logger.debug("rust.process.spawn", {
      args: invocation.args,
      command: invocation.command,
      stdinBytes: stdin ? Buffer.byteLength(stdin, "utf8") : 0
    });
    const output = await runProcess(invocation, this.options.logger, stdin);
    this.options.logger.debug("rust.process.stdout", {
      durationMs: Date.now() - startedAt,
      stdoutBytes: Buffer.byteLength(output, "utf8")
    });
    const graph = JSON.parse(output) as ProjectGraph;

    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      throw new Error("Rust analyzer returned an invalid graph payload.");
    }

    return normalizeProjectGraphMetadata(graph);
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
  const releaseBinary = path.join(engineRoot, "target", "release", binaryName);
  const debugBinary = path.join(engineRoot, "target", "debug", binaryName);
  const manifestPath = path.join(engineRoot, "Cargo.toml");

  const existingBinary = selectNewestExistingBinary([releaseBinary, debugBinary]);

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
  stdin?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = childProcess.spawn(invocation.command, invocation.args, {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      logger.debug("rust.process.stdoutChunk", { bytes: chunk.length });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      logger.warn("rust.process.stderrChunk", {
        bytes: chunk.length,
        preview: chunk.toString("utf8").slice(0, 300)
      });
    });
    child.on("error", (error) => {
      logger.error("rust.process.error", { error: formatError(error) });
      reject(error);
    });
    child.on("close", (code) => {
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      logger.debug("rust.process.close", {
        code,
        durationMs: Date.now() - startedAt,
        stderrBytes: Buffer.byteLength(stderr, "utf8")
      });

      if (code !== 0) {
        reject(new Error(stderr || `Rust analyzer exited with code ${code ?? "unknown"}`));
        return;
      }

      resolve(Buffer.concat(stdoutChunks).toString("utf8"));
    });

    if (stdin !== undefined) {
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}

/** Builds a small graph summary for log lines. */
function summarizeGraph(graph: ProjectGraph): Record<string, unknown> {
  return {
    edges: graph.edges.length,
    files: graph.metadata.fileCount,
    frameworks: graph.metadata.frameworks?.length ?? 0,
    languages: graph.metadata.languageSummary?.length ?? graph.metadata.languages.length,
    nodes: graph.nodes.length
  };
}

/** Converts an unknown error to a stable log payload. */
function formatError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
