/** Snapshot-owned call-reading lifecycle: explicit generation, bounded chunks, partial resume and cache-only pages. */
import { buildFunctionCallNarrativePlan, buildFunctionCallNarrativeContext, parseFunctionCallNarrative, type FunctionCallNarrativePlan } from "../../application/functionCallNarratives";
import { createProjectCallableScope } from "../../application/functionCalls";
import type { FunctionNarrativeProvider } from "../../application/functionNarratives";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import type { SymbolNode } from "../../shared/types";
import { createContentHash } from "../../shared/hash";
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionCallNarrativesRequest, FunctionCallNarrativesResponse, FunctionCallReadingEntry } from "../../protocol/functionCallNarratives";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import type { CodeFlowEvidenceToken } from "../../protocol/functionLogic";
import type { WebviewGraphDelivery } from "../sidebarGraphDelivery";
import type { SourceNodeTokenRegistry } from "../sourceNavigation";
import type { CodeFlowEvidenceTokenRegistry } from "../codeFlow";

type Dependencies = {
  graphDelivery: WebviewGraphDelivery; sourceNodeTokens: SourceNodeTokenRegistry; evidenceTokens: CodeFlowEvidenceTokenRegistry;
  provider?: FunctionNarrativeProvider; getLanguage(): "ko" | "en";
  readSourceText(path: string): Promise<string | undefined>;
  postMessage(payload: FunctionCallNarrativesResponse): Promise<void>;
};
type Entry = { contextId: string; node: SymbolNode; source: string; slice: FunctionCallsResponse; lastRequestId: number };
type Reading = { plan: FunctionCallNarrativePlan; calls: FunctionCallReadingEntry[]; summary?: string; flow?: string;
  limitations: string[]; modelName?: string; language: "ko" | "en"; sourceLimited: boolean; hasSummary: boolean;
  calleeEvidence: NonNullable<import("../../shared/functionCallNarratives").FunctionCallNarrativeTask["calleeEvidence"]> };

/** Recent contexts authorize source reads; recent routes retain prose, never a resident model. */
export class FunctionCallNarrativesHostDelivery {
  private readonly contexts = new Map<string, Entry>();
  private readonly readings = new Map<string, Reading>();
  private pending?: { request: FunctionCallNarrativesRequest; controller: AbortController };
  public constructor(private readonly dependencies: Dependencies) {}

