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
  FunctionLogicConditionTablePayload,
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
import { createFunctionLogicConditionCaseProjection } from "./conditionCases";
import {
  createFunctionLogicDrillTargets,
  type FunctionLogicSourceTokenFactory
} from "./functionLogicDrillTargets";
import {
  createFunctionTutorPayload,
  type FunctionTutorBuildModel
} from "./functionTutor";

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
  originLimit = DEFAULT_ORIGIN_LIMIT,
  tutorModel?: FunctionTutorBuildModel
): CodeFlowDetailPayload {
  const flowId = createCodeFlowIdentity(deliveryVersion, `function-logic\0${node.id}`);
  const sourceDisplay = createSourceDisplayFormatter(graph.workspaceRoot);
  const protocolBlockIds = new Map<string, string>();
  const protocolEdgeIds = new Map<string, string>();
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
  // Allocate edge identities before case-table projection so all browser
  // references stay opaque even when an analyzer edge cannot be delivered.
  for (let index = 0; index < analysis.edges.length; index += 1) {
    const edge = analysis.edges[index];
    protocolEdgeIds.set(edge.id, createLogicEdgeId(flowId, edge.id, index));
  }
  for (let index = 0; index < (analysis.valueBindings?.length ?? 0); index += 1) {
    const binding = analysis.valueBindings?.[index];
    if (binding) {
      protocolBindingIds.set(binding.id, createLogicBindingId(flowId, binding.id, index));
    }
  }
  const conditionTablesByRootId = createConditionTables(
    analysis,
    protocolBlockIds,
    protocolEdgeIds
  );
  const blocks: FunctionLogicBlockPayload[] = analysis.blocks.map((block, index) => {
    const id = protocolBlockIds.get(block.id)
      ?? createLogicBlockId(flowId, block.id, index);
    return {
      id,
      kind: block.kind,
      label: completeGraphText(block.label, "Source statement"),
      detail: completeGraphText(block.detail, "Static source operation."),
      presentation: block.presentation ?? createFunctionLogicBlockPresentation(block),
      embeddedPresentationKind: block.embeddedPresentationKind,
      depth: Math.max(0, block.depth),
      parentBlockId: block.parentBlockId
        ? protocolBlockIds.get(block.parentBlockId)
        : undefined,
      branchLabel: block.branchLabel
        ? completeGraphText(block.branchLabel, "branch")
        : undefined,
      branchPresentation: block.branchPresentation,
      confidence: block.confidence,
      sourceLocation: sourceDisplay.location(block.filePath, block.range),
      evidenceToken: createEvidenceToken(block.filePath, block.range),
      conditionTable: conditionTablesByRootId.get(block.id),
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
          id: protocolEdgeIds.get(edge.id) ?? createLogicEdgeId(flowId, edge.id, index),
          sourceId,
          targetId,
          kind: edge.kind,
          label: edge.label ? safeText(edge.label, edge.kind) : undefined,
          presentation: edge.presentation ?? createFunctionLogicEdgePresentation(edge.kind),
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
  const tutor = tutorModel ? createFunctionTutorPayload(tutorModel, {
    flowId,
    blockIds: protocolBlockIds,
    edgeIds: protocolEdgeIds,
    bindingIds: protocolBindingIds,
    createEvidenceToken
  }) : undefined;

  return {
    graphVersion: deliveryVersion,
    id: flowId,
    kind: "functionLogic",
    title: completeGraphText(node.qualifiedName || node.name, "Anonymous callable"),
    // The path is source-derived and remains literal. Its owned wrapper is a
    // stable semantic marker so retained Webviews can switch language in place.
    subtitle: location ?? "",
    subtitlePresentation: "functionLogic",
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
      omittedCalleeCount: drillProjection.omittedCalleeCount,
      ...(tutor ? { tutor } : {})
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

/**
 * Supplies finite browser copy for every analyzer block while preserving source
 * labels/details as inert primitive parameters. Language adapters can override
 * this default through `block.presentation` without changing graph identity.
 */
function createFunctionLogicBlockPresentation(
  block: FunctionLogicAnalysis["blocks"][number]
): NonNullable<FunctionLogicBlockPayload["presentation"]> {
  const kind = block.kind;
  return {
    labelKey: `logic-block-label-${kind}`,
    labelParams: { source: completeGraphText(block.label, "") },
    detailKey: `logic-block-detail-${kind}`,
    detailParams: undefined
  };
}

/** Supplies a stable localized descriptor for each analyzer edge vocabulary. */
function createFunctionLogicEdgePresentation(
  kind: FunctionLogicAnalysis["edges"][number]["kind"]
): NonNullable<FunctionLogicEdgePayload["presentation"]> {
  return { key: `logic-edge-${kind}` };
}

/**
 * Converts parser-owned short-circuit paths into browser-safe condition tables.
 * Raw analyzer identities are resolved only through the maps created for this
 * snapshot, so table selection cannot address a different source graph.
 */
function createConditionTables(
  analysis: FunctionLogicAnalysis,
  protocolBlockIds: ReadonlyMap<string, string>,
  protocolEdgeIds: ReadonlyMap<string, string>
): ReadonlyMap<string, FunctionLogicConditionTablePayload> {
  const tablesByRootId = new Map<string, FunctionLogicConditionTablePayload>();
  const blocksById = new Map(analysis.blocks.map((block) => [block.id, block]));
  for (const root of analysis.blocks) {
    if (!root.condition?.root) {
      continue;
    }
    const projected = createFunctionLogicConditionCaseProjection(
      analysis.blocks,
      analysis.edges,
      root.id
    );
    if (!projected) {
      continue;
    }
    const columns = projected.columns.flatMap((column) => {
      const blockId = protocolBlockIds.get(column.blockId);
      return blockId ? [{
        blockId,
        expression: completeGraphText(column.expression, "condition")
      }] : [];
    });
    // Do not publish a partially addressable table. A missing projected member
    // means that the corresponding analyzer case cannot be selected safely.
    if (columns.length !== projected.columns.length) {
      continue;
    }
    const rows = projected.rows.flatMap((row) => {
      const targetBlockId = protocolBlockIds.get(row.targetBlockId);
      const target = blocksById.get(row.targetBlockId);
      const choiceEdgeIds = row.choiceEdgeIds.flatMap((edgeId) => {
        const projectedEdgeId = protocolEdgeIds.get(edgeId);
        return projectedEdgeId ? [projectedEdgeId] : [];
      });
      return targetBlockId && target && choiceEdgeIds.length === row.choiceEdgeIds.length
        ? [{
            id: `function-logic-condition-case:${createContentHash(`${root.id}\0${row.id}`).slice(0, 32)}`,
            values: row.values,
            result: row.result,
            choiceEdgeIds,
            targetBlockId,
            targetLabel: completeGraphText(target.label, "Next block")
          }]
        : [];
    });
    if (rows.length !== projected.rows.length) {
      continue;
    }
    tablesByRootId.set(root.id, {
      expression: completeGraphText(
        root.condition.groupExpression ?? root.condition.expression,
        "condition"
      ),
      columns,
      rows,
      omittedCaseCount: projected.omittedCaseCount
    });
  }
  return tablesByRootId;
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
  const presentation = gap.code === "languageUnsupported"
    ? "languageUnsupported"
    : gap.code === "sourceUnavailable"
      ? "sourceUnavailable"
      : gap.code === "functionNotFound"
        ? "functionBodyNotFound"
        : gap.code === "dynamicBehavior"
          ? "runtimeUnknown"
          : "expressionCollapsed";
  return {
    id: `${flowId}:gap:${reason}:${index}`,
    reason,
    // Analyzer diagnostic text is an external/source literal. The owned title
    // is transported as a semantic key and localized only in the browser.
    label: "",
    detail: safeText(gap.message, ""),
    presentation,
    detailPresentation: gap.presentation
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

/** Preserves complete graph semantics and source-authored physical line breaks. */
function completeGraphText(value: string, fallback: string): string {
  return value.replace(/\r\n?/gu, "\n").trim() || fallback;
}
