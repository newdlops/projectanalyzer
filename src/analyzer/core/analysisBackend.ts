/**
 * Analysis backend contract used by GUI providers. Backends can be implemented
 * by the in-process TypeScript analyzer or by the external Rust engine.
 */

import type { SourceFile } from "../../shared/types";
import type { AnalyzeResult } from "./analyzerPipeline";

/** Common analysis API consumed by extension services. */
export interface AnalysisBackend {
  analyzeWorkspace(): Promise<AnalyzeResult>;
  analyzeFile(file: SourceFile): Promise<AnalyzeResult>;
  analyzeFiles?(files: readonly SourceFile[]): Promise<AnalyzeResult>;
  /** Optional lifecycle hook for external-process or worker-backed analyzers. */
  dispose?(): void;
}
