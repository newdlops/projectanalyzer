/** Snapshot-local Summary projection; analyzer paths, ranges and IDs never enter this payload. */
import { createContentHash } from "../../../../shared/hash";
import type { CodeFlowEvidenceToken } from "../../../../protocol/functionLogic";
import type { FunctionTutorBehaviorSummaryItemPayload, FunctionTutorBehaviorSummaryPayload } from "../../../../protocol/functionTutor";
import type { FunctionTutorEvidence } from "../../../../analyzer/functionTutor";
import type { FunctionTutorProjectionContext } from "../functionTutorProjection";
import type { FunctionBehaviorSummary, FunctionBehaviorSummaryItem } from "./types";

/** Projects bounded facts through the same active graph maps and evidence registry as the Guide. */
export function projectFunctionBehaviorSummary(
  summary: FunctionBehaviorSummary | undefined,
  context: FunctionTutorProjectionContext,
  evidenceTokens: (evidence: FunctionTutorEvidence[]) => CodeFlowEvidenceToken[]
): FunctionTutorBehaviorSummaryPayload | undefined {
  if (!summary) return undefined;
  const opaque = (id: string) => `function-tutor-summary:${createContentHash(`${context.flowId}\0${id}`).slice(0, 32)}`;
  const blockIds = (ids: string[]) => [...new Set(ids.flatMap((id) => context.blockIds.get(id) ?? []))].slice(0, 24);
  const edgeIds = (ids: string[]) => [...new Set(ids.flatMap((id) => context.edgeIds.get(id) ?? []))].slice(0, 24);
  const tokens = (evidence: FunctionTutorEvidence[]) => [...new Set(evidenceTokens(evidence.slice(0, 8)))].slice(0, 8);
  const project = (item: FunctionBehaviorSummaryItem): FunctionTutorBehaviorSummaryItemPayload => ({
    id: opaque(item.id), kind: item.kind, sourcePreview: item.sourcePreview.slice(0, 240), presentationKey: item.presentationKey,
    presentationParams: item.presentationParams, certainty: item.certainty, scope: item.scope,
    conditions: item.conditions.slice(0, 8).flatMap((guard) => {
      const blockId = context.blockIds.get(guard.blockId); const edgeId = context.edgeIds.get(guard.edgeId);
      return blockId && edgeId ? [{ blockId, edgeId, outcome: guard.outcome, sourcePreview: guard.sourcePreview.slice(0, 240) }] : [];
    }),
    blockIds: blockIds(item.blockIds), edgeIds: edgeIds(item.edgeIds), evidenceTokens: tokens(item.evidence),
    alternatives: item.alternatives?.slice(0, 8).flatMap((branch) => {
      const edgeId = context.edgeIds.get(branch.edgeId);
      return edgeId ? [{ edgeId, outcome: branch.outcome, sourcePreview: branch.sourcePreview.slice(0, 240), blockIds: blockIds(branch.blockIds) }] : [];
    })
  });
  return {
    schema: 1, status: summary.status,
    purpose: { basis: summary.purpose.basis, sourcePreview: summary.purpose.sourcePreview?.slice(0, 480), presentationKey: summary.purpose.presentationKey, presentationParams: summary.purpose.presentationParams, certainty: summary.purpose.certainty, evidenceTokens: tokens(summary.purpose.evidence) },
    inputs: summary.inputs.slice(0, 8).map((input) => ({ ...project(input), name: input.name.slice(0, 240), typeText: input.typeText?.slice(0, 240), defaultText: input.defaultText?.slice(0, 240), optional: input.optional, rest: input.rest })),
    outcomes: summary.outcomes.slice(0, 8).map(project), steps: summary.steps.slice(0, 5).map(project), impacts: summary.impacts.slice(0, 8).map(project),
    gaps: summary.gaps.slice(0, 8).map((gap) => ({ id: opaque(gap.id), presentationKey: gap.presentationKey, presentationParams: gap.presentationParams, sourcePreview: gap.sourcePreview?.slice(0, 240), blockIds: blockIds(gap.blockIds), evidenceTokens: tokens(gap.evidence) })),
    omittedCounts: { ...summary.omittedCounts }, limited: summary.limited
  };
}
