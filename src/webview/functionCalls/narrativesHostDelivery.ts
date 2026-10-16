/** Snapshot-owned call-reading lifecycle: explicit generation, bounded chunks, partial resume and cache-only pages. */
import { buildFunctionCallNarrativePlan, buildFunctionCallNarrativeContext, resolveFunctionCallDeclarationRange, parseFunctionCallNarrative, type FunctionCallNarrativePlan } from "../../application/functionCallNarratives";
import { createProjectCallableScope } from "../../application/functionCalls";
import type { FunctionNarrativeProvider } from "../../application/functionNarratives";
import { requestFunctionNarrative } from "../../application/functionNarratives";
import { FunctionNarrativeError, type FunctionCallSourceProofHandle } from "../../shared/functionNarratives";
import type { SourceRange, SymbolNode } from "../../shared/types";
import { createContentHash } from "../../shared/hash";
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionCallNarrativesRequest, FunctionCallNarrativesResponse, FunctionCallReadingEntry } from "../../protocol/functionCallNarratives";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import type { CodeFlowEvidenceToken } from "../../protocol/functionLogic";
import type { WebviewGraphDelivery } from "../sidebarGraphDelivery";
import type { SourceNodeTokenRegistry } from "../sourceNavigation";
import type { CodeFlowEvidenceTokenRegistry } from "../codeFlow";
import { getNarrativeSourceRoots, getNarrativeSourceFailureStatus } from "../../application/narrativeSources";
import { SourceCaptureError, type NarrativeSourceAccess, type NarrativeSourceLease, type NarrativeSourceValidation } from "../../shared/narrativeSources";

type Dependencies = {
  graphDelivery: WebviewGraphDelivery; sourceNodeTokens: SourceNodeTokenRegistry; evidenceTokens: CodeFlowEvidenceTokenRegistry;
  provider?: FunctionNarrativeProvider; getLanguage(): "ko" | "en";
  narrativeSources?: NarrativeSourceAccess;
  readSourceText(path: string): Promise<string | undefined>;
  postMessage(payload: FunctionCallNarrativesResponse): Promise<void>;
};
type Entry = { contextId: string; node: SymbolNode; source: string; slice: FunctionCallsResponse; lastRequestId: number };
type Reading = { contextId: string; plan: FunctionCallNarrativePlan; calls: FunctionCallReadingEntry[]; summary?: string; flow?: string;
  limitations: string[]; modelName?: string; language: "ko" | "en"; sourceLimited: boolean; hasSummary: boolean; allSourceDetails: boolean;
  proofBatches: FunctionCallSourceProofHandle[];
  sourceCaptureSha256?: string;
  sourceValidation?: NarrativeSourceValidation;
  calleeEvidence: NonNullable<import("../../shared/functionCallNarratives").FunctionCallNarrativeTask["calleeEvidence"]> };

/** Recent contexts authorize source reads; recent routes retain prose, never a resident model. */
export class FunctionCallNarrativesHostDelivery {
  private readonly contexts = new Map<string, Entry>();
  private readonly readings = new Map<string, Reading>();
  private pending?: { request: FunctionCallNarrativesRequest; controller: AbortController; language: "ko" | "en"; providerCompleted: boolean; settled: Promise<void>; settle(): void };
  public constructor(private readonly dependencies: Dependencies) {}

