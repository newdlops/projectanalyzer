/** Host-owned, snapshot-scoped LLM lifecycle and evidence projection, shared by both function surfaces. */
import { FunctionNarrativeError, parseFunctionNarrative, requestFunctionNarrative, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import type { FunctionNarrativeContext, FunctionNarrativeSourcePresenter, FunctionNarrativePageStoreFactory } from "../../shared/functionNarratives";
import { FunctionNarrativeScenarioSession, type FunctionNarrativeStoredPage } from "./functionNarrativeScenarioSession";
import type { FunctionNarrativesRequest, FunctionNarrativesResponse, FunctionNarrativeSourceRequest } from "../../protocol/functionNarratives";
import type { ExtensionResponse } from "../../protocol/messages";
import type { CodeFlowEvidenceToken } from "../../protocol/functionLogic";
import type { SourceRange } from "../../shared/types";
import { createContentHash } from "../../shared/hash";

// Unmanaged adapters retain a fallback deadline. Production adapters measure
// their three-minute execution bound after the global queue grants ownership.
const SCENARIO_BATCH_DEADLINE_MS = 90000;
type ReadyResult = Pick<FunctionNarrativesResponse, "narrative" | "snippets" | "evidenceTokens" | "modelName" | "limited" | "language" | "page" | "coverage">;
type ContextEntry = { graphVersion: string; contextId: string; context: FunctionNarrativeContext; filePath: string; sourceHash?: string; lastRequestId: number; reselectModel: boolean; cached: Map<string, ReadyResult>; sessions: Map<string, FunctionNarrativeScenarioSession> };
export type FunctionNarrativesHostDependencies = {
  provider?: FunctionNarrativeProvider;
  sourcePresenter?: FunctionNarrativeSourcePresenter;
  createPageStore?: FunctionNarrativePageStoreFactory;
  isActive(graphVersion: string): boolean;
  getLanguage(): "ko" | "en";
  createEvidence(filePath: string, range: SourceRange): CodeFlowEvidenceToken | undefined;
  postMessage(message: ExtensionResponse): Promise<void>;
};

/** At most eight bounded contexts and one pending inference; a new root clears all retained work. */
export class FunctionNarrativesHostDelivery {
  private readonly contexts = new Map<string, ContextEntry>();
  private pending?: { request: FunctionNarrativesRequest; controller: AbortController };
  private presentedFlowId?: string;
  public constructor(private readonly dependencies: FunctionNarrativesHostDependencies) {}

  /** Registers only Host-published source; browser requests can never choose another file or prompt. */
  public register(flowId: string, graphVersion: string, context: FunctionNarrativeContext, filePath: string, sourceHash?: string): string | undefined {
    if (!this.dependencies.isActive(graphVersion) || !this.dependencies.provider || !context.snippets.some((snippet) => snippet.role === "function")) return undefined;
    for (const [id, entry] of this.contexts) if (entry.graphVersion !== graphVersion) { this.disposeEntry(entry); this.contexts.delete(id); }
    const prior = this.contexts.get(flowId);
    // Nearby constants/helpers can change without changing the root Tutor IR fingerprint.
    const contextId = "narrative-context:" + createContentHash(graphVersion + "\0" + (sourceHash ?? "") + "\0" + JSON.stringify(context)).slice(0, 32);
    if (prior && prior.graphVersion === graphVersion && prior.contextId === contextId) return contextId;
    if (this.pending?.request.flowId === flowId) this.pending.controller.abort();
    if (this.presentedFlowId === flowId) { this.dependencies.sourcePresenter?.clear(); this.presentedFlowId = undefined; }
    if (prior) this.disposeEntry(prior);
    this.contexts.set(flowId, { graphVersion, contextId, context, filePath, sourceHash, lastRequestId: -1, reselectModel: false, cached: new Map(), sessions: new Map() });
    while (this.contexts.size > 8) {
      const oldest = this.contexts.keys().next().value!;
      if (this.pending?.request.flowId === oldest) this.pending.controller.abort();
      this.disposeEntry(this.contexts.get(oldest)!); this.contexts.delete(oldest);
    }
    return contextId;
  }

  /** Releases pending model work and source context on root replacement or surface disposal. */
  public clear(): void { this.pending?.controller.abort(); this.pending = undefined; for (const entry of this.contexts.values()) this.disposeEntry(entry); this.contexts.clear(); this.dependencies.sourcePresenter?.clear(); this.presentedFlowId = undefined; }
  public cancel(request: FunctionNarrativesRequest): void {
    const pending = this.pending;
    if (pending && pending.request.flowId === request.flowId && pending.request.graphVersion === request.graphVersion
      && pending.request.requestId === request.requestId) pending.controller.abort();
  }

  /** Shared source tokens cannot identify a narrative. Validate its exact context/locale before opening. */
  public resolveSource(request: FunctionNarrativeSourceRequest): { evidenceToken: CodeFlowEvidenceToken; present(): void } | undefined {
    const entry = this.contexts.get(request.flowId);
    if (!entry || entry.graphVersion !== request.graphVersion || entry.contextId !== request.contextId || !this.dependencies.isActive(request.graphVersion)
      || !Number.isSafeInteger(request.scenarioIndex) || request.scenarioIndex < 0 || !Number.isSafeInteger(request.stepIndex) || request.stepIndex < 0) return undefined;
    const result = entry.cached.get(request.language);
    if ((request.pageIndex ?? 0) !== (result?.page?.index ?? 0)) return undefined;
    const detail = request.nodeIndex !== undefined && result?.narrative?.scenarios[request.scenarioIndex]?.nodeDetails?.[request.nodeIndex];
    if (request.nodeIndex !== undefined && (!Number.isSafeInteger(request.nodeIndex) || request.nodeIndex < 0 || !detail)) return undefined;
    const evidenceToken = detail ? this.dependencies.createEvidence(entry.filePath, {
      startLine: detail.source.startLine - 1, startCharacter: 0, endLine: detail.source.endLine, endCharacter: 0
    }) : result?.evidenceTokens?.[request.scenarioIndex]?.[request.stepIndex];
    if (!result || !evidenceToken) return undefined;
    return { evidenceToken, present: () => {
      // Opening the native editor is asynchronous; replacement/eviction during that await revokes restoration.
      if (this.contexts.get(request.flowId) === entry && entry.cached.get(request.language) === result && this.dependencies.isActive(request.graphVersion)) {
        this.presentSource(request.flowId, entry, result);
      }
    } };
  }

  /** Loads a validated stored page before resolving its source token; no generation or browser-supplied range is involved. */
  public async loadSource(request: FunctionNarrativeSourceRequest): Promise<ReturnType<FunctionNarrativesHostDelivery["resolveSource"]>> {
    const entry = this.contexts.get(request.flowId);
    if (!entry || entry.contextId !== request.contextId || entry.graphVersion !== request.graphVersion || !this.dependencies.isActive(request.graphVersion)) return undefined;
    const session = entry.sessions.get(request.language);
    if (session) {
      const page = await session.readPage(request.pageIndex ?? 0);
      if (!page || this.contexts.get(request.flowId) !== entry || !this.dependencies.isActive(request.graphVersion)) return undefined;
      entry.cached.set(request.language, this.projectPage(entry, session, page, request.language));
    }
    return this.resolveSource(request);
  }

  /** Caches validated narratives per snapshot/locale; duplicate IDs cannot incur another model request. */
  public async request(request: FunctionNarrativesRequest): Promise<void> {
    const entry = this.contexts.get(request.flowId);
    const send = (result: Omit<FunctionNarrativesResponse, keyof FunctionNarrativesRequest>) =>
      this.dependencies.postMessage({ type: "codeFlow/functionNarrativesLoaded", payload: { ...request, ...result } });
    if (!entry || entry.graphVersion !== request.graphVersion || !this.dependencies.isActive(request.graphVersion)) {
      await send({ status: "stale" }); return;
    }
    const language = this.dependencies.getLanguage();
    if (request.nodeId !== undefined) {
      const locale = request.pageLanguage ?? language;
      const session = entry.sessions.get(locale);
      const page = await session?.readNodePage(request.nodeId);
      if (this.contexts.get(request.flowId) !== entry || !this.dependencies.isActive(request.graphVersion)) return;
      if (!session || !page) { await send({ status: "unavailable" }); return; }
      // A quiet node lookup must not replace the visible page's source-action cache.
      await send({ status: "ready", ...this.projectPage(entry, session, page, locale), cacheHit: true }); return;
    }
    // Node lookups have their own browser correlation and cannot supersede an active page or generation request.
    if (request.requestId <= entry.lastRequestId) return;
    entry.lastRequestId = request.requestId;
    // Preserve every declared parameter; unsupported example size fails before download/inference instead of silently dropping inputs.
    if ((entry.context.parameters?.length ?? 0) > 32) { await send({ status: "context-too-large" }); return; }
    if (request.pageIndex !== undefined) {
      const locale = request.pageLanguage ?? language;
      const session = entry.sessions.get(locale);
      const page = await session?.readPage(request.pageIndex);
      if (!session || !page || this.contexts.get(request.flowId) !== entry || !this.dependencies.isActive(request.graphVersion)) { await send({ status: "stale" }); return; }
      // A later page request can finish first. Do not restore an older page's
      // native annotations after the browser has already selected another one.
      if (entry.lastRequestId !== request.requestId) return;
      const result = this.projectPage(entry, session, page, locale);
      entry.cached.set(locale, result); this.presentSource(request.flowId, entry, result);
      await send({ status: "ready", ...result, cacheHit: true }); return;
    }
    if (entry.context.scenarioGraph && this.dependencies.createPageStore) {
      const session = entry.sessions.get(language);
      if (session?.complete) {
        // Reading a completed function must not revoke a different function's
        // pending execution slot. Keep cache-only work outside pending ownership.
        const first = await session.readPage(0);
        if (this.contexts.get(request.flowId) !== entry || !this.dependencies.isActive(request.graphVersion)
          || entry.lastRequestId !== request.requestId) return;
        if (!first) { await send({ status: "unavailable" }); return; }
        const result = this.projectPage(entry, session, first, language);
        entry.cached.set(language, result); this.presentSource(request.flowId, entry, result);
        await send({ status: "ready", ...result, cacheHit: true }); return;
      }
      this.pending?.controller.abort();
      await this.requestComplete(request, entry, language); return;
    }
    const cached = entry.cached.get(language);
    if (cached) { this.presentSource(request.flowId, entry, cached); await send({ status: "ready", ...cached, cacheHit: true }); return; }
    const provider = this.dependencies.provider;
    if (!provider) { await send({ status: "unavailable" }); return; }
    this.pending?.controller.abort();
    const controller = new AbortController();
    const pending = { request, controller }; this.pending = pending;
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new FunctionNarrativeError("cancelled"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const stillCurrent = () => this.contexts.get(request.flowId) === entry && this.dependencies.isActive(request.graphVersion);
    const operation = { label: entry.context.functionName, onProgress: (task: NonNullable<FunctionNarrativesResponse["task"]>) => {
      if (this.pending === pending && stillCurrent()) void send({ status: "working", task }).catch(() => {});
    } };
    try {
      if (provider.prepare) await Promise.race([provider.prepare(language, controller.signal, operation), cancelled]);
      if (controller.signal.aborted || this.pending !== pending || !stillCurrent()) return;
      const response = await Promise.race([requestFunctionNarrative(provider, entry.context, language, controller.signal, 45000,
        { ...operation, reselectModel: entry.reselectModel }), cancelled]);
      if (controller.signal.aborted || this.pending !== pending || !stillCurrent()) return;
      const narrative = parseFunctionNarrative(response.text, entry.context, language);
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
      this.presentSource(request.flowId, entry, result);
      await send({ status: "ready", ...result, cacheHit: false });
    } catch (error) {
      if (stillCurrent()) {
        const status = error instanceof FunctionNarrativeError ? error.code : "failed";
        if (status !== "cancelled") entry.reselectModel = true;
        await send({ status });
      }
    } finally {
      controller.signal.removeEventListener("abort", onAbort);
      if (this.pending === pending) this.pending = undefined;
    }
  }

  /** Every source/node batch enters the shared queue independently, so long functions do not monopolize it. */
  private async requestComplete(request: FunctionNarrativesRequest, entry: ContextEntry, language: "ko" | "en"): Promise<void> {
    const provider = this.dependencies.provider;
    const send = (result: Omit<FunctionNarrativesResponse, keyof FunctionNarrativesRequest>) =>
      this.dependencies.postMessage({ type: "codeFlow/functionNarrativesLoaded", payload: { ...request, ...result } });
    if (!provider) { await send({ status: "unavailable" }); return; }
    let session = entry.sessions.get(language);
    if (!session) { session = new FunctionNarrativeScenarioSession(entry.context, this.dependencies.createPageStore!()); entry.sessions.set(language, session); }
    const controller = new AbortController(); const pending = { request, controller }; this.pending = pending;
    let generated = false;
    const current = () => this.pending === pending && this.contexts.get(request.flowId) === entry && this.dependencies.isActive(request.graphVersion);
    const operation = { label: entry.context.functionName, onProgress: (task: NonNullable<FunctionNarrativesResponse["task"]>) => {
      if (current()) void send({ status: "working", task }).catch(() => {});
    } };
    try {
      if (!session.complete && provider.prepare) await this.prepareProvider(provider, language, controller.signal, operation);
      if (!current()) return;
      // Keep weights loaded only for this explicit whole-function request.
      // Each inference still queues independently; cancellation overrides retention.
      const boundedProvider: FunctionNarrativeProvider = {
        supportsFinalSummary: signal => provider.supportsFinalSummary?.(signal) === true,
        generate(context, locale, signal, options) {
          return requestFunctionNarrative(provider, context, locale, signal, SCENARIO_BATCH_DEADLINE_MS, { ...options, ...operation });
        }
      };
      const analyze = async () => {
        while (!session.complete) {
          let onAbort = () => {};
          const cancelled = new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(new FunctionNarrativeError("cancelled"));
            controller.signal.addEventListener("abort", onAbort, { once: true });
          });
          try {
            if (controller.signal.aborted) throw new FunctionNarrativeError("cancelled");
            await Promise.race([session.analyzeNext(boundedProvider, language, controller.signal, { reselectModel: entry.reselectModel }), cancelled]);
          } finally { controller.signal.removeEventListener("abort", onAbort); }
          if (!current() || controller.signal.aborted) return;
          generated = true;
          entry.reselectModel = false;
          const first = await session.readPage(0).catch(() => undefined);
          if (!current() || controller.signal.aborted) return;
          if (!first) throw new FunctionNarrativeError("invalid-response");
          const result = this.projectPage(entry, session, first, language);
          entry.cached.set(language, result);
          this.presentSource(request.flowId, entry, result);
          await send({ status: session.complete ? "ready" : "progress", ...result, cacheHit: false });
        }
        // A complete session serves its first page on repeated generation without another provider call.
        const first = await session.readPage(0);
        if (!generated && current() && first) {
          const result = this.projectPage(entry, session, first, language);
          entry.cached.set(language, result); this.presentSource(request.flowId, entry, result);
          await send({ status: "ready", ...result, cacheHit: true });
        }
      };
      if (provider.withRun) await provider.withRun(language, controller.signal, analyze);
      else await analyze();
    } catch (error) {
      if (current()) {
        const status = error instanceof FunctionNarrativeError ? error.code : "failed";
        if (status !== "cancelled") entry.reselectModel = true;
        const first = await session.readPage(0).catch(() => undefined);
        if (!current()) return;
        const result = first ? this.projectPage(entry, session, first, language) : { coverage: session.coverage };
        if (first) entry.cached.set(language, result);
        await send({ status, ...result, cacheHit: false });
      }
    } finally { if (this.pending === pending) this.pending = undefined; }
  }

  /** Cancellation wins even if a setup adapter fails to observe its signal; cached pages never call this. */
  private async prepareProvider(provider: FunctionNarrativeProvider, language: "ko" | "en", signal: AbortSignal,
    options?: Parameters<NonNullable<FunctionNarrativeProvider["prepare"]>>[2]): Promise<void> {
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    let abort = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new FunctionNarrativeError("cancelled"));
      signal.addEventListener("abort", abort, { once: true });
    });
    try { await Promise.race([provider.prepare!(language, signal, options), cancelled]); }
    finally { signal.removeEventListener("abort", abort); }
  }

  /** Keeps evidence and presentation bounded to the one visible page, with stable global numbering. */
  private projectPage(entry: ContextEntry, session: FunctionNarrativeScenarioSession, page: FunctionNarrativeStoredPage, language: "ko" | "en"): ReadyResult {
    const evidenceTokens = page.narrative.scenarios.map((scenario) => scenario.steps.map((step) => {
      const token = this.dependencies.createEvidence(entry.filePath, { startLine: step.source.startLine - 1, startCharacter: 0, endLine: step.source.endLine, endCharacter: 0 });
      if (!token) throw new FunctionNarrativeError("invalid-response"); return token;
    }));
    return { narrative: page.narrative, evidenceTokens, modelName: page.modelName, language,
      limited: entry.context.limited, snippets: entry.context.snippets.map(({ id, startLine, endLine }) => ({ id, startLine, endLine })),
      page: { index: page.index, count: session.pageCount, offset: page.offset }, coverage: session.coverage };
  }

  /** Storage adapters revoke late writes and clean their own private files. */
  private disposeEntry(entry: ContextEntry): void { for (const session of entry.sessions.values()) void session.dispose().catch(() => {}); }

  /** Decorates only validated output on a Host-captured snapshot; private paths remain on this native boundary. */
  private presentSource(flowId: string, entry: ContextEntry, result: ReadyResult): void {
    if (!entry.sourceHash || !result.narrative || !result.language || !result.modelName) return;
    this.dependencies.sourcePresenter?.show({ filePath: entry.filePath, sourceHash: entry.sourceHash, contextId: entry.contextId,
      functionName: entry.context.functionName, language: result.language, modelName: result.modelName, narrative: result.narrative, snippets: entry.context.snippets,
      ...(result.page ? { scenarioOffset: result.page.offset } : {}) });
    this.presentedFlowId = flowId;
  }
}
