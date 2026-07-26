/**
 * Converts Function Guide application data to JSON-only Webview payloads while
 * reusing the Function Logic projection's opaque block, edge, and binding IDs.
 */

import type {
  FunctionTutorAssignmentTarget,
  FunctionTutorExpression,
  FunctionTutorOperation,
  FunctionTutorStaticValue
} from "../../../analyzer/functionTutor";
import { createContentHash } from "../../../shared/hash";
import type { CodeFlowId } from "../../../protocol/codeFlow";
import type { CodeFlowEvidenceToken } from "../../../protocol/functionLogic";
import type {
  FunctionTutorCodebaseContextPayload,
  FunctionTutorExpressionPayload,
  FunctionTutorGuidePlanPayload,
  FunctionTutorOperationPayload,
  FunctionTutorPayload,
  FunctionTutorStaticValuePayload
} from "../../../protocol/functionTutor";
import type { SourceRange } from "../../../shared/types";
import type { FunctionTutorBuildModel } from "./types";

export type FunctionTutorProjectionContext = {
  flowId: CodeFlowId;
  blockIds: ReadonlyMap<string, string>;
  edgeIds: ReadonlyMap<string, string>;
  bindingIds: ReadonlyMap<string, string>;
  createEvidenceToken(filePath: string, range: SourceRange): CodeFlowEvidenceToken | undefined;
};

