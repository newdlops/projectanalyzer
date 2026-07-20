/**
 * Pure application projection for a selected function's internal logic. It
 * converts analyzer ranges into opaque evidence tokens, maps entrypoint origins,
 * and keeps raw graph/source identities out of the Webview protocol.
 */

import type { FunctionLogicAnalysis, FunctionLogicGap } from "../../analyzer/functionLogic";
import type { SemanticFlowIndex } from "../../insights/semanticFlow";
import type {
  CodeFlowDetailPayload,
  CodeFlowGapPayload,
  CodeFlowId
} from "../../protocol/codeFlow";
import type {
  CodeFlowEvidenceToken,
  FunctionLogicBlockPayload,
  FunctionLogicEdgePayload,
  FunctionLogicValueBindingPayload,
  FunctionLogicValueFlowPayload
} from "../../protocol/functionLogic";
import { createContentHash } from "../../shared/hash";
import type { ProjectGraph, SourceRange, SymbolNode } from "../../shared/types";
import { createSourceDisplayFormatter } from "../sourcePresentation";
import {
  compareCodeFlowCatalogItems,
  createCodeFlowCatalogItem
} from "./codeFlowCatalog";
import { createCodeFlowIdentity } from "./codeFlowIdentity";
import { createFunctionLogicGraphLayout } from "./functionLogicGraphLayout";
import {
  createFunctionLogicDrillTargets,
  type FunctionLogicSourceTokenFactory
} from "./functionLogicDrillTargets";

const DEFAULT_ORIGIN_LIMIT = 5;
const DISPLAY_TEXT_LIMIT = 180;

/** Host callback replacing an exact source range with snapshot-local authority. */
export type CodeFlowEvidenceTokenFactory = (
  filePath: string,
  range: SourceRange
) => CodeFlowEvidenceToken | undefined;

