/** Replaceable LLM boundary; application code supplies excerpts and never owns a model process. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import type { ModelTaskProgress, ModelTaskResource } from "../../shared/modelTasks";

export { FunctionNarrativeError, type FunctionNarrativeFailure } from "../../shared/functionNarratives";
export type FunctionNarrativeModelResponse = { modelName: string; text: string };
export type FunctionNarrativeOperationOptions = { label?: string; onProgress?(progress: ModelTaskProgress): void };
export type FunctionNarrativeGenerationOptions = FunctionNarrativeOperationOptions & {
  reselectModel?: boolean;
  /** Validates before a managed operation is recorded as successful. */
  validate?(response: FunctionNarrativeModelResponse): void;
  timeoutMs?: number;
  /** Adapter-owned reuse remains under the same global execution/cleanup boundary. */
  resource?: ModelTaskResource;
};
export interface FunctionNarrativeProvider {
  /** Managed adapters own execution deadlines; Host fallback deadlines must not include queue waiting. */
  readonly managesDeadlines?: boolean;
  /** Checked after preparation; adapters may require synthesis from completed node values before a page is published. */
  supportsFinalSummary?(signal: AbortSignal): boolean;
  /** Optional page-scoped reuse; ownership remains with the FIFO scheduler and cleanup precedes resolution. */
  withRun?<T>(language: "ko" | "en", signal: AbortSignal, operation: () => Promise<T>): Promise<T>;
  /** Optional cancellable setup runs once per explicit action, before inference deadlines; it receives no source. */
  prepare?(language: "ko" | "en", signal: AbortSignal, options?: FunctionNarrativeOperationOptions): Promise<void>;
  /** Invoked only by an explicit user action; text still needs independent structured validation. */
  generate(context: FunctionNarrativeContext, language: "ko" | "en", signal: AbortSignal, options?: FunctionNarrativeGenerationOptions): Promise<FunctionNarrativeModelResponse>;
}