/** Projects all Tutor references through snapshot-local opaque identities. */
export function createFunctionTutorPayload(
  model: FunctionTutorBuildModel,
  context: FunctionTutorProjectionContext
): FunctionTutorPayload | undefined {
  const parameterIds = new Map<string, string>();
  for (const parameter of model.declaration.parameters) {
    parameterIds.set(parameter.id, `function-tutor-parameter:${createContentHash(`${context.flowId}\0${parameter.id}`).slice(0, 32)}`);
  }
  const evidenceByToken = new Map<CodeFlowEvidenceToken, FunctionTutorPayload["evidence"][number]>();
  const evidenceTokens = (evidence: { filePath: string; range: SourceRange; kind: string; certainty: "exact" | "inferred" | "unknown"; summary: string }[]) => {
    const tokens: CodeFlowEvidenceToken[] = [];
    for (const item of evidence) {
      const token = context.createEvidenceToken(item.filePath, item.range);
      if (!token) continue;
      tokens.push(token);
      if (!evidenceByToken.has(token)) evidenceByToken.set(token, {
        token,
        kind: item.kind,
        certainty: item.certainty,
        summary: item.summary
      });
    }
    return tokens;
  };
  const gapIds = new Map<string, string>();
  const projectGap = (gap: FunctionTutorBuildModel["gaps"][number], index: number) => {
    const key = `${gap.kind}\0${gap.summary}\0${gap.parameterId ?? ""}\0${gap.blockId ?? ""}`;
    const id = gapIds.get(key) ?? `function-tutor-gap:${createContentHash(`${context.flowId}\0${key}\0${index}`).slice(0, 32)}`;
    gapIds.set(key, id);
    return {
      id,
      kind: gap.kind,
      summary: gap.summary,
      parameterId: gap.parameterId ? parameterIds.get(gap.parameterId) : undefined,
      blockId: gap.blockId ? context.blockIds.get(gap.blockId) : undefined,
      evidenceTokens: evidenceTokens(gap.evidence ?? [])
    };
  };
  const projectedGaps = model.gaps.map(projectGap);
  const projectedContext = projectCodebaseContext(model, context, evidenceTokens);
  const projectedGuide = projectGuidePlan(model, context, evidenceTokens);
  const projectedBlocks = model.declaration.program.blocks.flatMap((block) => {
    const blockId = context.blockIds.get(block.blockId);
    if (!blockId) return [];
    return [{
      blockId,
      kind: block.kind,
      label: block.label,
      operations: block.operations.flatMap((operation) => projectOperation(operation, context.bindingIds)),
      decision: block.decision ? {
        expression: projectExpression(block.decision.expression, context.bindingIds),
        outcomes: block.decision.outcomes.flatMap((outcome) => {
          const edgeId = context.edgeIds.get(outcome.edgeId);
          return edgeId ? [{ edgeId, label: outcome.label, matches: outcome.matches }] : [];
        })
      } : undefined,
      terminal: block.terminal ? {
        kind: block.terminal.kind,
        value: "value" in block.terminal && block.terminal.value
          ? projectExpression(block.terminal.value, context.bindingIds)
          : undefined
      } : undefined,
      embeddedRelation: block.embeddedRelation,
      evidenceTokens: evidenceTokens(block.evidence)
    }];
  });
  const entryBlockId = context.blockIds.get(model.declaration.program.entryBlockId);
  if (!entryBlockId) return undefined;
  return {
    version: 2,
    fingerprint: createContentHash(JSON.stringify({
      functionId: context.flowId,
      documentation: model.context.documentation?.summary,
      guide: projectedGuide.chapters.map((chapter) => [chapter.kind, chapter.facts.map((fact) => fact.id)]),
      parameters: model.declaration.parameters.map((parameter) => [parameter.id, parameter.typeKind]),
      seeds: model.seeds.map((seed) => seed.id),
      blocks: projectedBlocks.map((block) => block.blockId)
    })).slice(0, 32),
    functionId: context.flowId,
    executionKind: model.declaration.executionKind,
    availability: model.availability,
    context: projectedContext,
    guide: projectedGuide,
    parameters: model.declaration.parameters.map((parameter) => ({
      id: parameterIds.get(parameter.id)!,
      bindingId: parameter.bindingId ? context.bindingIds.get(parameter.bindingId) : undefined,
      name: parameter.name,
      index: parameter.index,
      typeKind: parameter.typeKind,
      typeText: parameter.typeText,
      optional: parameter.optional,
      rest: parameter.rest
    })),
    seeds: model.seeds.map((seed) => ({
      id: `function-tutor-seed:${createContentHash(`${context.flowId}\0${seed.id}`).slice(0, 32)}`,
      ordinal: seed.ordinal,
      title: seed.title,
      source: seed.source,
      certainty: seed.certainty,
      inputs: seed.inputs.flatMap((input) => {
        const parameterId = parameterIds.get(input.parameterId);
        return parameterId ? [{
          parameterId,
          value: projectStaticValue(input.value),
          omitted: input.omitted,
          certainty: input.certainty,
          evidenceTokens: evidenceTokens(input.evidence)
        }] : [];
      }),
      objectiveIds: seed.objectiveIds,
      evidenceTokens: evidenceTokens(seed.evidence),
      gapIds: seed.gaps.map((gap, index) => projectGap(gap, index).id)
    })),
    program: {
      entryBlockId,
      blocks: projectedBlocks,
      edges: model.declaration.program.edges.flatMap((edge) => {
        const edgeId = context.edgeIds.get(edge.edgeId);
        const sourceBlockId = context.blockIds.get(edge.sourceBlockId);
        const targetBlockId = context.blockIds.get(edge.targetBlockId);
        return edgeId && sourceBlockId && targetBlockId ? [{
          edgeId,
          sourceBlockId,
          targetBlockId,
          kind: edge.kind,
          label: edge.label,
          certainty: edge.certainty
        }] : [];
      }),
      bindings: model.declaration.program.bindings.flatMap((binding) => {
        const bindingId = context.bindingIds.get(binding.bindingId);
        return bindingId ? [{
          bindingId,
          parameterId: binding.parameterId ? parameterIds.get(binding.parameterId) : undefined,
          name: binding.name,
          kind: binding.kind,
          certainty: binding.certainty
        }] : [];
      })
    },
    evidence: [...evidenceByToken.values()],
    gaps: projectedGaps,
    summary: {
      inferredScenarioCount: model.seeds.length,
      exactCallsiteTupleCount: model.summary.exactCallsiteTupleCount,
      plannedCoverageCount: model.summary.plannedCoverageCount,
      totalObjectiveCount: model.summary.totalObjectiveCount,
      limited: model.summary.limited
    }
  };
}