  /** Registers only a successfully delivered source snapshot; construction and static loading never invoke LLMs. */
  public register(slice: FunctionCallsResponse, node: SymbolNode, source: string): string | undefined {
    if (!this.dependencies.provider) return undefined;
    const contextId = "call-reading:" + createContentHash(slice.graphVersion + "|" + node.id + "|" + source).slice(0, 32);
    const existing = this.contexts.get(slice.sourceToken);
    if (existing?.contextId === contextId) { existing.slice = slice; return contextId; }
    if (existing) this.revokeContext(slice.sourceToken, existing);
    for (const [key, entry] of this.contexts) if (entry.slice.graphVersion !== slice.graphVersion) this.revokeContext(key, entry);
    this.contexts.set(slice.sourceToken, { contextId, node, source, slice, lastRequestId: -1 });
    while (this.contexts.size > 32) { const key = this.contexts.keys().next().value!; this.revokeContext(key, this.contexts.get(key)!); }
    return contextId;
  }
  /** Root/disposal invalidation stops model setup and in-flight inference and drops source authority. */
  public clear(): void { this.pending?.controller.abort(); this.pending = undefined; this.contexts.clear(); for (const reading of this.readings.values()) reading.sourceValidation?.dispose(); this.readings.clear(); }
  public cancel(request: FunctionCallNarrativesRequest): void {
    const pending = this.pending;
    if (pending && pending.request.graphVersion === request.graphVersion && pending.request.sourceToken === request.sourceToken
      && pending.request.requestId === request.requestId) pending.controller.abort();
  }
  private active(request: FunctionCallNarrativesRequest, entry: Entry): boolean {
    return this.dependencies.graphDelivery.matches(request.graphVersion) && this.contexts.get(request.sourceToken) === entry && request.contextId === entry.contextId;
  }
  private key(request: FunctionCallNarrativesRequest, language: "ko" | "en"): string {
    const choices = [...(request.choices ?? [])].sort((a, b) => a.key.localeCompare(b.key));
    return createContentHash(JSON.stringify([request.graphVersion, request.contextId, request.scope, request.connectionId, choices, language]));
  }
  /** Projects two cached entries; page selection never prepares a model or replaces a running request. */
  private send(request: FunctionCallNarrativesRequest, reading: Reading, status: FunctionCallNarrativesResponse["status"], cacheHit: boolean): Promise<void> {
    const count = Math.max(1, Math.ceil(reading.calls.length / 2)), index = request.pageIndex ?? Math.max(0, count - 1), offset = index * 2;
    if (index >= count) return this.dependencies.postMessage({ ...request, status: "stale" });
    return this.dependencies.postMessage({ ...request, status, language: reading.language, modelName: reading.modelName, cacheHit,
      narrative: { summary: reading.summary, flow: reading.flow, calls: reading.calls.slice(offset, offset + 2), limitations: reading.limitations },
      page: { index, count, offset }, coverage: { completed: reading.calls.length, total: reading.plan.rows.length,
        complete: reading.hasSummary && reading.calls.length === reading.plan.rows.length, sourceLimited: reading.sourceLimited } });
  }