/** Projects syntax-backed blocks as the primary selected-function experience. */
export function createFunctionLogicCodeFlowDetail(
  graph: ProjectGraph,
  semanticFlows: SemanticFlowIndex,
  node: SymbolNode,
  analysis: FunctionLogicAnalysis,
  deliveryVersion: string,
  createEvidenceToken: CodeFlowEvidenceTokenFactory,
  createSourceToken: FunctionLogicSourceTokenFactory,
  originLimit = DEFAULT_ORIGIN_LIMIT
): CodeFlowDetailPayload {
  const flowId = createCodeFlowIdentity(deliveryVersion, `function-logic\0${node.id}`);
  const sourceDisplay = createSourceDisplayFormatter(graph.workspaceRoot);
  const protocolBlockIds = new Map<string, string>();
  const protocolBindingIds = new Map<string, string>();
  const drillProjection = createFunctionLogicDrillTargets(
    graph,
    node,
    analysis,
    createSourceToken
  );
  // Populate every opaque identity before resolving structural parents. This
  // keeps the projection correct even if analyzer block ordering changes.
  for (let index = 0; index < analysis.blocks.length; index += 1) {
    const block = analysis.blocks[index];
    protocolBlockIds.set(block.id, createLogicBlockId(flowId, block.id, index));
  }
  for (let index = 0; index < (analysis.valueBindings?.length ?? 0); index += 1) {
    const binding = analysis.valueBindings?.[index];
    if (binding) {
      protocolBindingIds.set(binding.id, createLogicBindingId(flowId, binding.id, index));
    }
  }
  const blocks: FunctionLogicBlockPayload[] = analysis.blocks.map((block, index) => {
    const id = protocolBlockIds.get(block.id)
      ?? createLogicBlockId(flowId, block.id, index);
    return {
      id,
      kind: block.kind,
      label: completeGraphText(block.label, "Source statement"),
      detail: completeGraphText(block.detail, "Static source operation."),
      depth: Math.max(0, block.depth),
      parentBlockId: block.parentBlockId
        ? protocolBlockIds.get(block.parentBlockId)
        : undefined,
      branchLabel: block.branchLabel
        ? completeGraphText(block.branchLabel, "branch")
        : undefined,
      confidence: block.confidence,
      sourceLocation: sourceDisplay.location(block.filePath, block.range),
      evidenceToken: createEvidenceToken(block.filePath, block.range),
      drillTargets: drillProjection.targetsByBlockId.get(block.id),
      valueChanges: block.valueChanges?.map((change) => ({
        target: completeGraphText(change.target, "value"),
        targetKind: change.targetKind,
        operation: change.operation,
        operator: completeGraphText(change.operator, "changes"),
        value: change.value ? completeGraphText(change.value, "value") : undefined,
        confidence: change.confidence
      })),
      valueAccesses: block.valueAccesses?.flatMap((access) => {
        const bindingId = protocolBindingIds.get(access.bindingId);
        return bindingId
          ? [{
              bindingId,
              name: completeGraphText(access.name, "value"),
              bindingKind: access.bindingKind,
              access: access.access,
              ...(access.usage ? { usage: access.usage } : {}),
              confidence: access.confidence,
              ...(access.valueRole ? { valueRole: access.valueRole } : {})
            }]
          : [];
      })
    };
  });
  const edges: FunctionLogicEdgePayload[] = analysis.edges.flatMap((edge, index) => {
    const sourceId = protocolBlockIds.get(edge.sourceId);
    const targetId = protocolBlockIds.get(edge.targetId);
    return sourceId && targetId
      ? [{
          id: createLogicEdgeId(flowId, edge.id, index),
          sourceId,
          targetId,
          kind: edge.kind,
          label: edge.label ? safeText(edge.label, edge.kind) : undefined,
          confidence: edge.confidence
        }]
      : [];
  });
  const originFlows = semanticFlows.flows.filter((flow) =>
    flow.steps.some((step) => step.functionId === node.id)
  );
  const origins = originFlows
    .map((flow) => createCodeFlowCatalogItem(
      flow,
      deliveryVersion,
      sourceDisplay.path(flow.rootPath)
    ))
    .sort(compareCodeFlowCatalogItems)
    .slice(0, normalizeOriginLimit(originLimit));
  const gaps = analysis.gaps.map((gap, index) => createLogicGap(flowId, gap, index));
  const location = sourceDisplay.location(node.filePath, node.selectionRange);
  const valueBindings: FunctionLogicValueBindingPayload[] =
    analysis.valueBindings?.flatMap((binding) => {
      const id = protocolBindingIds.get(binding.id);
      const definitionBlockId = protocolBlockIds.get(binding.definitionBlockId);
      return id && definitionBlockId
        ? [{
            id,
            name: completeGraphText(binding.name, "value"),
            kind: binding.kind,
            definitionBlockId,
            confidence: binding.confidence,
            ...(binding.valueRole ? { valueRole: binding.valueRole } : {})
          }]
        : [];
    }) ?? [];
  const valueFlows: FunctionLogicValueFlowPayload[] = analysis.valueFlows?.flatMap(
    (valueFlow, index) => {
      const bindingId = protocolBindingIds.get(valueFlow.bindingId);
      const sourceBlockId = protocolBlockIds.get(valueFlow.sourceBlockId);
      const targetBlockId = protocolBlockIds.get(valueFlow.targetBlockId);
      return bindingId && sourceBlockId && targetBlockId
        ? [{
            id: createLogicValueFlowId(flowId, valueFlow.id, index),
            bindingId,
            sourceBlockId,
            targetBlockId,
            targetAccess: valueFlow.targetAccess,
            ...(valueFlow.targetUsage ? { targetUsage: valueFlow.targetUsage } : {}),
            confidence: valueFlow.confidence
          }]
        : [];
    }
  ) ?? [];

  return {
    graphVersion: deliveryVersion,
    id: flowId,
    kind: "functionLogic",
    title: completeGraphText(node.qualifiedName || node.name, "Anonymous callable"),
    subtitle: location ? `Function logic · ${location}` : "Function logic",
    semantics: "static",
    focusStepId: blocks[0]?.id,
    steps: [],
    logic: {
      language: analysis.language,
      signature: completeGraphText(analysis.signature, node.name || "Function body"),
      blocks,
      edges,
      valueBindings,
      valueFlows,
      layout: createFunctionLogicGraphLayout(blocks, edges),
      summary: analysis.summary,
      callees: drillProjection.callees,
      omittedCalleeCount: drillProjection.omittedCalleeCount
    },
    origins,
    gaps,
    summary: {
      stepCount: blocks.length,
      concreteStepCount: blocks.length,
      decisionStepCount: analysis.summary.branchCount + analysis.summary.loopCount,
      effectStepCount: analysis.summary.effectCount + analysis.summary.mutationCount,
      unknownStepCount: blocks.filter((block) => block.kind === "unknown").length,
      gapCount: gaps.length
    }
  };
}