/** Projects codebase facts through opaque IDs while retaining only bounded display text. */
function projectCodebaseContext(
  model: FunctionTutorBuildModel,
  context: FunctionTutorProjectionContext,
  evidenceTokens: (evidence: { filePath: string; range: SourceRange; kind: string; certainty: "exact" | "inferred" | "unknown"; summary: string }[]) => CodeFlowEvidenceToken[]
): FunctionTutorCodebaseContextPayload {
  const source = model.context;
  return {
    ...(source.documentation ? {
      documentation: {
        kind: source.documentation.kind,
        summary: source.documentation.summary,
        tags: source.documentation.tags.map((tag) => ({ ...tag })),
        truncated: source.documentation.truncated,
        evidenceTokens: evidenceTokens(source.documentation.evidence)
      }
    } : {}),
    owners: source.owners.map((owner) => ({
      id: opaqueTutorIdentity(context, "owner", owner.nodeId),
      kind: owner.kind,
      name: owner.name,
      certainty: owner.certainty,
      evidenceTokens: evidenceTokens(owner.evidence)
    })),
    ...(source.architecture ? {
      architecture: {
        layer: source.architecture.layer,
        confidence: source.architecture.confidence,
        businessLogic: source.architecture.businessLogic,
        conflicted: source.architecture.conflicted,
        alternatives: source.architecture.alternatives.slice(),
        evidence: source.architecture.evidence.map((item) => ({
          summary: item.summary,
          certainty: item.certainty,
          evidenceTokens: evidenceTokens(item.evidence)
        }))
      }
    } : {}),
    entrypoints: source.entrypoints.map((entrypoint) => ({
      id: opaqueTutorIdentity(context, "entrypoint", entrypoint.id),
      kind: entrypoint.kind,
      label: entrypoint.label,
      framework: entrypoint.framework,
      certainty: entrypoint.certainty,
      steps: entrypoint.steps.map((step) => ({
        name: step.name,
        role: step.role,
        resolution: step.resolution,
        certainty: step.certainty,
        evidenceTokens: evidenceTokens(step.evidence)
      })),
      evidenceTokens: evidenceTokens(entrypoint.evidence)
    })),
    callers: source.callers.map((caller) => ({
      id: opaqueTutorIdentity(context, "caller", caller.nodeId),
      name: caller.name,
      qualifiedName: caller.qualifiedName,
      kind: caller.kind,
      callCount: caller.callCount,
      certainty: caller.certainty,
      evidenceTokens: evidenceTokens(caller.evidence)
    })),
    callees: source.callees.map((callee) => ({
      id: opaqueTutorIdentity(context, "callee", callee.nodeId),
      name: callee.name,
      kind: callee.kind,
      relation: callee.relation,
      callCount: callee.callCount,
      certainty: callee.certainty,
      sourceBlockId: callee.sourceBlockId ? context.blockIds.get(callee.sourceBlockId) : undefined,
      evidenceTokens: evidenceTokens(callee.evidence)
    })),
    counts: { ...source.counts }
  };
}

/** Projects five structured questions; graph identities that cannot be mapped are omitted only from actions. */
function projectGuidePlan(
  model: FunctionTutorBuildModel,
  context: FunctionTutorProjectionContext,
  evidenceTokens: (evidence: { filePath: string; range: SourceRange; kind: string; certainty: "exact" | "inferred" | "unknown"; summary: string }[]) => CodeFlowEvidenceToken[]
): FunctionTutorGuidePlanPayload {
  const chapterIds = new Map(model.guide.chapters.map((chapter) => [chapter.id, opaqueTutorIdentity(context, "chapter", chapter.id)]));
  return {
    initialChapterId: chapterIds.get(model.guide.initialChapterId) ?? opaqueTutorIdentity(context, "chapter", model.guide.initialChapterId),
    chapters: model.guide.chapters.map((chapter) => ({
      id: chapterIds.get(chapter.id)!,
      ordinal: chapter.ordinal,
      kind: chapter.kind,
      question: chapter.question,
      status: chapter.status,
      answer: { text: chapter.answer.text, counts: { ...chapter.answer.counts } },
      facts: chapter.facts.map((fact) => ({
        id: opaqueTutorIdentity(context, "fact", fact.id),
        kind: fact.kind,
        label: fact.label,
        detail: fact.detail,
        certainty: fact.certainty,
        blockIds: fact.blockIds.flatMap((id) => context.blockIds.has(id) ? [context.blockIds.get(id)!] : []),
        edgeIds: fact.edgeIds.flatMap((id) => context.edgeIds.has(id) ? [context.edgeIds.get(id)!] : []),
        evidenceTokens: evidenceTokens(fact.evidence)
      })),
      preferredLens: chapter.preferredLens,
      primaryBlockId: chapter.primaryBlockId ? context.blockIds.get(chapter.primaryBlockId) : undefined,
      attentionBlockIds: chapter.attentionBlockIds.flatMap((id) => context.blockIds.has(id) ? [context.blockIds.get(id)!] : []),
      attentionEdgeIds: chapter.attentionEdgeIds.flatMap((id) => context.edgeIds.has(id) ? [context.edgeIds.get(id)!] : []),
      gapIds: []
    })),
    summary: { ...model.guide.summary }
  };
}

