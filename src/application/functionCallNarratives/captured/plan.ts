/** Build complete structural call tasks from one captured parent and its real parser/graph targets, without UI excerpt/guard/diagram clipping. */
import { createFunctionCallContexts, createPythonCallTargetFilter } from "../../../analyzer/functionCalls";
import { createFunctionLogicDrillTargets } from "../../codeFlow";
import { createProjectCallableScope } from "../../functionCalls";
import { extractWholeSourceRange } from "../../narrativeSources";
import { FunctionNarrativeError } from "../../../shared/functionNarratives";
import { SourceCaptureError } from "../../../shared/narrativeSources";
import type { FunctionCallsResponse } from "../../../protocol/functionCalls";
import type { SourceNodeToken } from "../../../protocol/sourceNavigation";
import type { CodeFlowEvidenceToken } from "../../../protocol/functionLogic";
import { buildFunctionCallNarrativeContext } from "../context";
import { buildFunctionCallNarrativePlan } from "../plan";
import type { CapturedFunctionCallPlan, CapturedFunctionCallPlanOptions } from "./types";

/** Enforce a whole-plan budget before any model request; unknown targets remain unresolved rather than disappearing. */
export function createCapturedFunctionCallPlan(options: CapturedFunctionCallPlanOptions): CapturedFunctionCallPlan {
  const { analysis, graph, source, lease } = options, parent = analysis.functionNode;
  const declaration = lease.capture.declarations.find(row => row.id === parent.id);
  if (!declaration || extractWholeSourceRange(source, declaration.range) !== declaration.text) throw new SourceCaptureError("source-changed", "Call source parent changed");
  if (analysis.blocks.length > 512 || analysis.callsites.length > 900 || analysis.gaps.some(gap => /(?:statement|expression|jsx)-limit$/u.test(gap.presentation?.key ?? "")))
    throw new FunctionNarrativeError("context-too-large", "native-call-plan-budget");
  const rootToken = options.createSourceToken(parent.id); if (!rootToken) throw new FunctionNarrativeError("unavailable");
  const accept = createProjectCallableScope(graph.workspaceRoot), byToken = new Map<string, string>();
  const projection = createFunctionLogicDrillTargets(graph, parent, analysis, id => { const token = options.createSourceToken(id); if (token) byToken.set(token, id); return token; }, 100,
    { includeSelf: true, acceptTarget: accept, acceptCallsiteTarget: parent.language === "python" ? createPythonCallTargetFilter(source, graph.workspaceRoot) : undefined });
  if (projection.omittedCalleeCount) throw new FunctionNarrativeError("context-too-large", "native-call-target-budget");
  const targets = new Map(projection.sites.map(row => [row.site, row.target])), nodes: FunctionCallsResponse["nodes"] = [{ id: rootToken, sourceToken: rootToken, name: parent.name, qualifiedName: parent.qualifiedName, resolution: "concrete" }];
  const connections: FunctionCallsResponse["connections"] = [], seen = new Set<string>([rootToken]);
  for (const [index, context] of createFunctionCallContexts(analysis, { sourceText: source, maxDepth: options.maxDepth, preserveWholeSource: true }).entries()) {
    const target = targets.get(context.site), targetId = target?.sourceToken ?? "unknown-call-" + (index + 1), targetNodeId = target && byToken.get(target.sourceToken);
    const targetNode = targetNodeId ? graph.nodes.find(node => node.id === targetNodeId) : undefined;
    if (!seen.has(targetId)) { seen.add(targetId); nodes.push({ id: targetId, name: targetNode?.name ?? context.site.calleeName,
      qualifiedName: targetNode?.qualifiedName ?? context.site.calleeText, ...(target ? { sourceToken: target.sourceToken } : {}), resolution: target ? "concrete" : "unresolved" }); }
    connections.push({ id: "captured-call-" + (index + 1), from: rootToken, to: targetId,
      label: extractWholeSourceRange(source, context.site.range), relation: context.site.relation ?? "call", confidence: target?.confidence ?? "unresolved",
      guards: context.guards, loops: context.loops, deferred: context.deferred,
      limited: context.limited || !target || !targetNodeId || !lease.capture.declarations.some(row => row.id === targetNodeId),
      evidenceToken: options.createEvidenceToken(context.site.filePath, context.site.range) });
  }
  const slice: FunctionCallsResponse = { graphVersion: "captured-action", sourceToken: rootToken, requestId: 0, status: "ready", nodes, connections,
    omittedCount: 0, limited: !lease.capture.complete || connections.some(row => row.limited),
    control: { signature: analysis.signature, blocks: [], unorderedCallIds: connections.map(row => row.id), limited: true } };
  const plan = buildFunctionCallNarrativePlan(slice, { graphVersion: slice.graphVersion, sourceToken: rootToken, requestId: 0, contextId: "captured-action", scope: "overview" });
  // Cache keys are Host-only absolute file identities for this one lease. Every reuse still checks the immutable source snapshot.
  const files = new Map<string, string | undefined>([[parent.filePath, source]]);
  return { count: plan.rows.length, async context(offset, earlier, signal) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= plan.rows.length || earlier.length !== offset) throw new FunctionNarrativeError("invalid-response");
    await lease.assertCurrent(signal);
    const result = await buildFunctionCallNarrativeContext(parent, source, slice, plan, offset, async token => {
      const node = options.resolveSourceToken(token as SourceNodeToken);
      if (!node || !lease.capture.declarations.some(row => row.id === node.id)) return undefined;
      if (!files.has(node.filePath)) files.set(node.filePath, await options.readSourceText(node.filePath, signal));
      await lease.assertCurrent(signal); const text = files.get(node.filePath); return text === undefined ? undefined : { node, source: text };
    }, token => { const location = options.resolveEvidenceToken(token as CodeFlowEvidenceToken); return location?.filePath === parent.filePath ? location.range : undefined; }, lease, options.primarySnippetId);
    result.callTask!.includeSummary = false;
    result.callTask!.earlierModelReadings = earlier.map(({ callId, role, inputs, output, effects, reason }) => ({ callId, role, inputs, output, effects, reason }));
    await lease.assertCurrent(signal); return result;
  } };
}
