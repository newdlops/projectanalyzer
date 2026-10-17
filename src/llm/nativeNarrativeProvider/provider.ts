/** Bridge complete root/call Host requests to one source-free-ready native action, with per-async-action ownership and no legacy response pipeline. */
import { AsyncLocalStorage } from "node:async_hooks";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { getGlobalModelTaskManager } from "../../shared/modelTasks";
import type { FunctionNarrativeProvider, FunctionNarrativeOperationOptions, FunctionNarrativeModelResponse,
  FunctionNarrativeGenerationOptions, FunctionNarrativeRootRequest } from "../../application/functionNarratives";
import { runNativeNarrativeAction, type NativeNarrativeTransport } from "../nativeNarratives";
import type { NativeFunctionNarrativeProviderOptions, NativeFunctionNarrativeRunReceipt } from "./types";
import { asNativeProviderFailure } from "./errors";

type Action = {
  /** Provider identity is private process state and never part of a model packet or response. */
  owner: symbol;
  parent: AbortSignal; signal: AbortSignal; language: "ko" | "en"; transport: NativeNarrativeTransport;
  active: boolean; pending: boolean; requests: number; failure?: unknown;
};
// Share async ownership across provider instances; otherwise another instance can enqueue behind the very action awaiting it.
const actions = new AsyncLocalStorage<Action>();

/** Creation and prepare are inert. Only withRun enters the global FIFO and constructs/prepares its one owned worker. */
export function createNativeFunctionNarrativeProvider(options: NativeFunctionNarrativeProviderOptions): FunctionNarrativeProvider {
  const manager = options.manager ?? getGlobalModelTaskManager();
  const owner = Symbol("native-function-narrative-provider"), prepared = new WeakMap<AbortSignal, FunctionNarrativeOperationOptions>();
  // Configuration is source-free and immutable for this provider; callbacks are invoked only by the native action after FIFO admission.
  const worker = { ...options.worker, args: [...options.worker.args] };

  /** A signal from another action, expired async work or nested scheduler entry cannot borrow the current worker. */
  function owned(signal: AbortSignal, language: "ko" | "en"): Action {
    const action = actions.getStore();
    if (!action?.active || action.owner !== owner || action.language !== language || signal !== action.parent && signal !== action.signal) {
      const error = new FunctionNarrativeError("failed", "native-provider-action-mismatch");
      if (action?.active) action.failure ??= error;
      throw error;
    }
    if (signal.aborted || action.signal.aborted) throw new FunctionNarrativeError("cancelled");
    return action;
  }

  /** Preserve the exact request and raw reply. Validation is Host-owned and a caught validation/request failure still fails this action. */
  async function generate(kind: "root" | "call", request: FunctionNarrativeRootRequest, language: "ko" | "en", signal: AbortSignal,
    generation?: FunctionNarrativeGenerationOptions): Promise<FunctionNarrativeModelResponse> {
    const action = owned(signal, language);
    if (action.pending) {
      const error = new FunctionNarrativeError("failed", "native-provider-overlapping-request"); action.failure ??= error; throw error;
    }
    action.pending = true;
    try {
      const reply = await action.transport.generate({ requestId: "complete-" + kind + "-" + action.requests++, payload: request }, action.signal);
      owned(signal, language);
      const response = { modelName: reply.modelName, text: reply.text };
      generation?.validate?.(response); return response;
    } catch (error) { action.failure ??= error; throw error; }
    finally { action.pending = false; }
  }

  return {
    managesDeadlines: true,
    async prepare(_language, signal, metadata) {
      if (signal.aborted || manager.disposed) throw new FunctionNarrativeError("cancelled");
      prepared.set(signal, { label: metadata?.label, onProgress: metadata?.onProgress });
    },
    async withRun(language, signal, operation) {
      if (signal.aborted || manager.disposed) throw new FunctionNarrativeError("cancelled");
      const prior = actions.getStore();
      if (prior) throw new FunctionNarrativeError("failed", prior.active ? "native-provider-nested-action" : "native-provider-expired-action");
      const metadata = prepared.get(signal); prepared.delete(signal);
      const result = await runNativeNarrativeAction({ worker, manager, signal,
        label: metadata?.label ?? "Complete function narrative", onProgress: metadata?.onProgress,
        async execute({ transport, signal: ownedSignal }) {
          const action: Action = { owner, parent: signal, signal: ownedSignal, language, transport, active: true, pending: false, requests: 0 };
          try {
            const value = await actions.run(action, () => operation(ownedSignal));
            if (action.failure !== undefined) throw action.failure;
            if (action.pending) throw new FunctionNarrativeError("failed", "native-provider-unawaited-request");
            return value;
          } catch (error) {
            if (action.failure !== undefined && action.failure !== error) throw new AggregateError([error, action.failure], "Native narrative action failed");
            throw error;
          } finally { action.active = false; }
        }
      }).catch(error => { throw asNativeProviderFailure(error); });
      // Receipts deliberately omit arbitrary worker receipt contents and every source/page/reply value.
      const { closedReceipt: _closedReceipt, ...observation } = result.actualWorker;
      const receipt: NativeFunctionNarrativeRunReceipt = { actionWholeHostMs: result.wholeHostMs, worker: observation,
        outerManagerSettlementObserved: true, neuralAuthorshipProven: false };
      try { options.onRunComplete?.(receipt); } catch { /* A diagnostics observer cannot rewrite settled execution. */ }
      return result.value;
    },
    async generate() { throw new FunctionNarrativeError("invalid-response", "native-provider-requires-complete-root"); },
    generateCompleteRoot(request, language, signal, generation) {
      const promise = generate("root", request, language, signal, generation);
      // Even a caller that forgets to await generation cannot create an unhandled rejection after mandatory worker cleanup.
      void promise.catch(() => {}); return promise;
    },
    generateCompleteCall(request, language, signal, generation) {
      const promise = generate("call", request, language, signal, generation);
      void promise.catch(() => {}); return promise;
    }
  };
}