/** Hashes analyzer-local identities with the existing opaque flow identity before browser delivery. */
function opaqueTutorIdentity(context: FunctionTutorProjectionContext, kind: string, value: string): string {
  return `function-tutor-${kind}:${createContentHash(`${context.flowId}\0${value}`).slice(0, 32)}`;
}

function projectOperation(
  operation: FunctionTutorOperation,
  bindingIds: ReadonlyMap<string, string>
): FunctionTutorOperationPayload[] {
  if (operation.kind === "define") {
    const bindingId = bindingIds.get(operation.bindingId);
    return bindingId ? [{ kind: "define" as const, bindingId, value: projectExpression(operation.value, bindingIds) }] : [];
  }
  if (operation.kind === "assign") {
    const target = projectTarget(operation.target, bindingIds);
    return target ? [{ kind: "assign" as const, target, value: projectExpression(operation.value, bindingIds), operator: operation.operator }] : [];
  }
  if (operation.kind === "increment") {
    const target = projectTarget(operation.target, bindingIds);
    return target ? [{ kind: "increment" as const, target, delta: operation.delta }] : [];
  }
  return [operation];
}

function projectTarget(target: FunctionTutorAssignmentTarget, bindingIds: ReadonlyMap<string, string>) {
  const bindingId = bindingIds.get(target.bindingId);
  return bindingId ? target.kind === "binding"
    ? { kind: "binding" as const, bindingId }
    : { kind: "member" as const, bindingId, path: target.path ?? [] }
    : undefined;
}

function projectExpression(expression: FunctionTutorExpression, bindingIds: ReadonlyMap<string, string>): FunctionTutorExpressionPayload {
  if (expression.kind === "literal") return { kind: "literal", value: projectStaticValue(expression.value) };
  if (expression.kind === "binding") return bindingIds.has(expression.bindingId)
    ? { kind: "binding", bindingId: bindingIds.get(expression.bindingId)! }
    : { kind: "unsupported", reason: "ambiguous-binding", summary: "A binding is unavailable in this static payload." };
  if (expression.kind === "member") return {
    kind: "member", object: projectExpression(expression.object, bindingIds), path: expression.path, optional: expression.optional
  };
  if (expression.kind === "unary") return { kind: "unary", operator: expression.operator, operand: projectExpression(expression.operand, bindingIds) };
  if (expression.kind === "binary") return { kind: "binary", operator: expression.operator, left: projectExpression(expression.left, bindingIds), right: projectExpression(expression.right, bindingIds) };
  if (expression.kind === "logical") return { kind: "logical", operator: expression.operator, members: expression.members.map((member) => projectExpression(member, bindingIds)) };
  if (expression.kind === "conditional") return { kind: "conditional", condition: projectExpression(expression.condition, bindingIds), whenTrue: projectExpression(expression.whenTrue, bindingIds), whenFalse: projectExpression(expression.whenFalse, bindingIds) };
  if (expression.kind === "array") return { kind: "array", items: expression.items.map((item) => projectExpression(item, bindingIds)) };
  if (expression.kind === "object") return { kind: "object", entries: expression.entries.map((entry) => ({ key: entry.key, value: projectExpression(entry.value, bindingIds) })) };
  return expression;
}

function projectStaticValue(value: FunctionTutorStaticValue): FunctionTutorStaticValuePayload {
  if (value.kind === "array") return { kind: "array", items: value.items.map(projectStaticValue), truncated: value.truncated };
  if (value.kind === "object") return { kind: "object", entries: value.entries.map((entry) => ({ key: entry.key, value: projectStaticValue(entry.value) })), truncated: value.truncated };
  return value;
}