/** Maps analyzer gap codes onto stable browser-facing reasons. */
function createLogicGap(
  flowId: CodeFlowId,
  gap: FunctionLogicGap,
  index: number
): CodeFlowGapPayload {
  const reason = gap.code === "languageUnsupported"
    ? "languageUnsupported"
    : gap.code === "sourceUnavailable"
      ? "sourceUnavailable"
      : gap.code === "functionNotFound"
        ? "functionBodyNotFound"
        : "analysisLimitation";
  const label = gap.code === "languageUnsupported"
    ? "Language logic parser unavailable"
    : gap.code === "sourceUnavailable"
      ? "Current source unavailable"
      : gap.code === "functionNotFound"
        ? "Function body changed"
        : gap.code === "dynamicBehavior"
          ? "Runtime behavior remains unknown"
          : "Expression detail remains collapsed";
  return {
    id: `${flowId}:gap:${reason}:${index}`,
    reason,
    label,
    detail: safeText(gap.message, "Function logic analysis is incomplete.")
  };
}

/** Creates a browser-local identity without serializing analyzer block IDs. */
function createLogicBlockId(flowId: CodeFlowId, blockId: string, index: number): string {
  return `function-logic-block:${createContentHash(`${flowId}\0${blockId}\0${index}`).slice(0, 32)}`;
}

/** Creates a browser-local edge identity linked only to projected block IDs. */
function createLogicEdgeId(flowId: CodeFlowId, edgeId: string, index: number): string {
  return `function-logic-edge:${createContentHash(`${flowId}\0${edgeId}\0${index}`).slice(0, 32)}`;
}

/** Creates a browser-local binding identity without exposing analyzer keys. */
function createLogicBindingId(flowId: CodeFlowId, bindingId: string, index: number): string {
  return `function-logic-binding:${createContentHash(`${flowId}\0${bindingId}\0${index}`).slice(0, 32)}`;
}

/** Creates a browser-local value-flow edge identity. */
function createLogicValueFlowId(flowId: CodeFlowId, valueFlowId: string, index: number): string {
  return `function-logic-value-flow:${createContentHash(`${flowId}\0${valueFlowId}\0${index}`).slice(0, 32)}`;
}

/** Bounds origin chips against accidental caller-provided extremes. */
function normalizeOriginLimit(value: number): number {
  return Number.isFinite(value) ? Math.min(20, Math.max(0, Math.floor(value))) : DEFAULT_ORIGIN_LIMIT;
}

/** Bounds analyzer text before it reaches the narrow Activity Bar surface. */
function safeText(value: string, fallback: string): string {
  const normalized = value.trim() || fallback;
  return normalized.length <= DISPLAY_TEXT_LIMIT
    ? normalized
    : `${normalized.slice(0, DISPLAY_TEXT_LIMIT - 1)}…`;
}

/** Preserves complete graph semantics while normalizing source whitespace. */
function completeGraphText(value: string, fallback: string): string {
  return value.replace(/\s+/gu, " ").trim() || fallback;
}
