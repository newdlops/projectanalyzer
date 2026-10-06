/** Snapshot-authorized Host boundary for lazy Function Calls neighborhoods; no source execution. */
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { createFunctionCallsSlice, createProjectCallableScope } from "../../application/functionCalls";
import type { FunctionCallsRequest, FunctionCallsResponse } from "../../protocol/functionCalls";
import type { WebviewGraphDelivery } from "../sidebarGraphDelivery";
import type { SourceNodeTokenRegistry } from "../sourceNavigation";
import type { CodeFlowEvidenceTokenRegistry } from "../codeFlow";
import { FunctionCallNarrativesHostDelivery } from "./narrativesHostDelivery";
import type { FunctionNarrativeProvider } from "../../application/functionNarratives";
import type { FunctionCallNarrativesRequest, FunctionCallNarrativesResponse } from "../../protocol/functionCallNarratives";

type Dependencies = {
  graphDelivery: WebviewGraphDelivery; sourceNodeTokens: SourceNodeTokenRegistry; evidenceTokens: CodeFlowEvidenceTokenRegistry;
  readSourceText(filePath: string): Promise<string | undefined>;
  postMessage(payload: FunctionCallsResponse): Promise<void>;
  provider?: FunctionNarrativeProvider; getLanguage?(): "ko" | "en";
  postNarratives?(payload: FunctionCallNarrativesResponse): Promise<void>;
};

/** One bounded request stream per panel session, with late-response invalidation on root changes. */
export class FunctionCallsHostDelivery {
  private generation = 0;
  private lastRequestId = -1;
  private rootSource?: { nodeId: string; text: string };
  private readonly narratives: FunctionCallNarrativesHostDelivery;
  public constructor(private readonly dependencies: Dependencies) {
    this.narratives = new FunctionCallNarrativesHostDelivery({ ...dependencies,
      getLanguage: dependencies.getLanguage ?? (() => "en"), postMessage: dependencies.postNarratives ?? (async () => {}) });
  }
  public explain(request: FunctionCallNarrativesRequest): Promise<void> { return this.narratives.request(request); }
  public cancelExplanation(request: FunctionCallNarrativesRequest): void { this.narratives.cancel(request); }

  /** Retains an explicitly supplied dirty root snapshot without authorizing any new source path. */
  public reset(nodeId?: string, text?: string): void {
    this.narratives.clear();
    this.generation += 1; this.lastRequestId = -1;
    this.rootSource = nodeId && text !== undefined ? { nodeId, text } : undefined;
  }

  /** Resolves only Host-issued callable tokens and returns source-free projected identities. */
  public async load(request: FunctionCallsRequest): Promise<void> {
    const { graphDelivery, sourceNodeTokens, evidenceTokens } = this.dependencies;
    if (request.requestId <= this.lastRequestId) return;
    this.lastRequestId = request.requestId; const generation = this.generation;
    const empty = (status: FunctionCallsResponse["status"]): FunctionCallsResponse => ({ ...request, status, nodes: [], connections: [], omittedCount: 0, limited: true });
    const snapshot = graphDelivery.current(); const node = sourceNodeTokens.resolve(request.sourceToken);
    if (!snapshot || !graphDelivery.matches(request.graphVersion) || !node) { await this.dependencies.postMessage(empty("stale")); return; }
    if (!createProjectCallableScope(snapshot.graph.workspaceRoot)(node)) { await this.dependencies.postMessage(empty("unavailable")); return; }
    let response: FunctionCallsResponse;
    try {
      const source = this.rootSource?.nodeId === node.id ? this.rootSource.text : await this.dependencies.readSourceText(node.filePath);
      response = source === undefined ? empty("unavailable") : createFunctionCallsSlice(snapshot.graph,
        analyzeFunctionLogic({ functionNode: node, sourceText: source, maxBlocks: 512 }), request,
        (id) => sourceNodeTokens.createToken(id), (path, range) => evidenceTokens.createToken(path, range), source);
      if (response.status === "ready" && source !== undefined && generation === this.generation && graphDelivery.matches(request.graphVersion)) {
        const contextId = this.narratives.register(response, node, source);
        response.narratives = { available: Boolean(contextId), ...(contextId ? { contextId } : {}) };
      }
    } catch { response = empty("failed"); }
    if (generation !== this.generation || !graphDelivery.matches(request.graphVersion) || this.lastRequestId !== request.requestId) return;
    await this.dependencies.postMessage(response);
  }
}
