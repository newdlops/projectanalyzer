/**
 * Finite presentation descriptors for Code Flow protocol projections. This
 * module owns localized browser-key selection while leaving graph traversal in
 * codeFlowProjection.
 */

import type { SemanticFlowCoverageGap, SemanticFlowStep } from "../../insights/semanticFlow";
import type { CodeFlowGapPayload, CodeFlowId, CodeFlowPresentationDescriptor, CodeFlowResolution } from "../../protocol/codeFlow";
import type { EdgeConfidence } from "../../shared/types";

/** Returns owned evidence copy while retaining the existing literal fallback. */
export function createSemanticEvidencePresentation(step: SemanticFlowStep): CodeFlowPresentationDescriptor {
  if (step.kind === "route" || step.kind === "operation") return { key: "code-flow-evidence-framework-boundary" };
  if (step.kind === "handler") return { key: `code-flow-evidence-handler-${step.confidence ?? "unresolved"}` as const };
  return createCallEvidencePresentation(step.confidence ?? "unresolved", step.resolution);
}

/** Maps every confidence and resolution pair to finite owned browser copy. */
export function createCallEvidencePresentation(confidence: EdgeConfidence, resolution: CodeFlowResolution): CodeFlowPresentationDescriptor {
  return { key: `code-flow-evidence-call-${confidence}-${resolution}` as const };
}

/** Converts domain coverage gaps into stable, display-safe protocol records. */
export function createSemanticGapPayload(flowId: CodeFlowId, gap: SemanticFlowCoverageGap, index: number): CodeFlowGapPayload {
  return {
    id: `${flowId}:gap:${gap.reason}:${index}`,
    reason: gap.reason,
    label: getGapLabel(gap.reason),
    detail: createGapDetail(gap),
    labelPresentation: { key: getCodeFlowGapLabelKey(gap.reason) },
    codeFlowDetailPresentation: { key: getCodeFlowGapDetailKey(gap.reason), params: createSemanticGapParams(gap) }
  };
}

/** Creates a non-domain gap for arbitrary symbol context. */
export function createBoundGap(flowId: CodeFlowId, reason: CodeFlowGapPayload["reason"], label: string, detail: string, params: Record<string, number>): CodeFlowGapPayload {
  return { id: `${flowId}:gap:${reason}`, reason, label, detail, labelPresentation: { key: getCodeFlowGapLabelKey(reason) }, codeFlowDetailPresentation: { key: getCodeFlowGapDetailKey(reason), params } };
}

function createGapDetail(gap: SemanticFlowCoverageGap): string {
  switch (gap.reason) {
    case "ambiguous": return `${gap.candidateFunctionIds.length} equally trusted handler candidate(s) remain.`;
    case "handlerNotMapped": return "The framework entrypoint is visible, but no unique callable definition is mapped.";
    case "depthLimit": return `${gap.omittedFunctionIds.length} known call target(s) continue beyond depth ${gap.limit ?? "limit"}.`;
    case "stepLimit": return `${gap.omittedFunctionIds.length} known call target(s) were omitted after the step limit.`;
  }
}

function getGapLabel(reason: SemanticFlowCoverageGap["reason"]): string {
  switch (reason) {
    case "ambiguous": return "Handler mapping is ambiguous";
    case "handlerNotMapped": return "Handler definition is unknown";
    case "depthLimit": return "More calls beyond the reading depth";
    case "stepLimit": return "Flow step limit reached";
  }
}

function getCodeFlowGapLabelKey(reason: CodeFlowGapPayload["reason"]): CodeFlowPresentationDescriptor["key"] {
  switch (reason) {
    case "ambiguous": return "code-flow-gap-ambiguous";
    case "handlerNotMapped": return "code-flow-gap-handler-not-mapped";
    case "depthLimit": return "code-flow-gap-depth-limit";
    case "stepLimit": return "code-flow-gap-step-limit";
    case "entrypointNotFound": return "code-flow-gap-entrypoint-not-found";
    case "cycleOrDuplicate": return "code-flow-gap-cycle-or-duplicate";
    default: return "code-flow-gap-ambiguous";
  }
}

function getCodeFlowGapDetailKey(reason: CodeFlowGapPayload["reason"]): CodeFlowPresentationDescriptor["key"] {
  switch (reason) {
    case "ambiguous": return "code-flow-gap-ambiguous-detail";
    case "handlerNotMapped": return "code-flow-gap-handler-not-mapped-detail";
    case "depthLimit": return "code-flow-gap-depth-limit-detail";
    case "stepLimit": return "code-flow-gap-step-limit-detail";
    case "entrypointNotFound": return "code-flow-gap-entrypoint-not-found-detail";
    case "cycleOrDuplicate": return "code-flow-gap-cycle-or-duplicate-detail";
    default: return "code-flow-gap-ambiguous-detail";
  }
}

function createSemanticGapParams(gap: SemanticFlowCoverageGap): Record<string, number> {
  switch (gap.reason) {
    case "ambiguous": return { count: gap.candidateFunctionIds.length };
    case "handlerNotMapped": return {};
    case "depthLimit": return { count: gap.omittedFunctionIds.length, depth: gap.limit ?? 0 };
    case "stepLimit": return { count: gap.omittedFunctionIds.length, limit: gap.limit ?? 0 };
  }
}