  /** Only a non-page user request generates. Every chunk fixes at most two static callsites/visits. */
  public async request(request: FunctionCallNarrativesRequest): Promise<void> {
    const entry = this.contexts.get(request.sourceToken), language = request.pageLanguage ?? this.dependencies.getLanguage();
    const failure = (status: FunctionCallNarrativesResponse["status"]) => this.dependencies.postMessage({ ...request, status });
    if (!entry || !this.active(request, entry)) { await failure("stale"); return; }
    const key = this.key(request, language), cached = this.readings.get(key);
    if (request.pageIndex !== undefined) {
      if (cached && (cached.hasSummary || cached.calls.length)) {
        if (!await this.validateCache(request, entry, cached)) { if (this.dependencies.graphDelivery.matches(request.graphVersion)) await failure("stale"); return; }
        await this.send(request, cached, "ready", true);
      } else await failure("stale");
      return;
    }
    if (request.requestId <= entry.lastRequestId) return;
    entry.lastRequestId = request.requestId;
    if (cached?.hasSummary && cached.calls.length === cached.plan.rows.length) {
      if (!await this.validateCache(request, entry, cached)) { if (this.dependencies.graphDelivery.matches(request.graphVersion)) await failure("stale"); return; }
      await this.send(request, cached, "ready", true); return;
    }
    const provider = this.dependencies.provider;
    if (!provider) { await failure("unavailable"); return; }
    let reading = cached;
    try {
      if (!reading) reading = { contextId: entry.contextId, plan: buildFunctionCallNarrativePlan(entry.slice, request), calls: [], limitations: [], language,
        sourceLimited: entry.slice.limited, hasSummary: false, allSourceDetails: true, proofBatches: [], calleeEvidence: [] };
    } catch (error) { await failure(error instanceof FunctionNarrativeError ? error.code : "invalid-response"); return; }
    this.pending?.controller.abort();
    let settle!: () => void; const settled = new Promise<void>(resolve => { settle = resolve; });
    const pending = { request, controller: new AbortController(), language, providerCompleted: false, settled, settle }; this.pending = pending;
    const signal = pending.controller.signal;
    this.readings.set(key, reading); while (this.readings.size > 8) { const oldest = this.readings.keys().next().value!; this.readings.get(oldest)?.sourceValidation?.dispose(); this.readings.delete(oldest); }
    const operation = { label: entry.node.name, onProgress: (task: NonNullable<FunctionCallNarrativesResponse["task"]>) => {
      if (this.pending === pending && this.active(request, entry)) void this.dependencies.postMessage({ ...request, status: "working", task }).catch(() => {});
    } };
    const ensureActive = () => { if (signal.aborted || this.pending !== pending || !this.active(request, entry)) throw new FunctionNarrativeError("cancelled"); };
    let sourceLease: NarrativeSourceLease | undefined, bodyCompleted = false;
    try {
      await provider.prepare?.(language, signal, { ...operation, sourceReading: !this.dependencies.narrativeSources }); ensureActive();
      // Retain one model only for this explicit action, across asynchronous
      // source reads/publication. Each chunk still owns its normal FIFO slot.
      const actionReading = reading;
      const analyze = async () => {
        const reading = actionReading;
        const access = this.dependencies.narrativeSources;
        if (access) {
          const graph = this.dependencies.graphDelivery.current()!.graph;
          const rootIds = new Set(getNarrativeSourceRoots(graph, entry.node.id, access.maxDepth));
          for (const row of reading.plan.rows) {
            const target = entry.slice.nodes.find(node => node.id === row.connection.to);
            const node = target?.sourceToken && this.dependencies.sourceNodeTokens.resolve(target.sourceToken);
            if (node) rootIds.add(node.id);
          }
          sourceLease = await access.capture({ graph, rootIds: [...rootIds], signal,
            getCurrentGraph: () => this.dependencies.graphDelivery.current()?.graph });
          ensureActive();
          if (reading.sourceCaptureSha256 && reading.sourceCaptureSha256 !== sourceLease.captureSha256) throw new SourceCaptureError("source-changed", "Call narrative source snapshot changed");
          if (reading.sourceValidation) await reading.sourceValidation.assertCurrent(signal);
          else reading.sourceValidation = sourceLease.createValidationReceipt();
          reading.sourceCaptureSha256 = sourceLease.captureSha256;
        }
        do {
          const offset = reading.calls.length;
          // At most two declarations per chunk. Evidence uses the same immutable
          // source snapshot and parser-owned extent as the actual explanation.
          const calleeRanges = new Map<string, SourceRange>();
          const context = await buildFunctionCallNarrativeContext(entry.node, entry.source, entry.slice, reading.plan, offset, async token => {
            ensureActive(); const node = this.dependencies.sourceNodeTokens.resolve(token as SourceNodeToken);
            const graph = this.dependencies.graphDelivery.current()?.graph;
            if (!node || !graph || !createProjectCallableScope(graph.workspaceRoot)(node)) return undefined;
            const source = node.filePath === entry.node.filePath ? entry.source : access
              ? await access.readFileText(node.filePath, signal) : await this.dependencies.readSourceText(node.filePath).catch(() => undefined);
            ensureActive();
            if (source === undefined) return undefined;
            calleeRanges.set(node.id, resolveFunctionCallDeclarationRange(node, source));
            return { node, source };
          }, token => {
            const location = this.dependencies.evidenceTokens.resolve(token as CodeFlowEvidenceToken);
            return location?.filePath === entry.node.filePath ? location.range : undefined;
          }, sourceLease);
          const finalSummary = reading.plan.rows.length > 2 && offset === reading.plan.rows.length;
          context.callTask!.includeSummary = reading.plan.rows.length <= 2 || finalSummary;
          if (finalSummary) {
            if (reading.allSourceDetails && !context.sourceEvidence) context.sourceCallFlowProof = { inferred: reading.plan.rows.some(row => row.connection.confidence === "inferred"),
              batches: reading.proofBatches };
            context.callTask!.calleeEvidence = reading.calleeEvidence;
            context.callTask!.sourceLimited ||= reading.calleeEvidence.some(evidence => evidence.truncated);
            context.limited ||= context.callTask!.sourceLimited;
          }
          // Every later request receives all six original fields from this action's actual responses.
          context.callTask!.earlierModelReadings = reading.calls.map(({ callId, role, inputs, output, effects, reason }) => ({ callId, role, inputs, output, effects, reason }));
          await sourceLease?.assertCurrent(signal);
          ensureActive();
          let abort = () => {};
          const cancelled = new Promise<never>((_resolve, reject) => { abort = () => reject(new FunctionNarrativeError("cancelled"));
            if (!context.sourceEvidence) signal.addEventListener("abort", abort, { once: true }); });
          let response;
          try {
            const generation = requestFunctionNarrative(provider, context, language, signal, 180000, operation);
            response = context.sourceEvidence ? await generation : await Promise.race([generation, cancelled]);
          }
          finally { signal.removeEventListener("abort", abort); }
          ensureActive();
          const chunk = parseFunctionCallNarrative(response.text, context, language);
          await sourceLease?.assertCurrent(signal); ensureActive();
          if (!context.callTask!.includeSummary && !context.sourceEvidence) {
            const source = context.sourceCallReadings?.read(context, language);
            // Model-authored strings, even with a source-looking model name,
            // cannot authorize a whole-flow recipe without matching the proof.
            reading.allSourceDetails &&= Boolean(source && JSON.stringify(source) === JSON.stringify(chunk));
            if (reading.allSourceDetails && reading.proofBatches.length < 4) {
              const proof = context.sourceCallReadings?.capture?.(context, language);
              if (proof) reading.proofBatches.push(proof);
            }
          }
          if (context.callTask!.includeSummary) { reading.summary = chunk.summary; reading.flow = chunk.flow; reading.hasSummary = true; }
          reading.modelName = response.modelName.slice(0, 100); reading.sourceLimited ||= context.limited;
          // Intermediate limitations describe a bounded chunk. The final whole-flow
          // pass replaces them after all callees have contributed source evidence.
          reading.limitations = [...new Set(chunk.limitations)].slice(0, 2);
          for (const target of context.callTask!.targets) {
            const snippet = context.snippets.find(candidate => candidate.id === target.calleeSnippet);
            if (snippet && (context.sourceEvidence || reading.calleeEvidence.length < 8)) reading.calleeEvidence.push({ callId: target.callId, callee: target.callee,
              code: context.sourceEvidence ? snippet.text : snippet.text.slice(0, 450), truncated: snippet.truncated || !context.sourceEvidence && snippet.text.length > 450 });
          }
          for (let index = 0; index < chunk.calls.length; index += 1) {
            const row = reading.plan.rows[offset + index], target = entry.slice.nodes.find(node => node.id === row.connection.to);
            const callee = target?.sourceToken && this.dependencies.sourceNodeTokens.resolve(target.sourceToken);
            reading.calls.push({ ...chunk.calls[index], connectionId: row.connection.id, occurrence: row.occurrence,
              expression: row.expression, callee: target?.name ?? "unknown", confidence: row.connection.confidence,
              deferred: row.connection.deferred || row.connection.relation !== "call", callerEvidence: row.connection.evidenceToken,
              calleeEvidence: callee ? this.dependencies.evidenceTokens.createToken(callee.filePath, calleeRanges.get(callee.id) ?? callee.range) : undefined, calleeSourceToken: target?.sourceToken });
          }
          if (!reading.hasSummary || reading.calls.length < reading.plan.rows.length) await this.send(request, reading, "progress", false);
        } while (!reading.hasSummary || reading.calls.length < reading.plan.rows.length);
        bodyCompleted = true;
      };
      if (provider.withRun) await provider.withRun(language, signal, analyze); else await analyze();
      pending.providerCompleted = true;
      // A ready response means process/resource cleanup finished too. A cancel
      // or root change during teardown cannot publish a late success.
      await sourceLease?.assertCurrent(signal); ensureActive(); await this.send(request, reading, "ready", false);
    } catch (error) {
      const status = signal.aborted ? "cancelled" : getNarrativeSourceFailureStatus(error) ?? (error instanceof FunctionNarrativeError ? error.code : "failed");
      if (this.contexts.get(request.sourceToken) === entry && this.dependencies.narrativeSources && (status === "stale" || bodyCompleted && !pending.providerCompleted)) {
        this.revokeContext(request.sourceToken, entry); if (this.pending === pending && this.dependencies.graphDelivery.matches(request.graphVersion)) await failure(status); return;
      }
      if (this.pending === pending && this.active(request, entry)) {
        if (reading.hasSummary || reading.calls.length) await this.send(request, reading, status, false); else await failure(status);
      }
    } finally { sourceLease?.dispose(); if (this.pending === pending) this.pending = undefined; pending.settle(); }
  }

  /** Every cached page checks compact source/graph records without preparing a model or recapturing declarations. */
  private async validateCache(request: FunctionCallNarrativesRequest, entry: Entry, reading: Reading): Promise<boolean> {
    const pending = this.pending;
    if (reading.sourceValidation && pending && !pending.providerCompleted && reading.hasSummary && reading.calls.length === reading.plan.rows.length
      && this.key(pending.request, pending.language) === this.key(request, reading.language)) await pending.settled;
    try { await reading.sourceValidation?.assertCurrent(new AbortController().signal); return this.active(request, entry); }
    catch { if (this.contexts.get(request.sourceToken) === entry) this.revokeContext(request.sourceToken, entry); return false; }
  }

  /** A stale declaration revokes every cached scope/locale under its original context. */
  private revokeContext(sourceToken: string, entry: Entry): void {
    if (this.contexts.get(sourceToken) === entry) this.contexts.delete(sourceToken);
    if (this.pending?.request.sourceToken === sourceToken) this.pending.controller.abort();
    for (const [key, reading] of this.readings) if (reading.contextId === entry.contextId) { reading.sourceValidation?.dispose(); this.readings.delete(key); }
  }
}
