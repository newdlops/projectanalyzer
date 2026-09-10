/** Combines parser-owned call contexts with established target resolution and opaque source authority. */
import { createFunctionCallContexts, createPythonCallTargetFilter } from "../../analyzer/functionCalls";
import type { FunctionLogicAnalysis } from "../../analyzer/functionLogic";
import { createFunctionLogicDrillTargets } from "../codeFlow";
import { createSourceDisplayFormatter } from "../sourcePresentation";
import type { FunctionCallsRequest, FunctionCallsResponse, FunctionCallNode, FunctionCallConnection } from "../../protocol/functionCalls";
import type { CodeFlowEvidenceToken } from "../../protocol/functionLogic";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import type { ProjectGraph, SourceRange } from "../../shared/types";
import { createContentHash } from "../../shared/hash";
import { createProjectCallableScope } from "./projectScope";

/** Projects at most 32 project functions/96 sites, retaining distinct calls and their full source conditions. */
export function createFunctionCallsSlice(graph: ProjectGraph, analysis: FunctionLogicAnalysis, request: FunctionCallsRequest,
  sourceToken: (id: string) => SourceNodeToken | undefined,
  evidenceToken: (filePath: string, range: SourceRange) => CodeFlowEvidenceToken | undefined, sourceText?: string): FunctionCallsResponse {
  const node = analysis.functionNode; const display = createSourceDisplayFormatter(graph.workspaceRoot);
  const acceptTarget = createProjectCallableScope(graph.workspaceRoot);
  if (!acceptTarget(node)) return { ...request, status: "unavailable", nodes: [], connections: [], omittedCount: 0, limited: true };
  const root: FunctionCallNode = { id: request.sourceToken, sourceToken: request.sourceToken, name: node.name,
    qualifiedName: node.qualifiedName, sourceLocation: display.location(node.filePath, node.selectionRange), resolution: "concrete" };
  const nodes = new Map<string, FunctionCallNode>([[root.id, root]]); const connections: FunctionCallConnection[] = [];
  const projection = createFunctionLogicDrillTargets(graph, node, analysis, sourceToken, 100, {
    includeSelf: true, acceptTarget,
    acceptCallsiteTarget: node.language === "python" && sourceText !== undefined
      ? createPythonCallTargetFilter(sourceText, graph.workspaceRoot) : undefined
  });
  const targetBySite = new Map(projection.sites.map(({ site, target }) => [site, target]));
  // Filter sites before context/diagram budgets, while retaining the complete CFG:
  // len(items) remains part of a guard even though len itself is not a function node.
  const projectSites = analysis.callsites.filter(site => targetBySite.get(site));
  let omittedCount = Math.max(0, projectSites.length - 96) + projection.omittedCalleeCount;
  // Syntax-owned targets include omitted sites. They must not be counted again
  // as graph-only evidence after the visible-node or callsite budget is reached.
  const represented = new Set(projection.sites.flatMap(({ target }) => target ? [target.sourceToken] : []));
  for (const context of createFunctionCallContexts({ ...analysis, callsites: projectSites }, { sourceText })) {
    const site = context.site; const target = targetBySite.get(site)!;
    const id = "function-call:" + createContentHash([root.id, site.range, site.calleeText, site.relation ?? "call"].map((value) => JSON.stringify(value)).join("|"));
    if (connections.some((connection) => connection.id === id)) continue;
    const to = target.sourceToken;
    if (!nodes.has(to) && nodes.size >= 32) { omittedCount += 1; continue; }
    if (!nodes.has(to)) nodes.set(to, { id: to, name: target.name, qualifiedName: target.qualifiedName,
      sourceToken: target.sourceToken, sourceLocation: target.sourceLocation, resolution: "concrete" });
    connections.push({ id, from: root.id, to, label: site.calleeText.slice(0, 512), relation: site.relation ?? "call",
      confidence: target.confidence, guards: context.guards, loops: context.loops,
      deferred: context.deferred, limited: context.limited,
      sourceLocation: display.location(site.filePath, site.range), evidenceToken: evidenceToken(site.filePath, site.range) });
  }
  // Keep graph-only callable evidence visible without inventing syntax guards.
  for (const target of projection.callees.filter((target) => !represented.has(target.sourceToken))) {
    if ((!nodes.has(target.sourceToken) && nodes.size >= 32) || connections.length >= 96) { omittedCount += target.callsiteCount; continue; }
    const to = target.sourceToken;
    nodes.set(to, { id: to, sourceToken: to, name: target.name, qualifiedName: target.qualifiedName, sourceLocation: target.sourceLocation, resolution: "concrete" });
    connections.push({ id: "function-call:" + createContentHash(root.id + "|" + to), from: root.id, to, label: target.name,
      relation: target.relation ?? "call", confidence: target.confidence, guards: [], loops: [], deferred: target.relation === "event", limited: true });
  }
  return { ...request, status: "ready", nodes: [...nodes.values()], connections, omittedCount,
    limited: analysis.gaps.some((gap) => gap.code !== "dynamicBehavior" && gap.presentation?.key !== "logic-gap-optional-chaining")
      || connections.some(connection => connection.limited) || omittedCount > 0 || projection.omittedCalleeCount > 0 };
}
