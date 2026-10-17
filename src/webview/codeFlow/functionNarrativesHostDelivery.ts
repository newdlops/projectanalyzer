/** Host-owned, snapshot-scoped LLM lifecycle and evidence projection, shared by both function surfaces. */
import { FunctionNarrativeError, FunctionNarrativeHostRun, parseFunctionNarrative, requestFunctionNarrative, requestFunctionNarrativeRoot, requestFunctionNarrativeCall, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import { collectFunctionNarrativeCallPriors, type CapturedFunctionCallPlan } from "../../application/functionCallNarratives";
import type { FunctionNarrativeContext, FunctionNarrativeSourcePresenter, FunctionNarrativePageStoreFactory } from "../../shared/functionNarratives";
import { FunctionNarrativeScenarioSession, type FunctionNarrativeStoredPage } from "./functionNarrativeScenarioSession";
import type { FunctionNarrativesRequest, FunctionNarrativesResponse, FunctionNarrativeSourceRequest } from "../../protocol/functionNarratives";
import type { ExtensionResponse } from "../../protocol/messages";
import type { CodeFlowEvidenceToken } from "../../protocol/functionLogic";
import type { SourceRange } from "../../shared/types";
import { createContentHash } from "../../shared/hash";
import { SourceCaptureError, type NarrativeSourceLease, type NarrativeSourceValidation } from "../../shared/narrativeSources";
import { getNarrativeSourceFailureStatus } from "../../application/narrativeSources";

// Unmanaged adapters retain a fallback deadline. Production adapters measure
// their three-minute execution bound after the global queue grants ownership.
const SCENARIO_BATCH_DEADLINE_MS = 90000;
type ReadyResult = Pick<FunctionNarrativesResponse, "narrative" | "snippets" | "evidenceTokens" | "modelName" | "limited" | "language" | "page" | "coverage">;
type ActionSources = { context: FunctionNarrativeContext; lease: NarrativeSourceLease; calls?: CapturedFunctionCallPlan };
type ContextEntry = { graphVersion: string; contextId: string; context: FunctionNarrativeContext; filePath: string; sourceHash?: string;
  loadSources?(signal: AbortSignal): Promise<ActionSources>; sourceCaptureSha256?: string;
  sourceValidation?: NarrativeSourceValidation; invalidation?: Promise<void>;
  lastRequestId: number; reselectModel: boolean; cached: Map<string, ReadyResult>; sessions: Map<string, FunctionNarrativeScenarioSession> };
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
  /** A registered preview is not a captured model context. Weak identity preserves valid pending work without retaining disposed sessions. */
  private readonly sourceBoundSessions = new WeakSet<FunctionNarrativeScenarioSession>();
  private pending?: { request: FunctionNarrativesRequest; controller: AbortController; language: "ko" | "en"; providerCompleted: boolean; publishing: boolean; settled: Promise<void>; settle(): void };
  private presentedFlowId?: string;
  public constructor(private readonly dependencies: FunctionNarrativesHostDependencies) {}

  /** Registers only Host-published source; browser requests can never choose another file or prompt. */
  public register(flowId: string, graphVersion: string, context: FunctionNarrativeContext, filePath: string, sourceHash?: string,
    loadSources?: ContextEntry["loadSources"]): string | undefined {
    if (!this.dependencies.isActive(graphVersion) || !this.dependencies.provider || !context.snippets.some((snippet) => snippet.role === "function")) return undefined;
    for (const [id, entry] of this.contexts) if (entry.graphVersion !== graphVersion) { this.disposeEntry(entry); this.contexts.delete(id); }
    const prior = this.contexts.get(flowId);
    // Nearby constants/helpers can change without changing the root Tutor IR fingerprint.
    const contextId = "narrative-context:" + createContentHash(graphVersion + "\0" + (sourceHash ?? "") + "\0" + JSON.stringify(context)).slice(0, 32);
    if (prior && prior.graphVersion === graphVersion && prior.contextId === contextId) return contextId;
    if (this.pending?.request.flowId === flowId) this.pending.controller.abort();
    if (this.presentedFlowId === flowId) { this.dependencies.sourcePresenter?.clear(); this.presentedFlowId = undefined; }
    if (prior) this.disposeEntry(prior);
    this.contexts.set(flowId, { graphVersion, contextId, context, filePath, sourceHash, loadSources, lastRequestId: -1, reselectModel: false, cached: new Map(), sessions: new Map() });
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
    if (await this.validateCache(request.flowId, entry, request.language) !== "valid") return undefined;
    const session = entry.sessions.get(request.language);
    if (session) {
      const page = await session.readPage(request.pageIndex ?? 0);
      if (!page || this.contexts.get(request.flowId) !== entry || !this.dependencies.isActive(request.graphVersion)) return undefined;
      entry.cached.set(request.language, this.projectPage(entry, session, page, request.language));
    }
    if (await this.validateCache(request.flowId, entry, request.language) !== "valid") return undefined;
    return this.resolveSource(request);
  }

  /** Caches validated narratives per snapshot/locale; duplicate IDs cannot incur another model request. */
  public request(request: FunctionNarrativesRequest): Promise<void> {
    const run = new FunctionNarrativeHostRun(); return run.observe(() => this.requestInternal(request, run));
  }

  private async requestInternal(request: FunctionNarrativesRequest, run: FunctionNarrativeHostRun): Promise<void> {
    const entry = this.contexts.get(request.flowId);
    const send = (result: Omit<FunctionNarrativesResponse, keyof FunctionNarrativesRequest>) =>
      this.dependencies.postMessage({ type: "codeFlow/functionNarrativesLoaded", payload: { ...request, ...result } });
    if (!entry || entry.graphVersion !== request.graphVersion || !this.dependencies.isActive(request.graphVersion)) {
      await send({ status: "stale" }); return;
    }
    const language = this.dependencies.getLanguage();
    const cacheCurrent = async () => {
      const result = await this.validateCache(request.flowId, entry, request.pageLanguage ?? language);
      if (result === "stale") await send({ status: "stale" });
      return result === "valid";
    };
    if (request.nodeId !== undefined) {
      if (!await cacheCurrent()) return;
      const locale = request.pageLanguage ?? language;
      const session = entry.sessions.get(locale);
      const page = await session?.readNodePage(request.nodeId);
      if (!await cacheCurrent()) return;
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
      if (!await cacheCurrent()) return;
      const locale = request.pageLanguage ?? language;
      const session = entry.sessions.get(locale);
      const page = await session?.readPage(request.pageIndex);
      if (!await cacheCurrent()) return;
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
        if (!await cacheCurrent()) return;
        // Reading a completed function must not revoke a different function's
        // pending execution slot. Keep cache-only work outside pending ownership.
        const first = await session.readPage(0);
        if (!await cacheCurrent()) return;
        if (this.contexts.get(request.flowId) !== entry || !this.dependencies.isActive(request.graphVersion)
          || entry.lastRequestId !== request.requestId) return;
        if (!first) { await send({ status: "unavailable" }); return; }
        const result = this.projectPage(entry, session, first, language);
        entry.cached.set(language, result); this.presentSource(request.flowId, entry, result);
        await send({ status: "ready", ...result, cacheHit: true }); return;
      }
      this.pending?.controller.abort();
      await this.requestComplete(request, entry, language, run); return;
    }
    const cached = entry.cached.get(language);
    if (cached) { if (!await cacheCurrent()) return; this.presentSource(request.flowId, entry, cached); await send({ status: "ready", ...cached, cacheHit: true }); return; }
    const provider = this.dependencies.provider;
    if (!provider) { await send({ status: "unavailable" }); return; }
    this.pending?.controller.abort();
    const controller = new AbortController();
    const pending = this.startPending(request, controller, language);
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new FunctionNarrativeError("cancelled"));
      if (!entry.loadSources) controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const stillCurrent = () => this.contexts.get(request.flowId) === entry && this.dependencies.isActive(request.graphVersion);
    const operation = { label: entry.context.functionName, onProgress: (task: NonNullable<FunctionNarrativesResponse["task"]>) => {
      if (this.pending === pending && stillCurrent()) void send({ status: "working", task }).catch(() => {});
    } };
    let sourceLease: NarrativeSourceLease | undefined;
    try {
      if (provider.prepare) await Promise.race([provider.prepare(language, controller.signal, operation), cancelled]);
      if (controller.signal.aborted || this.pending !== pending || !stillCurrent()) return;
      if (entry.loadSources) {
        sourceLease = (await this.acquireSources(entry, controller.signal))?.lease;
        await sourceLease?.assertCurrent(controller.signal);
      }
      if (controller.signal.aborted || this.pending !== pending || !stillCurrent()) return;
      const generation = requestFunctionNarrative(provider, entry.context, language, controller.signal, 45000,
        { ...operation, reselectModel: entry.reselectModel });
      const response = sourceLease ? await generation : await Promise.race([generation, cancelled]);
      pending.providerCompleted = true;
      if (controller.signal.aborted || this.pending !== pending || !stillCurrent()) return;
      const narrative = parseFunctionNarrative(response.text, entry.context, language);
      if (sourceLease) await sourceLease.assertCurrent(controller.signal);
      if (controller.signal.aborted || this.pending !== pending || !stillCurrent()) return;
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
        const status = getNarrativeSourceFailureStatus(error) ?? (error instanceof FunctionNarrativeError ? error.code : "failed");
        if (status === "stale" && entry.loadSources) {
          await this.invalidateEntry(request.flowId, entry);
          if (this.pending === pending && this.dependencies.isActive(request.graphVersion)) await send({ status: "stale" });
          return;
        }
        if (status !== "cancelled") entry.reselectModel = true;
        await send({ status });
      }
    } finally {
      sourceLease?.dispose();
      controller.signal.removeEventListener("abort", onAbort);
      if (this.pending === pending) this.pending = undefined;
      pending.settle();
    }
  }

  /** Native requests retain one owned worker across all pages; final source/transport checks precede public cache ownership. */
  private async requestComplete(request: FunctionNarrativesRequest, entry: ContextEntry, language: "ko" | "en", run: FunctionNarrativeHostRun): Promise<void> {
    const provider = this.dependencies.provider;
    const send = (result: Omit<FunctionNarrativesResponse, keyof FunctionNarrativesRequest>) =>
      this.dependencies.postMessage({ type: "codeFlow/functionNarrativesLoaded", payload: { ...request, ...result } });
    if (!provider) { await send({ status: "unavailable" }); return; }
    const nativePriors = Boolean(provider.generateCompleteRoot && provider.generateCompleteCall);
    if (nativePriors && !entry.loadSources) { await send({ status: "unavailable" }); return; }
    let session = entry.sessions.get(language);
    if (!session) { session = new FunctionNarrativeScenarioSession(entry.context, this.dependencies.createPageStore!()); entry.sessions.set(language, session); }
    const controller = new AbortController(); const pending = this.startPending(request, controller, language);
    let generated = false, bodyCompleted = false, retainedNativeSession = false;
    let publishedNativeResult: ReadyResult | undefined;
    const current = () => this.pending === pending && this.contexts.get(request.flowId) === entry && this.dependencies.isActive(request.graphVersion);
    const operation = { label: entry.context.functionName, onProgress: (task: NonNullable<FunctionNarrativesResponse["task"]>) => {
      if (current()) void send({ status: "working", task }).catch(() => {});
    } };
    let sourceLease: NarrativeSourceLease | undefined;
    // Detach before disposal so a throwing adapter cannot be invoked twice or leak a ready response through finally.
    const releaseSource = () => { const lease = sourceLease; sourceLease = undefined; lease?.dispose(); };
    const ensureCurrent = () => { if (controller.signal.aborted || !current()) throw new FunctionNarrativeError("cancelled"); };
    try {
      if (!session.complete && provider.prepare) await this.prepareProvider(provider, language, controller.signal,
        { ...operation, sourceReading: !entry.loadSources && entry.context.detailLevel === "rich" }, Boolean(entry.loadSources));
      if (!current()) return;
      let actionSession = session;
      const capture = async () => {
        const loaded = entry.loadSources ? await this.acquireSources(entry, controller.signal) : undefined;
        sourceLease = loaded?.lease;
        if (controller.signal.aborted || !current()) throw new FunctionNarrativeError("cancelled");
        if (nativePriors) {
          if (!loaded?.calls || !sourceLease) throw new FunctionNarrativeError("unavailable", "native-root-call-source-authority");
          // No earlier action's root page or prior is resumed into a newly owned worker.
          if (entry.sessions.get(language) === session) entry.sessions.delete(language);
          entry.cached.delete(language); await actionSession.dispose(); delete entry.context.callPriors;
          const calls = await collectFunctionNarrativeCallPriors(loaded.calls, language, controller.signal,
            (request, validate) => requestFunctionNarrativeCall(provider, request, language, controller.signal, SCENARIO_BATCH_DEADLINE_MS, { ...operation, validate }),
            () => sourceLease!.assertCurrent(controller.signal));
          const ids = new Set(entry.context.snippets.map(snippet => snippet.id));
          for (const snippet of calls.snippets) { if (ids.has(snippet.id)) throw new FunctionNarrativeError("invalid-response"); ids.add(snippet.id); }
          entry.context.snippets = [...entry.context.snippets, ...calls.snippets];
          if (calls.priors) entry.context.callPriors = calls.priors;
          await sourceLease.assertCurrent(controller.signal);
          // The session stays action-private: a concurrent page/node lookup cannot read a valid-looking prefix from this worker.
          session = new FunctionNarrativeScenarioSession(entry.context, this.dependencies.createPageStore!());
          actionSession = session; this.sourceBoundSessions.add(session);
          return;
        }
        // Admission/prepare can fail before the first capture. A later request must still replace that original preview session.
        if (sourceLease && !this.sourceBoundSessions.has(actionSession)) {
          if (entry.sessions.get(language) === session) entry.sessions.delete(language);
          await actionSession.dispose();
          if (controller.signal.aborted || !current()) throw new FunctionNarrativeError("cancelled");
          session = new FunctionNarrativeScenarioSession(entry.context, this.dependencies.createPageStore!()); entry.sessions.set(language, session);
          actionSession = session; this.sourceBoundSessions.add(session);
        }
      };
      // A complete native provider's source-free ready/cleanup scope encloses capture, every page, and storage reads.
      if (!provider.generateCompleteRoot) await capture();
      // Keep weights loaded only for this explicit whole-function request.
      // Each inference still queues independently; cancellation overrides retention.
      const boundedProvider: FunctionNarrativeProvider = {
        supportsFinalSummary: signal => provider.supportsFinalSummary?.(signal) === true,
        async generate(context, locale, signal, options) {
          await sourceLease?.assertCurrent(signal);
          const response = await requestFunctionNarrative(provider, context, locale, signal, SCENARIO_BATCH_DEADLINE_MS, { ...options, ...operation });
          await sourceLease?.assertCurrent(signal); return response;
        },
        ...(provider.generateCompleteRoot ? { generateCompleteRoot: async (request, locale, signal, options) => {
          await sourceLease?.assertCurrent(signal);
          const response = await requestFunctionNarrativeRoot(provider, request, locale, signal, SCENARIO_BATCH_DEADLINE_MS, { ...options, ...operation });
          await sourceLease?.assertCurrent(signal); return response;
        } } : {})
      };
      const analyzeCaptured = async () => {
        if (provider.generateCompleteRoot) await capture();
        while (!actionSession.complete) {
          let onAbort = () => {};
          const cancelled = new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(new FunctionNarrativeError("cancelled"));
            if (!entry.context.sourceEvidence) controller.signal.addEventListener("abort", onAbort, { once: true });
          });
          try {
            if (controller.signal.aborted) throw new FunctionNarrativeError("cancelled");
            const page = actionSession.analyzeNext(boundedProvider, language, controller.signal, { reselectModel: entry.reselectModel,
              assertSourceCurrent: () => sourceLease?.assertCurrent(controller.signal) ?? Promise.resolve() });
            if (sourceLease) await page; else await Promise.race([page, cancelled]);
          } finally { controller.signal.removeEventListener("abort", onAbort); }
          if (!current() || controller.signal.aborted) return;
          generated = true;
          entry.reselectModel = false;
          const first = await actionSession.readPage(0).catch(() => undefined);
          if (!current() || controller.signal.aborted) return;
          if (!first) throw new FunctionNarrativeError("invalid-response");
          if (!nativePriors && !actionSession.complete) {
            const result = this.projectPage(entry, actionSession, first, language);
            entry.cached.set(language, result); this.presentSource(request.flowId, entry, result);
            await send({ status: "progress", ...result, cacheHit: false });
          }
        }
        bodyCompleted = true;
      };
      // Manager disposal owns a distinct signal. Relay it before capture and retain the relay through all awaited source/storage work.
      const analyze = async (ownedSignal?: AbortSignal) => {
        const abort = () => controller.abort();
        ownedSignal?.addEventListener("abort", abort, { once: true });
        if (ownedSignal?.aborted) abort();
        try { await analyzeCaptured(); }
        finally { ownedSignal?.removeEventListener("abort", abort); }
      };
      if (provider.withRun) await provider.withRun(language, controller.signal, analyze, run.lifecycle);
      else await analyze();
      pending.providerCompleted = true;
      await sourceLease?.assertCurrent(controller.signal);
      if (controller.signal.aborted || !current()) return;
      const first = await session.readPage(0);
      if (first && current() && !controller.signal.aborted) {
        if (nativePriors) { await sourceLease?.assertCurrent(controller.signal); ensureCurrent(); }
        const result = this.projectPage(entry, session, first, language);
        if (nativePriors) {
          releaseSource(); ensureCurrent();
          // No cache/page/source action can read this result until transport and its final compact source check finish.
          pending.publishing = true;
          await send({ status: "ready", ...result, cacheHit: !generated }); ensureCurrent();
          await entry.sourceValidation?.assertCurrent(controller.signal); ensureCurrent();
          entry.sessions.set(language, session); retainedNativeSession = true; publishedNativeResult = result;
        }
        entry.cached.set(language, result); this.presentSource(request.flowId, entry, result);
        if (!nativePriors) await send({ status: "ready", ...result, cacheHit: !generated });
        run.outcome("ready");
      }
    } catch (error) {
      if (nativePriors) {
        retainedNativeSession = false;
        // An older cancelled/failed publication may finish after a newer action has committed into this same context.
        if (publishedNativeResult && entry.cached.get(language) === publishedNativeResult) {
          entry.cached.delete(language);
          if (this.presentedFlowId === request.flowId) { this.dependencies.sourcePresenter?.clear(); this.presentedFlowId = undefined; }
        }
        if (entry.sessions.get(language) === session) entry.sessions.delete(language);
        try { await session.dispose(); } catch (cleanup) {
          error = Object.assign(new FunctionNarrativeError(error instanceof FunctionNarrativeError ? error.code : "failed"), { cause: new AggregateError([error, cleanup], "Native root page rollback failed") });
        }
      }
      const status = getNarrativeSourceFailureStatus(error) ?? (error instanceof FunctionNarrativeError ? error.code : "failed");
      run.outcome(status);
      if (this.contexts.get(request.flowId) === entry && entry.loadSources && (status === "stale" || this.pending === pending && bodyCompleted && !pending.providerCompleted)) {
          await this.invalidateEntry(request.flowId, entry);
          if (this.pending === pending && this.dependencies.isActive(request.graphVersion)) await send({ status, coverage: { ...session.coverage, completed: 0, complete: false, sourceLimited: true } });
          return;
      }
      if (current()) {
        if (status !== "cancelled") entry.reselectModel = true;
        const first = nativePriors ? undefined : await session.readPage(0).catch(() => undefined);
        if (!current()) return;
        const result = first ? this.projectPage(entry, session, first, language) : { coverage: nativePriors ? { ...session.coverage, completed: 0, complete: false } : session.coverage };
        if (first) entry.cached.set(language, result);
        await send({ status, ...result, cacheHit: false });
      }
    } finally {
      try {
        if (nativePriors && !retainedNativeSession) {
          // A late root change has no reader left to notify. Authority stays revoked even if its already-awaited cleanup failed.
          await session.dispose().catch(() => {});
        }
        releaseSource();
      } finally {
        run.interrupted(controller.signal.aborted); if (this.pending === pending) this.pending = undefined; pending.settle();
      }
    }
  }

  /** Fresh acquisition follows source-free preparation; a resumed action must retain its exact original capture. */
  private async acquireSources(entry: ContextEntry, signal: AbortSignal): Promise<ActionSources | undefined> {
    if (!entry.loadSources) return undefined;
    const loaded = await entry.loadSources(signal);
    try {
      if (signal.aborted) throw new FunctionNarrativeError("cancelled");
      if (entry.sourceCaptureSha256 && entry.sourceCaptureSha256 !== loaded.lease.captureSha256) throw new SourceCaptureError("source-changed", "Narrative source snapshot changed");
      await loaded.lease.assertCurrent(signal);
      if (entry.sourceValidation) await entry.sourceValidation.assertCurrent(signal);
      else entry.sourceValidation = loaded.lease.createValidationReceipt();
      entry.context = loaded.context; entry.sourceCaptureSha256 = loaded.lease.captureSha256;
      return loaded;
    } catch (error) { loaded.lease.dispose(); throw error; }
  }

  /** Cancellation wins even if a setup adapter fails to observe its signal; cached pages never call this. */
  private async prepareProvider(provider: FunctionNarrativeProvider, language: "ko" | "en", signal: AbortSignal,
    options?: Parameters<NonNullable<FunctionNarrativeProvider["prepare"]>>[2], awaitCleanup = false): Promise<void> {
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    if (awaitCleanup) return provider.prepare!(language, signal, options);
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
  private disposeEntry(entry: ContextEntry): void { entry.sourceValidation?.dispose(); entry.sourceValidation = undefined; for (const session of entry.sessions.values()) void session.dispose().catch(() => {}); }

  /** Cached reads own no model; changed source revokes all locales before any stale page can be reused. */
  private async validateCache(flowId: string, entry: ContextEntry, language?: "ko" | "en"): Promise<"valid" | "stale" | "inactive"> {
    if (this.contexts.get(flowId) !== entry || !this.dependencies.isActive(entry.graphVersion)) return "inactive";
    const pending = this.pending;
    // The browser can request node details immediately after receiving ready, before the transport Promise returns to this Host.
    if (pending?.publishing && pending.request.flowId === flowId && pending.language === language) await pending.settled;
    if (entry.sourceValidation && pending?.request.flowId === flowId && !pending.providerCompleted && pending.language === language
      && (entry.sessions.get(language!)?.complete || !entry.context.scenarioGraph && entry.cached.has(language!))) await pending.settled;
    if (this.contexts.get(flowId) !== entry) return entry.invalidation && this.dependencies.isActive(entry.graphVersion) ? "stale" : "inactive";
    try {
      await entry.sourceValidation?.assertCurrent(new AbortController().signal);
      return this.contexts.get(flowId) === entry && this.dependencies.isActive(entry.graphVersion) ? "valid" : "inactive";
    } catch {
      if (this.contexts.get(flowId) !== entry || !this.dependencies.isActive(entry.graphVersion)) return "inactive";
      await this.invalidateEntry(flowId, entry);
      return this.dependencies.isActive(entry.graphVersion) ? "stale" : "inactive";
    }
  }

  /** Cache readers may await teardown of a completed action without cancelling it or taking another model slot. */
  private startPending(request: FunctionNarrativesRequest, controller: AbortController, language: "ko" | "en") {
    let settle!: () => void; const settled = new Promise<void>(resolve => { settle = resolve; });
    const pending = { request, controller, language, providerCompleted: false, publishing: false, settled, settle }; this.pending = pending; return pending;
  }

  /** Authority is removed synchronously; the failing action then awaits storage disposal. */
  private invalidateEntry(flowId: string, entry: ContextEntry): Promise<void> {
    if (entry.invalidation) return entry.invalidation;
    if (this.contexts.get(flowId) === entry) this.contexts.delete(flowId);
    if (this.pending?.request.flowId === flowId) this.pending.controller.abort();
    entry.sourceValidation?.dispose(); entry.sourceValidation = undefined; entry.cached.clear();
    const sessions = [...entry.sessions.values()]; entry.sessions.clear();
    if (this.presentedFlowId === flowId) { this.dependencies.sourcePresenter?.clear(); this.presentedFlowId = undefined; }
    // Even a storage cleanup failure cannot restore revoked cache authority.
    entry.invalidation = Promise.allSettled(sessions.map(session => session.dispose())).then(() => {});
    return entry.invalidation;
  }

  /** Decorates only validated output on a Host-captured snapshot; private paths remain on this native boundary. */
  private presentSource(flowId: string, entry: ContextEntry, result: ReadyResult): void {
    if (!entry.sourceHash || !result.narrative || !result.language || !result.modelName) return;
    this.dependencies.sourcePresenter?.show({ filePath: entry.filePath, sourceHash: entry.sourceHash, contextId: entry.contextId,
      functionName: entry.context.functionName, language: result.language, modelName: result.modelName, narrative: result.narrative, snippets: entry.context.snippets,
      ...(result.page ? { scenarioOffset: result.page.offset } : {}) });
    this.presentedFlowId = flowId;
  }
}
