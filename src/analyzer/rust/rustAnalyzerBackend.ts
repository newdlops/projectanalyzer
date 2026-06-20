/**
 * Rust analyzer backend adapter. It runs the low-level Rust CLI and converts its
 * ProjectGraph JSON output into the same result shape used by the Webview.
 */

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AnalysisBackend } from "../core/analysisBackend";
import type { AnalyzeResult } from "../core/analyzerPipeline";
import type { ProjectGraph, SourceFile } from "../../shared/types";

/** Options required to run the Rust analyzer engine. */
export type RustAnalyzerBackendOptions = {
  engineRoot: string;
  getWorkspaceRoot: () => string | undefined;
  maxFileSizeKb: number;
  fallbackBackend: AnalysisBackend;
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
      return this.options.fallbackBackend.analyzeWorkspace();
    }

    try {
      const graph = await this.runEngine([
        "analyze-workspace",
        "--workspace",
        workspaceRoot,
        "--max-file-size-kb",
        String(this.options.maxFileSizeKb)
      ]);

      return { graph };
    } catch (error) {
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

      return { graph };
    } catch (error) {
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
    const output = await runProcess(invocation, stdin);
    const graph = JSON.parse(output) as ProjectGraph;

    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      throw new Error("Rust analyzer returned an invalid graph payload.");
    }

    return graph;
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

  if (fs.existsSync(releaseBinary)) {
    return { command: releaseBinary, args: engineArgs };
  }

  if (fs.existsSync(debugBinary)) {
    return { command: debugBinary, args: engineArgs };
  }

  return {
    command: "cargo",
    args: ["run", "--quiet", "--manifest-path", manifestPath, "--", ...engineArgs]
  };
}

/**
 * Runs a child process and returns stdout when it exits successfully.
 */
function runProcess(invocation: EngineInvocation, stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(invocation.command, invocation.args, {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

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
