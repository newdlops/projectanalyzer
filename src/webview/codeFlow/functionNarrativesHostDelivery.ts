/** Host-owned, snapshot-scoped LLM lifecycle and evidence projection, shared by both function surfaces. */
import { FunctionNarrativeError, parseFunctionNarrative, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import type { FunctionNarrativesRequest, FunctionNarrativesResponse } from "../../protocol/functionNarratives";
import type { ExtensionResponse } from "../../protocol/messages";
import type { CodeFlowEvidenceToken } from "../../protocol/functionLogic";
import type { SourceRange } from "../../shared/types";
import { createContentHash } from "../../shared/hash";

type ReadyResult = Pick<FunctionNarrativesResponse, "narrative" | "snippets" | "evidenceTokens" | "modelName" | "limited" | "language">;
type ContextEntry = { graphVersion: string; contextId: string; context: FunctionNarrativeContext; filePath: string; lastRequestId: number; reselectModel: boolean; cached: Map<string, ReadyResult> };
export type FunctionNarrativesHostDependencies = {
  provider?: FunctionNarrativeProvider;
  isActive(graphVersion: string): boolean;
  getLanguage(): "ko" | "en";
  createEvidence(filePath: string, range: SourceRange): CodeFlowEvidenceToken | undefined;
  postMessage(message: ExtensionResponse): Promise<void>;
};

/** At most eight bounded contexts and one pending inference; a new root clears all retained work. */
export class FunctionNarrativesHostDelivery {
  private readonly contexts = new Map<string, ContextEntry>();
  private pending?: { request: FunctionNarrativesRequest; controller: AbortController };
  public constructor(private readonly dependencies: FunctionNarrativesHostDependencies) {}

  /** Registers only Host-published source; browser requests can never choose another file or prompt. */
  public register(flowId: string, graphVersion: string, context: FunctionNarrativeContext, filePath: string): string | undefined {
    if (!this.dependencies.isActive(graphVersion) || !this.dependencies.provider || !context.snippets.some((snippet) => snippet.role === "function")) return undefined;
    for (const [id, entry] of this.contexts) if (entry.graphVersion !== graphVersion) this.contexts.delete(id);
    const prior = this.contexts.get(flowId);
    // Nearby constants/helpers can change without changing the root Tutor IR fingerprint.
    const contextId = "narrative-context:" + createContentHash(graphVersion + "\0" + JSON.stringify(context)).slice(0, 32);
    if (prior && prior.graphVersion === graphVersion && prior.contextId === contextId) return contextId;
    if (this.pending?.request.flowId === flowId) this.pending.controller.abort();
    this.contexts.set(flowId, { graphVersion, contextId, context, filePath, lastRequestId: -1, reselectModel: false, cached: new Map() });
    while (this.contexts.size > 8) {
      const oldest = this.contexts.keys().next().value!;
      if (this.pending?.request.flowId === oldest) this.pending.controller.abort();
      this.contexts.delete(oldest);
    }
    return contextId;
  }

  /** Releases pending model work and source context on root replacement or surface disposal. */
  public clear(): void { this.pending?.controller.abort(); this.pending = undefined; this.contexts.clear(); }
  public cancel(request: FunctionNarrativesRequest): void {
    const pending = this.pending;
    if (pending && pending.request.flowId === request.flowId && pending.request.graphVersion === request.graphVersion
      && pending.request.requestId === request.requestId) pending.controller.abort();
  }

  /** Caches validated narratives per snapshot/locale; duplicate IDs cannot incur another model request. */
  public async request(request: FunctionNarrativesRequest): Promise<void> {
    const entry = this.contexts.get(request.flowId);
    const send = (result: Omit<FunctionNarrativesResponse, keyof FunctionNarrativesRequest>) =>
      this.dependencies.postMessage({ type: "codeFlow/functionNarrativesLoaded", payload: { ...request, ...result } });
    if (!entry || entry.graphVersion !== request.graphVersion || !this.dependencies.isActive(request.graphVersion)) {
      await send({ status: "stale" }); return;
    }
    if (request.requestId <= entry.lastRequestId) return;
    entry.lastRequestId = request.requestId;
    this.pending?.controller.abort();
    const language = this.dependencies.getLanguage();
    const cached = entry.cached.get(language);
    if (cached) { await send({ status: "ready", ...cached, cacheHit: true }); return; }
    const provider = this.dependencies.provider;
    if (!provider) { await send({ status: "unavailable" }); return; }
    const controller = new AbortController();
    const pending = { request, controller }; this.pending = pending;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 45000);
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new FunctionNarrativeError(timedOut ? "timeout" : "cancelled"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const stillCurrent = () => this.contexts.get(request.flowId) === entry && this.dependencies.isActive(request.graphVersion);
    try {
      const response = await Promise.race([provider.generate(entry.context, language, controller.signal, { reselectModel: entry.reselectModel }), cancelled]);
      if (controller.signal.aborted || this.pending !== pending || !stillCurrent()) return;
      const narrative = parseFunctionNarrative(response.text, entry.context);
      const evidenceTokens = narrative.scenarios.map((scenario) => scenario.steps.map((step) => {
        const token = this.dependencies.createEvidence(entry.filePath, {
          startLine: step.source.startLine - 1, startCharacter: 0, endLine: step.source.endLine, endCharacter: 0
        });
        if (!token) throw new FunctionNarrativeError("invalid-response");
        return token;
      }));
      const result: ReadyResult = { narrative, evidenceTokens, modelName: response.modelName.slice(0, 100), language,
        limited: entry.context.limited, snippets: entry.context.snippets.map(({ id, startLine, endLine }) => ({ id, startLine, endLine })) };
      entry.cached.set(language, result);
      entry.reselectModel = false;
      await send({ status: "ready", ...result, cacheHit: false });
    } catch (error) {
      if (stillCurrent()) {
        const status = error instanceof FunctionNarrativeError ? error.code : "failed";
        if (status !== "cancelled") entry.reselectModel = true;
        await send({ status });
      }
    } finally {
      clearTimeout(timeout); controller.signal.removeEventListener("abort", onAbort);
      if (this.pending === pending) this.pending = undefined;
    }
  }
}
