/**
 * Function Explorer projection for bounded change-impact analysis.
 *
 * The adapter keeps reverse-call evidence in JSON metadata and exposes only
 * real graph symbol identities for navigation. It deliberately does not invent
 * edge paths because the domain result currently carries function paths only.
 */

import type { ChangeImpactAnalysis, ChangeImpactDiagnostic } from "../../insights/changeImpact";
import type { FunctionExplorerRow } from "../../protocol/functionExplorer";
import type { ProjectGraph, SymbolNode } from "../../shared/types";

/** Stable Function Explorer root for the selected callable's impact summary. */
export const CHANGE_IMPACT_ROWS_ROOT_ID = "function-flows:selected";

/** Projects one selected callable's affected request flows and limit notices. */
export function createChangeImpactRows(
  graph: ProjectGraph,
  analysis: ChangeImpactAnalysis
): FunctionExplorerRow[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const targetNode = nodesById.get(analysis.targetFunctionId);
  const rows: FunctionExplorerRow[] = [createSummaryRow(analysis, targetNode)];

  for (const flow of analysis.affectedFlows) {
    rows.push(createAffectedEntrypointRow(flow, nodesById.get(flow.handlerFunctionId)));
  }

  for (let index = 0; index < analysis.diagnostics.length; index += 1) {
    rows.push(createDiagnosticRow(analysis.diagnostics[index], index));
  }

  return rows;
}

/** Creates the selected section summary and source-navigation anchor. */
function createSummaryRow(
  analysis: ChangeImpactAnalysis,
  targetNode: SymbolNode | undefined
): FunctionExplorerRow {
  const targetLabel = targetNode?.qualifiedName ?? targetNode?.name ?? analysis.targetFunctionId;

  return {
    id: CHANGE_IMPACT_ROWS_ROOT_ID,
    sectionId: "selected",
    kind: "section",
    label: `Affected Request Flows · ${targetLabel}`,
    depth: 0,
    hasChildren: false,
    expanded: false,
    functionId: analysis.targetFound ? analysis.targetFunctionId : undefined,
    symbolId: targetNode?.id,
    detail: createSummaryDetail(analysis),
    filePath: targetNode?.filePath,
    range: targetNode?.range,
    confidence: analysis.summary.truncated ? "unresolved" : undefined,
    metadata: {
      affectedFlowCount: analysis.summary.affectedFlowCount,
      callerCount: analysis.summary.callerCount,
      directCallerCount: analysis.summary.directCallerCount,
      indirectCallerCount: analysis.summary.indirectCallerCount,
      legacyKind: "semantic",
      name: targetLabel,
      targetFound: analysis.targetFound,
      targetFunctionId: analysis.targetFunctionId,
      truncated: analysis.summary.truncated
    }
  };
}

/** Creates one flat, handler-navigable affected entrypoint row. */
function createAffectedEntrypointRow(
  flow: ChangeImpactAnalysis["affectedFlows"][number],
  handlerNode: SymbolNode | undefined
): FunctionExplorerRow {
  const confidence = flow.confidence ?? "unresolved";

  return {
    id: `${CHANGE_IMPACT_ROWS_ROOT_ID}:flow:${encodeURIComponent(flow.flowId)}`,
    sectionId: "selected",
    kind: "relation",
    label: flow.name,
    depth: 1,
    parentId: CHANGE_IMPACT_ROWS_ROOT_ID,
    hasChildren: false,
    expanded: false,
    functionId: flow.handlerFunctionId,
    symbolId: handlerNode?.id,
    relation: "entrypointPath",
    detail: `${flow.framework} · ${formatImpactDepth(flow.impactDepth)} · ${confidence}`,
    filePath: handlerNode?.filePath,
    range: handlerNode?.range,
    functionKind: handlerNode ? "handler" : undefined,
    role: flow.entrypointKind === "graphqlOperation" ? "resolver" : "routeHandler",
    tags: ["frameworkDispatch"],
    confidence,
    metadata: {
      confidence: flow.confidence ?? null,
      flowId: flow.flowId,
      entrypointKind: flow.entrypointKind,
      entrypointUnitId: flow.entrypointUnitId,
      framework: flow.framework,
      handlerFunctionId: flow.handlerFunctionId,
      impactDepth: flow.impactDepth,
      legacyKind: "semantic",
      name: flow.name,
      pathFunctionIds: flow.pathFunctionIds,
      routeUnitId: flow.routeUnitId ?? null
    }
  };
}

/** Creates one visible explanation for a bounded reverse-traversal frontier. */
function createDiagnosticRow(
  diagnostic: ChangeImpactDiagnostic,
  index: number
): FunctionExplorerRow {
  return {
    id:
      `${CHANGE_IMPACT_ROWS_ROOT_ID}:diagnostic:${diagnostic.reason}:` +
      `${encodeURIComponent(diagnostic.sourceFunctionId)}:${index}`,
    sectionId: "selected",
    kind: "diagnostic",
    label: diagnostic.reason === "depthLimit" ? "Impact depth limit reached" : "Impact step limit reached",
    depth: 1,
    parentId: CHANGE_IMPACT_ROWS_ROOT_ID,
    hasChildren: false,
    expanded: false,
    detail: diagnostic.message,
    confidence: "unresolved",
    metadata: {
      legacyKind: "diagnostic",
      limit: diagnostic.limit,
      name: diagnostic.reason,
      omittedFunctionIds: diagnostic.omittedFunctionIds,
      reason: diagnostic.reason,
      sourceFunctionId: diagnostic.sourceFunctionId
    }
  };
}

/** Formats bounded analysis counters for the selected section root. */
function createSummaryDetail(analysis: ChangeImpactAnalysis): string {
  const suffix = analysis.summary.truncated ? " / limited" : "";

  return (
    `${analysis.summary.affectedFlowCount} affected entrypoints / ` +
    `${analysis.summary.directCallerCount} direct + ` +
    `${analysis.summary.indirectCallerCount} indirect callers${suffix}`
  );
}

/** Formats handler-to-target distance without implying an unavailable edge path. */
function formatImpactDepth(depth: number): string {
  return depth === 0 ? "selected handler" : `${depth} call${depth === 1 ? "" : "s"} to change`;
}
