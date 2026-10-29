/** Replaceable LLM boundary; application code supplies excerpts and never owns a model process. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import type { ModelTaskProgress, ModelTaskResource } from "../../shared/modelTasks";
import type { FunctionNarrativeRunLifecycle } from "./hostRun";

export { FunctionNarrativeError, type FunctionNarrativeFailure } from "../../shared/functionNarratives";
export type FunctionNarrativeModelResponse = { modelName: string; text: string };
/** A complete native request has only model-readable schema/messages; the decoder and captured source authority remain in the Host. */
export type FunctionNarrativeRootRequest = { schema: Record<string, unknown>; messages: Array<{ role: "system" | "user"; content: string }> };
/** Call and root packets share the same source-only wire envelope; their Host-owned decoders remain distinct. */
export type FunctionNarrativeCallRequest = FunctionNarrativeRootRequest;
export type FunctionNarrativeOperationOptions = { label?: string; onProgress?(progress: ModelTaskProgress): void;
  /** Host-owned node-reading pipeline may defer local weights until its first model-dependent stage; contains no source. */
  sourceReading?: boolean };
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
  /** Supports a dedicated source-wide purpose request, independently of scenario synthesis. */
  supportsFunctionPurpose?(signal: AbortSignal): boolean;
  /** Optional action scope; a native adapter supplies its FIFO-owned signal so manager disposal also cancels Host source/storage work. */
  withRun?<T>(language: "ko" | "en", signal: AbortSignal, operation: (ownedSignal?: AbortSignal) => Promise<T>, lifecycle?: FunctionNarrativeRunLifecycle): Promise<T>;
  /** Optional cancellable setup runs once per explicit action, before inference deadlines; it receives no source. */
  prepare?(language: "ko" | "en", signal: AbortSignal, options?: FunctionNarrativeOperationOptions): Promise<void>;
  /** Invoked only by an explicit user action; text still needs independent structured validation. */
  generate(context: FunctionNarrativeContext, language: "ko" | "en", signal: AbortSignal, options?: FunctionNarrativeGenerationOptions): Promise<FunctionNarrativeModelResponse>;
  /** Explicit capability for a complete source-only root reply. No legacy preparation/node/synthesis passes are added to it. */
  generateCompleteRoot?(request: FunctionNarrativeRootRequest, language: "ko" | "en", signal: AbortSignal, options?: FunctionNarrativeGenerationOptions): Promise<FunctionNarrativeModelResponse>;
  /** Explicit source-only call packet capability; raw replies are independently decoded before becoming same-action priors. */
  generateCompleteCall?(request: FunctionNarrativeCallRequest, language: "ko" | "en", signal: AbortSignal, options?: FunctionNarrativeGenerationOptions): Promise<FunctionNarrativeModelResponse>;
}