  /** Registers only a successfully delivered source snapshot; construction and static loading never invoke LLMs. */
  public register(slice: FunctionCallsResponse, node: SymbolNode, source: string): string | undefined {
    if (!this.dependencies.provider) return undefined;
    const contextId = "call-reading:" + createContentHash(slice.graphVersion + "|" + node.id + "|" + source).slice(0, 32);
    const existing = this.contexts.get(slice.sourceToken);
    if (existing?.contextId === contextId) { existing.slice = slice; return contextId; }
    for (const [key, entry] of this.contexts) if (entry.slice.graphVersion !== slice.graphVersion) this.contexts.delete(key);
    this.contexts.set(slice.sourceToken, { contextId, node, source, slice, lastRequestId: -1 });
    while (this.contexts.size > 32) this.contexts.delete(this.contexts.keys().next().value!);
    return contextId;
  }
  /** Root/disposal invalidation stops model setup and in-flight inference and drops source authority. */
  public clear(): void { this.pending?.controller.abort(); this.pending = undefined; this.contexts.clear(); this.readings.clear(); }
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
      if (cached && (cached.hasSummary || cached.calls.length)) await this.send(request, cached, "ready", true); else await failure("stale");
      return;
    }
    if (request.requestId <= entry.lastRequestId) return;
    entry.lastRequestId = request.requestId;
    if (cached?.hasSummary && cached.calls.length === cached.plan.rows.length) { await this.send(request, cached, "ready", true); return; }
    const provider = this.dependencies.provider;
    if (!provider) { await failure("unavailable"); return; }
    let reading = cached;
    try {
      if (!reading) reading = { plan: buildFunctionCallNarrativePlan(entry.slice, request), calls: [], limitations: [], language, sourceLimited: entry.slice.limited, hasSummary: false, calleeEvidence: [] };
    } catch (error) { await failure(error instanceof FunctionNarrativeError ? error.code : "invalid-response"); return; }
    this.pending?.controller.abort();
    const pending = { request, controller: new AbortController() }; this.pending = pending;
    const signal = pending.controller.signal;
    this.readings.set(key, reading); while (this.readings.size > 8) this.readings.delete(this.readings.keys().next().value!);
    let timedOut = false;
    const ensureActive = () => { if (signal.aborted || this.pending !== pending || !this.active(request, entry)) throw new FunctionNarrativeError("cancelled"); };
    try {
      await provider.prepare?.(language, signal); ensureActive();
      do {
        const offset = reading.calls.length;
        const context = await buildFunctionCallNarrativeContext(entry.node, entry.source, entry.slice, reading.plan, offset, async token => {
          ensureActive(); const node = this.dependencies.sourceNodeTokens.resolve(token as SourceNodeToken);
          const graph = this.dependencies.graphDelivery.current()?.graph;
          if (!node || !graph || !createProjectCallableScope(graph.workspaceRoot)(node)) return undefined;
          const source = node.filePath === entry.node.filePath ? entry.source : await this.dependencies.readSourceText(node.filePath).catch(() => undefined);
          ensureActive(); return source === undefined ? undefined : { node, source };
        }, token => {
          const location = this.dependencies.evidenceTokens.resolve(token as CodeFlowEvidenceToken);
          return location?.filePath === entry.node.filePath ? location.range : undefined;
        });
        const finalSummary = reading.plan.rows.length > 2 && offset === reading.plan.rows.length;
        context.callTask!.includeSummary = reading.plan.rows.length <= 2 || finalSummary;
        if (finalSummary) {
          context.callTask!.calleeEvidence = reading.calleeEvidence;
          context.callTask!.earlierModelReadings = reading.calls.slice(0, 8).map(call => ({ callId: call.callId,
            inputs: call.inputs.slice(0, 100), output: call.output.slice(0, 100), effects: call.effects.slice(0, 100) }));
          context.callTask!.sourceLimited ||= reading.plan.rows.length > 8 || reading.calleeEvidence.some(evidence => evidence.truncated);
          context.limited ||= context.callTask!.sourceLimited;
        }
        ensureActive();
        const timer = setTimeout(() => { timedOut = true; pending.controller.abort(); }, 180000);
        let abort = () => {};
        const cancelled = new Promise<never>((_resolve, reject) => { abort = () => reject(new FunctionNarrativeError(timedOut ? "timeout" : "cancelled")); signal.addEventListener("abort", abort, { once: true }); });
        let response;
        try { response = await Promise.race([provider.generate(context, language, signal), cancelled]); }
        finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
        ensureActive();
        const chunk = parseFunctionCallNarrative(response.text, context, language);
        if (context.callTask!.includeSummary) { reading.summary = chunk.summary; reading.flow = chunk.flow; reading.hasSummary = true; }
        reading.modelName = response.modelName.slice(0, 100); reading.sourceLimited ||= context.limited;
        // Intermediate limitations describe a bounded chunk. The final whole-flow
        // pass replaces them after all callees have contributed source evidence.
        reading.limitations = [...new Set(chunk.limitations)].slice(0, 2);
        for (const target of context.callTask!.targets) {
          const snippet = context.snippets.find(candidate => candidate.id === target.calleeSnippet);
          if (snippet && reading.calleeEvidence.length < 8) reading.calleeEvidence.push({ callId: target.callId, callee: target.callee,
            code: snippet.text.slice(0, 450), truncated: snippet.truncated || snippet.text.length > 450 });
        }
        for (let index = 0; index < chunk.calls.length; index += 1) {
          const row = reading.plan.rows[offset + index], target = entry.slice.nodes.find(node => node.id === row.connection.to);
          const callee = target?.sourceToken && this.dependencies.sourceNodeTokens.resolve(target.sourceToken);
          reading.calls.push({ ...chunk.calls[index], connectionId: row.connection.id, occurrence: row.occurrence,
            expression: row.expression.slice(0, 1200), callee: target?.name ?? "unknown", confidence: row.connection.confidence,
            deferred: row.connection.deferred || row.connection.relation !== "call", callerEvidence: row.connection.evidenceToken,
            calleeEvidence: callee ? this.dependencies.evidenceTokens.createToken(callee.filePath, callee.range) : undefined, calleeSourceToken: target?.sourceToken });
        }
        await this.send(request, reading, reading.hasSummary && reading.calls.length === reading.plan.rows.length ? "ready" : "progress", false);
      } while (!reading.hasSummary || reading.calls.length < reading.plan.rows.length);
    } catch (error) {
      if (this.pending === pending && this.active(request, entry)) {
        const status = timedOut ? "timeout" : signal.aborted ? "cancelled" : error instanceof FunctionNarrativeError ? error.code : "failed";
        if (reading.hasSummary || reading.calls.length) await this.send(request, reading, status, false); else await failure(status);
      }
    } finally { if (this.pending === pending) this.pending = undefined; }
  }
}
