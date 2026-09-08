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
import { projectFrameworkBehavior } from "./frameworkBehaviorProjection";

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
  // Host-only source locations are converted into one opaque call identity before
  // expression projection. The browser can join a call only by this identity.
  const scenarioCallByLocation = new Map<string, string>();
  for (const link of [...(model.scenarioBundle?.links ?? []), ...(model.scenarioBundle?.omitted ?? [])]) {
    scenarioCallByLocation.set(
      `${link.callerProgramId}:${link.callStartLine}:${link.callStartCharacter}`,
      opaqueTutorIdentity(context, "scenario-call", `${link.callerProgramId}:${link.callStartLine}:${link.callStartCharacter}`)
    );
  }
  const resolveScenarioCallId = (programNodeId: string, range: Pick<SourceRange, "startLine" | "startCharacter">) =>
    scenarioCallByLocation.get(`${programNodeId}:${range.startLine}:${range.startCharacter}`);
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
      presentationKey: tutorGapPresentationKey(gap.kind),
      parameterId: gap.parameterId ? parameterIds.get(gap.parameterId) : undefined,
      blockId: gap.blockId ? context.blockIds.get(gap.blockId) : undefined,
      evidenceTokens: evidenceTokens(gap.evidence ?? [])
    };
  };
  const projectedGaps = model.gaps.map(projectGap);
  const projectedContext = projectCodebaseContext(model, context, evidenceTokens);
  const projectedGuide = projectGuidePlan(model, context, evidenceTokens);
  const frameworkBehavior = projectFrameworkBehavior(model.frameworkBehavior, model.functionLogic, context);
  const rootContinuationIds = new Map((model.declaration.program.continuations ?? []).map((item) => [item.id, opaqueTutorIdentity(context, "scenario-continuation", `${model.declaration.functionNode.id}:${item.id}`)]));
  const projectedBlocks = model.declaration.program.blocks.flatMap((block) => {
    const blockId = context.blockIds.get(block.blockId);
    if (!blockId) return [];
    return [{
      blockId,
      kind: block.kind,
      label: block.label,
      operations: block.operations.flatMap((operation) => projectOperation(operation, context.bindingIds, (range) => resolveScenarioCallId(model.declaration.functionNode.id, range))),
      decision: block.decision ? {
        expression: projectExpression(block.decision.expression, context.bindingIds, (range) => resolveScenarioCallId(model.declaration.functionNode.id, range)),
        continuationId: block.decision.continuationId ? rootContinuationIds.get(block.decision.continuationId) : undefined,
        outcomes: block.decision.outcomes.flatMap((outcome) => {
          const edgeId = context.edgeIds.get(outcome.edgeId);
          return edgeId ? [{ edgeId, label: outcome.label, matches: outcome.matches }] : [];
        })
      } : undefined,
      terminal: block.terminal ? {
        kind: block.terminal.kind,
        continuationId: "continuationId" in block.terminal && block.terminal.continuationId ? rootContinuationIds.get(block.terminal.continuationId) : undefined,
        value: "value" in block.terminal && block.terminal.value
          ? projectExpression(block.terminal.value, context.bindingIds, (range) => resolveScenarioCallId(model.declaration.functionNode.id, range))
          : undefined
      } : undefined,
      continuationSupplyId: block.continuationSupplyId ? rootContinuationIds.get(block.continuationSupplyId) : undefined,
      embeddedRelation: block.embeddedRelation,
      evidenceTokens: evidenceTokens(block.evidence)
    }];
  });
  const entryBlockId = context.blockIds.get(model.declaration.program.entryBlockId);
  if (!entryBlockId) return undefined;
  const projectedProgram = {
    entryBlockId,
    blocks: projectedBlocks,
    edges: model.declaration.program.edges.flatMap((edge) => {
      const edgeId = context.edgeIds.get(edge.edgeId);
      const sourceBlockId = context.blockIds.get(edge.sourceBlockId);
      const targetBlockId = context.blockIds.get(edge.targetBlockId);
      return edgeId && sourceBlockId && targetBlockId ? [{ edgeId, sourceBlockId, targetBlockId, kind: edge.kind, label: edge.label, certainty: edge.certainty }] : [];
    }),
    bindings: model.declaration.program.bindings.flatMap((binding) => {
      const bindingId = context.bindingIds.get(binding.bindingId);
      const parameter = binding.parameterId ? model.declaration.parameters.find((item) => item.id === binding.parameterId) : undefined;
      return bindingId ? [{ bindingId, parameterId: binding.parameterId ? parameterIds.get(binding.parameterId) : undefined, parameterIndex: parameter?.index, name: binding.name, kind: binding.kind, certainty: binding.certainty }] : [];
    }),
    generatorYields: model.declaration.program.generatorYields?.map((value) => projectExpression(value, context.bindingIds, (range) => resolveScenarioCallId(model.declaration.functionNode.id, range))),
    generatorReturn: model.declaration.program.generatorReturn ? projectExpression(model.declaration.program.generatorReturn, context.bindingIds, (range) => resolveScenarioCallId(model.declaration.functionNode.id, range)) : undefined
    , continuations: (model.declaration.program.continuations ?? []).map((item) => ({ id: rootContinuationIds.get(item.id)!, predicate: item.predicate, select: projectExpression(item.select, context.bindingIds, (range) => resolveScenarioCallId(model.declaration.functionNode.id, range)), supply: projectExpression(item.supply, context.bindingIds, (range) => resolveScenarioCallId(model.declaration.functionNode.id, range)) }))
  };
  const rootProgramId = opaqueTutorIdentity(context, "scenario-program", model.declaration.functionNode.id);
  // A malformed bundle cannot be repaired in the browser without guessing
  // identities. Preserve the regular Tutor payload and fail closed instead.
  const hasValidScenarioBundle = model.scenarioBundle?.rootNodeId === model.declaration.functionNode.id;
  const programIdByNodeId = new Map((model.scenarioBundle?.declarations ?? []).map((declaration) => [
    declaration.functionNode.id,
    opaqueTutorIdentity(context, "scenario-program", declaration.functionNode.id)
  ]));
  const opaqueLinks = hasValidScenarioBundle ? (model.scenarioBundle?.links ?? []).map((link) => ({
    callerProgramId: programIdByNodeId.get(link.callerProgramId) ?? rootProgramId,
    calleeProgramId: link.calleeProgramId ? programIdByNodeId.get(link.calleeProgramId) : undefined,
    callId: resolveScenarioCallId(link.callerProgramId, { startLine: link.callStartLine, startCharacter: link.callStartCharacter })!
  })) : [];
  const projectChildProgram = (declaration: FunctionTutorBuildModel["declaration"]) => {
    const nodeId = declaration.functionNode.id;
    const bindingIds = new Map(declaration.program.bindings.map((binding) => [
      binding.bindingId,
      opaqueTutorIdentity(context, "scenario-binding", `${nodeId}:${binding.bindingId}`)
    ]));
    const parameterIds = new Map(declaration.parameters.map((parameter) => [
      parameter.id,
      opaqueTutorIdentity(context, "scenario-parameter", `${nodeId}:${parameter.id}`)
    ]));
    const blockIds = new Map(declaration.program.blocks.map((block) => [
      block.blockId,
      opaqueTutorIdentity(context, "scenario-block", `${nodeId}:${block.blockId}`)
    ]));
    const edgeIds = new Map(declaration.program.edges.map((edge) => [
      edge.edgeId,
      opaqueTutorIdentity(context, "scenario-edge", `${nodeId}:${edge.edgeId}`)
    ]));
    const continuationIds = new Map((declaration.program.continuations ?? []).map((item) => [item.id, opaqueTutorIdentity(context, "scenario-continuation", `${nodeId}:${item.id}`)]));
    return {
      id: programIdByNodeId.get(nodeId)!, executionKind: declaration.executionKind,
      confidence: "exact" as const,
      entryBlockId: blockIds.get(declaration.program.entryBlockId)!,
      blocks: declaration.program.blocks.map((block) => ({
        blockId: blockIds.get(block.blockId)!, kind: block.kind, label: block.label,
        operations: block.operations.flatMap((operation) => projectOperation(operation, bindingIds, (range) => resolveScenarioCallId(nodeId, range))),
        decision: block.decision ? { expression: projectExpression(block.decision.expression, bindingIds, (range) => resolveScenarioCallId(nodeId, range)), continuationId: block.decision.continuationId ? continuationIds.get(block.decision.continuationId) : undefined, outcomes: block.decision.outcomes.map((outcome) => ({ edgeId: edgeIds.get(outcome.edgeId)!, label: outcome.label, matches: outcome.matches })) } : undefined,
        terminal: block.terminal ? { kind: block.terminal.kind, continuationId: "continuationId" in block.terminal && block.terminal.continuationId ? continuationIds.get(block.terminal.continuationId) : undefined, value: "value" in block.terminal && block.terminal.value ? projectExpression(block.terminal.value, bindingIds, (range) => resolveScenarioCallId(nodeId, range)) : undefined } : undefined,
        continuationSupplyId: block.continuationSupplyId ? continuationIds.get(block.continuationSupplyId) : undefined,
        embeddedRelation: block.embeddedRelation, evidenceTokens: []
      })),
      edges: declaration.program.edges.map((edge) => ({ edgeId: edgeIds.get(edge.edgeId)!, sourceBlockId: blockIds.get(edge.sourceBlockId)!, targetBlockId: blockIds.get(edge.targetBlockId)!, kind: edge.kind, label: edge.label, certainty: edge.certainty })),
      bindings: declaration.program.bindings.map((binding) => ({ bindingId: bindingIds.get(binding.bindingId)!, parameterId: binding.parameterId ? parameterIds.get(binding.parameterId) : undefined, parameterIndex: binding.parameterId ? declaration.parameters.find((parameter) => parameter.id === binding.parameterId)?.index : undefined, name: binding.name, kind: binding.kind, certainty: binding.certainty })),
      generatorYields: declaration.program.generatorYields?.map((value) => projectExpression(value, bindingIds, (range) => resolveScenarioCallId(nodeId, range))),
      generatorReturn: declaration.program.generatorReturn ? projectExpression(declaration.program.generatorReturn, bindingIds, (range) => resolveScenarioCallId(nodeId, range)) : undefined,
      continuations: (declaration.program.continuations ?? []).map((item) => ({ id: continuationIds.get(item.id)!, predicate: item.predicate, select: projectExpression(item.select, bindingIds, (range) => resolveScenarioCallId(nodeId, range)), supply: projectExpression(item.supply, bindingIds, (range) => resolveScenarioCallId(nodeId, range)) }))
    };
  };
  const catalogProgramById = new Map((model.declaration.scenarioCatalog?.programs ?? []).map((program) => [program.id, program]));
  const candidateBundle = hasValidScenarioBundle ? {
    rootProgramId,
    // Root graph identities are the exact Function Logic projection once;
    // only child programs receive scenario-private identities.
    programs: [{ id: rootProgramId, executionKind: model.declaration.executionKind, confidence: "exact" as const, ...projectedProgram }, ...(model.scenarioBundle!.declarations || []).filter((declaration) => declaration.functionNode.id !== model.scenarioBundle!.rootNodeId).map((declaration) => {
      const projected = projectChildProgram(declaration);
      const record = catalogProgramById.get(declaration.functionNode.id);
      return record ? {
        ...projected,
        ownerId: record.ownerId ? opaqueTutorIdentity(context, "scenario-owner", record.ownerId) : undefined,
        thisBindingId: record.thisBindingId ? opaqueTutorIdentity(context, "scenario-binding", `${declaration.functionNode.id}:${record.thisBindingId}`) : undefined,
        invocationRole: record.invocationRole,
        fieldInitializers: record.fieldInitializers.map((field) => ({ key: field.key, value: projectExpression(field.value, new Map()) }))
      } : projected;
    })],
    links: opaqueLinks,
    omittedLinks: model.scenarioBundle!.omitted.map((item) => ({ callerProgramId: programIdByNodeId.get(item.callerProgramId) ?? rootProgramId, callId: resolveScenarioCallId(item.callerProgramId, { startLine: item.callStartLine, startCharacter: item.callStartCharacter }), reason: item.reason ?? "unsupported" }))
  } : undefined;
  // Hard stop before delivery: no partial byte truncation can alter JSON syntax.
  const programBundle = candidateBundle && JSON.stringify(candidateBundle).length <= 96 * 1024
    ? candidateBundle
    : candidateBundle ? { rootProgramId, programs: [], omittedLinks: [{ callerProgramId: rootProgramId, reason: "payload-budget" as const }] } : undefined;
  return {
    version: 3,
    fingerprint: createContentHash(JSON.stringify({
      functionId: context.flowId,
      documentation: model.context.documentation?.summary,
      frameworkBehavior,
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
    frameworkBehavior,
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
      objectiveIds: seed.objectiveIds.map((id) => opaqueTutorIdentity(context, "objective", id)),
      evidenceTokens: evidenceTokens(seed.evidence),
      gapIds: seed.gaps.map((gap, index) => projectGap(gap, index).id),
      quality: seed.quality ? {
        purpose: seed.quality.purpose,
        reason: seed.quality.reason,
        assumptions: seed.quality.assumptions,
        targetBlockIds: seed.quality.targetBlockIds.flatMap((id) => context.blockIds.get(id) ?? []),
        checkedBlockIds: seed.quality.evaluation.blockIds.flatMap((id) => context.blockIds.get(id) ?? []),
        checkedEdgeIds: seed.quality.evaluation.edgeIds.flatMap((id) => context.edgeIds.get(id) ?? []),
        branchCount: new Set(seed.quality.evaluation.decisions.map((item) => item.edgeId)).size,
        terminalKind: seed.quality.evaluation.terminal?.kind,
        status: seed.quality.evaluation.status,
        gapReason: seed.quality.evaluation.reason
      } : undefined
    })),
    program: projectedProgram,
    ...(programBundle ? { programBundle } : {}),
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

/** Maps stable analyzer gap kinds to browser-owned text without inspecting English prose. */
function tutorGapPresentationKey(kind: FunctionTutorBuildModel["gaps"][number]["kind"]): import("../../../localization/presentationDescriptors").FunctionTutorGapPresentationKey {
  return `tutor-gap-${kind}`;
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
      questionKey: chapter.questionKey,
      status: chapter.status,
      answer: { text: chapter.answer.text, counts: { ...chapter.answer.counts } },
      answerKey: chapter.answerKey,
      facts: chapter.facts.map((fact) => ({
        id: opaqueTutorIdentity(context, "fact", fact.id),
        kind: fact.kind,
        label: fact.label,
        labelPresentationKey: fact.labelPresentationKey,
        labelPresentationParams: fact.labelPresentationParams,
        detail: fact.detail,
        presentationKey: fact.presentationKey,
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
  bindingIds: ReadonlyMap<string, string>,
  resolveCallId?: (range: SourceRange) => string | undefined
): FunctionTutorOperationPayload[] {
  if (operation.kind === "define") {
    const bindingId = bindingIds.get(operation.bindingId);
    return bindingId ? [{ kind: "define" as const, bindingId, value: projectExpression(operation.value, bindingIds, resolveCallId) }] : [];
  }
  if (operation.kind === "assign") {
    const target = projectTarget(operation.target, bindingIds);
    return target ? [{ kind: "assign" as const, target, value: projectExpression(operation.value, bindingIds, resolveCallId), operator: operation.operator }] : [];
  }
  if (operation.kind === "increment") {
    const target = projectTarget(operation.target, bindingIds);
    return target ? [{ kind: "increment" as const, target, delta: operation.delta }] : [];
  }
  if (operation.kind === "delete") {
    const target = projectTarget(operation.target, bindingIds);
    return target ? [{ kind: "delete" as const, target }] : [];
  }
  return [operation];
}

function projectTarget(target: FunctionTutorAssignmentTarget, bindingIds: ReadonlyMap<string, string>): { kind: "binding" | "member"; bindingId: string; path?: string[]; segments?: Array<{ kind: "static"; key: string } | { kind: "binding"; bindingId: string }> } | undefined {
  const bindingId = bindingIds.get(target.bindingId);
  if (!bindingId) return undefined;
  if (target.kind === "binding") return { kind: "binding", bindingId };
  const segments: Array<{ kind: "static"; key: string } | { kind: "binding"; bindingId: string }> = [];
  for (const segment of target.segments || []) {
    if (segment.kind === "static") segments.push(segment);
    else { const projected = bindingIds.get(segment.bindingId); if (!projected) return undefined; segments.push({ kind: "binding", bindingId: projected }); }
  }
  return { kind: "member", bindingId, path: target.path ?? [], ...(segments.length ? { segments } : {}) };
}

function projectExpression(expression: FunctionTutorExpression, bindingIds: ReadonlyMap<string, string>, resolveCallId?: (range: SourceRange) => string | undefined): FunctionTutorExpressionPayload {
  if (expression.kind === "literal") return { kind: "literal", value: projectStaticValue(expression.value) };
  if (expression.kind === "binding") return bindingIds.has(expression.bindingId)
    ? { kind: "binding", bindingId: bindingIds.get(expression.bindingId)! }
    : { kind: "unsupported", reason: "ambiguous-binding", summary: "A binding is unavailable in this static payload." };
  if (expression.kind === "owner-reference") return { kind: "object", entries: [] };
  if (expression.kind === "member") return {
    kind: "member", object: projectExpression(expression.object, bindingIds, resolveCallId), path: expression.path, optional: expression.optional
  };
  if (expression.kind === "unary") return { kind: "unary", operator: expression.operator, operand: projectExpression(expression.operand, bindingIds, resolveCallId) };
  if (expression.kind === "binary") return { kind: "binary", operator: expression.operator, left: projectExpression(expression.left, bindingIds, resolveCallId), right: projectExpression(expression.right, bindingIds, resolveCallId) };
  if (expression.kind === "logical") return { kind: "logical", operator: expression.operator, members: expression.members.map((member) => projectExpression(member, bindingIds, resolveCallId)) };
  if (expression.kind === "conditional") return { kind: "conditional", condition: projectExpression(expression.condition, bindingIds, resolveCallId), whenTrue: projectExpression(expression.whenTrue, bindingIds, resolveCallId), whenFalse: projectExpression(expression.whenFalse, bindingIds, resolveCallId) };
  if (expression.kind === "array") return { kind: "array", items: expression.items.map((item) => projectExpression(item, bindingIds, resolveCallId)) };
  if (expression.kind === "object") return { kind: "object", entries: expression.entries.map((entry) => ({ key: entry.key, value: projectExpression(entry.value, bindingIds, resolveCallId) })) };
  if (expression.kind === "await") return { kind: "await", operand: projectExpression(expression.operand, bindingIds, resolveCallId) };
  if (expression.kind === "direct-call") return {
    kind: "direct-call",
    calleeName: expression.calleeName,
    arguments: expression.arguments.map((argument) => projectExpression(argument, bindingIds, resolveCallId)),
    certainty: expression.certainty,
    invocationKind: expression.invocationKind,
    receiver: expression.receiver ? projectExpression(expression.receiver, bindingIds, resolveCallId) : undefined,
    optionalDisposition: expression.optionalDisposition,
    requiresAwait: expression.requiresAwait,
    ...(resolveCallId?.(expression.callRange) ? { callId: resolveCallId(expression.callRange) } : {})
  };
  if (expression.kind === "construct") return {
    kind: "construct", className: expression.className,
    arguments: expression.arguments.map((argument) => projectExpression(argument, bindingIds, resolveCallId)),
    certainty: expression.certainty,
    ...(resolveCallId?.(expression.callRange) ? { callId: resolveCallId(expression.callRange) } : {})
  };
  return expression;
}

function projectStaticValue(value: FunctionTutorStaticValue): FunctionTutorStaticValuePayload {
  if (value.kind === "array") return { kind: "array", items: value.items.map(projectStaticValue), truncated: value.truncated };
  if (value.kind === "object") return { kind: "object", entries: value.entries.map((entry) => ({ key: entry.key, value: projectStaticValue(entry.value) })), truncated: value.truncated };
  return value;
}
