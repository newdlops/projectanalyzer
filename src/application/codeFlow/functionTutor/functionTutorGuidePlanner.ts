/**
 * Builds the five fixed Function Guide questions from structured static facts.
 *
 * The planner deliberately emits data and deterministic counts, not free-form
 * purpose inference. Browser copy can therefore explain the same snapshot
 * consistently while retaining every fact's certainty and source evidence.
 */

import { createContentHash } from "../../../shared/hash";
import type { FunctionTutorSemanticPresentationKey, PresentationParams } from "../../../localization/presentationDescriptors";
import type { FunctionLogicAnalysis, FunctionLogicBlock } from "../../../analyzer/functionLogic";
import type { FunctionTutorCertainty, FunctionTutorDeclarationAnalysis, FunctionTutorEvidence, FunctionTutorGap } from "../../../analyzer/functionTutor";
import type {
  FunctionTutorCodebaseContext,
  FunctionTutorGuideChapter,
  FunctionTutorGuideFact,
  FunctionTutorGuideFactKind,
  FunctionTutorGuidePlan,
  FunctionTutorScenarioSeed
} from "./types";

const MAX_FACTS = 5;
const MAX_INPUT_FACTS = 5;
const MAX_ATTENTION_BLOCKS = 12;
const MAX_ATTENTION_EDGES = 16;

export type BuildFunctionTutorGuideInput = {
  declaration: FunctionTutorDeclarationAnalysis;
  functionLogic: FunctionLogicAnalysis;
  context: FunctionTutorCodebaseContext;
  scenarios: FunctionTutorScenarioSeed[];
  gaps: FunctionTutorGap[];
};

/** Creates the complete fixed-order guide, including unavailable questions. */
export function buildFunctionTutorGuide(input: BuildFunctionTutorGuideInput): FunctionTutorGuidePlan {
  const chapters: FunctionTutorGuidePlan["chapters"] = [
    buildPlaceChapter(input),
    buildInputChapter(input),
    buildDecisionChapter(input),
    buildWorkChapter(input),
    buildOutcomeChapter(input)
  ];
  const summary = {
    readyChapterCount: chapters.filter((chapter) => chapter.status === "ready").length,
    partialChapterCount: chapters.filter((chapter) => chapter.status === "partial").length,
    unavailableChapterCount: chapters.filter((chapter) => chapter.status === "unavailable").length
  };
  return { chapters, initialChapterId: chapters[0].id, summary };
}

function buildPlaceChapter(input: BuildFunctionTutorGuideInput): FunctionTutorGuideChapter {
  const facts: FunctionTutorGuideFact[] = [];
  const context = input.context;
  if (context.documentation?.summary) {
    facts.push(createFact("documentation", "Source documentation", context.documentation.summary, "exact", [], [], context.documentation.evidence, "tutor-label-documentation"));
  }
  for (const owner of context.owners.slice(0, 2)) {
    facts.push(createFact("owner", owner.name, "", owner.certainty, [], [], owner.evidence, "tutor-label-owner", {
      kind: `tutor-label-owner-${owner.kind}`,
      name: owner.name
    }));
  }
  if (context.architecture) {
    const certainty = architectureCertainty(context.architecture.confidence);
    const detail = "";
    facts.push(createFact("architecture", context.architecture.layer, detail, certainty, [], [], context.architecture.evidence.flatMap((item) => item.evidence), "tutor-label-architecture", {
      layer: context.architecture.layer
    }));
  }
  for (const entrypoint of context.entrypoints.slice(0, 1)) {
    facts.push(createFact("entrypoint", entrypoint.label, "", entrypoint.certainty, [], [], entrypoint.evidence));
  }
  for (const caller of context.callers.slice(0, 1)) {
    facts.push(createFact("caller", caller.qualifiedName, "", caller.certainty, [], [], caller.evidence));
  }
  const retained = facts.slice(0, MAX_FACTS);
  return createChapter(1, "place", "", retained, "", "calls", input.functionLogic.blocks[0]?.id, [], [], {
    entrypointCount: context.counts.totalEntrypointCount,
    callerCount: context.counts.totalCallerCount
  });
}

function buildInputChapter(input: BuildFunctionTutorGuideInput): FunctionTutorGuideChapter {
  const facts: FunctionTutorGuideFact[] = [];
  for (const parameter of input.declaration.parameters.slice(0, 4)) {
    const detail = "";
    facts.push(createFact("parameter", parameter.name, detail, parameter.declarationEvidence.some((evidence) => evidence.certainty === "unknown") ? "unknown" : "exact", [], [], parameter.declarationEvidence));
  }
  if (input.declaration.parameters.length > 4) {
    facts.push(createFact("parameter", `${input.declaration.parameters.length - 4} more parameters`, "", "exact", [], [], [], "tutor-label-omitted-parameters", {
      count: input.declaration.parameters.length - 4
    }));
  }
  const parameterBlocks = collectParameterAttention(input.functionLogic, input.declaration.parameters.map((parameter) => parameter.bindingId).filter((id): id is string => Boolean(id)));
  return createChapter(2, "inputs", "", facts.slice(0, MAX_INPUT_FACTS), "", "values", parameterBlocks[0], parameterBlocks, [], {
    parameterCount: input.declaration.parameters.length,
    exactCallsiteTupleCount: input.scenarios.filter((seed) => seed.certainty === "exact").length
  });
}

function buildDecisionChapter(input: BuildFunctionTutorGuideInput): FunctionTutorGuideChapter {
  const candidates = input.functionLogic.blocks
    .filter((block) => block.kind === "condition" || block.kind === "loop" || block.kind === "switch" || block.kind === "try")
    .sort((left, right) => decisionRank(left) - decisionRank(right) || left.range.startLine - right.range.startLine || left.id.localeCompare(right.id));
  const facts = candidates.slice(0, MAX_FACTS).map((block) => {
    const kind: FunctionTutorGuideFactKind = block.kind === "loop" ? "loop" : "decision";
    return blockFact(kind, block, "", input.functionLogic);
  });
  const branchCount = candidates.filter((block) => block.kind !== "loop").length;
  const loopCount = candidates.filter((block) => block.kind === "loop").length;
  return createChapter(3, "decisions", "", facts, "", "flow", candidates[0]?.id, candidates.map((block) => block.id), candidates.flatMap((block) => input.functionLogic.edges.filter((edge) => edge.sourceId === block.id).map((edge) => edge.id)), {
    decisionCount: branchCount,
    loopCount
  });
}

function buildWorkChapter(input: BuildFunctionTutorGuideInput): FunctionTutorGuideChapter {
  const facts: FunctionTutorGuideFact[] = [];
  for (const block of input.functionLogic.blocks) {
    if ((block.valueChanges?.length ?? 0) > 0) facts.push(blockFact("value-change", block, "", input.functionLogic));
    if (block.kind === "effect") facts.push(blockFact("effect", block, "", input.functionLogic));
    if (block.kind === "render") facts.push(blockFact("render", block, "", input.functionLogic));
    if (block.kind === "event") facts.push(blockFact("event", block, "", input.functionLogic));
    if (block.kind === "call") facts.push(blockFact("call", block, "", input.functionLogic));
    if (block.kind === "embedded" || block.kind === "callable") facts.push(blockFact("embedded", block, "", input.functionLogic));
  }
  for (const callee of input.context.callees) {
    facts.push(createFact(callee.relation === "render" ? "render" : callee.relation === "event" ? "event" : "call", callee.name, "", callee.certainty, callee.sourceBlockId ? [callee.sourceBlockId] : [], [], callee.evidence));
  }
  const retained = rankWorkFacts(facts).slice(0, MAX_FACTS);
  const changeCount = input.functionLogic.blocks.reduce((total, block) => total + (block.valueChanges?.length ?? 0), 0);
  const effectCount = input.functionLogic.blocks.filter((block) => block.kind === "effect").length;
  return createChapter(4, "work", "", retained, "", "calls", retained[0]?.blockIds[0], retained.flatMap((fact) => fact.blockIds), [], {
    valueChangeCount: changeCount,
    effectBlockCount: effectCount,
    outgoingRelationCount: input.context.callees.length
  });
}

function buildOutcomeChapter(input: BuildFunctionTutorGuideInput): FunctionTutorGuideChapter {
  const terminalBlocks = input.functionLogic.blocks.filter((block) => block.kind === "return" || block.kind === "throw" || block.kind === "exit");
  const facts = terminalBlocks.slice(0, MAX_FACTS).map((block) => blockFact(block.kind === "throw" ? "throw" : block.kind === "return" ? "return" : "exit", block, "", input.functionLogic));
  if (input.scenarios.length > 0) facts.push(createFact("scenario", `${input.scenarios.length} static input case${plural(input.scenarios.length)}`, "", "inferred", [], [], [], "tutor-label-scenario-count", {
    count: input.scenarios.length
  }));
  const returnCount = terminalBlocks.filter((block) => block.kind === "return").length;
  const throwCount = terminalBlocks.filter((block) => block.kind === "throw").length;
  return createChapter(5, "outcomes", "", facts.slice(0, MAX_FACTS), "", "effects", terminalBlocks[0]?.id, terminalBlocks.map((block) => block.id), [], {
    returnCount,
    throwCount,
    exitCount: terminalBlocks.filter((block) => block.kind === "exit").length
  });
}

function createChapter(
  ordinal: 1 | 2 | 3 | 4 | 5,
  kind: FunctionTutorGuideChapter["kind"],
  question: string,
  facts: FunctionTutorGuideFact[],
  answer: string,
  preferredLens: FunctionTutorGuideChapter["preferredLens"],
  primaryBlockId: string | undefined,
  attentionBlockIds: string[],
  attentionEdgeIds: string[],
  counts: Record<string, number> = {}
): FunctionTutorGuideChapter {
  const status = facts.length >= 2 ? "ready" : facts.length === 1 ? "partial" : "unavailable";
  return {
    id: `function-tutor-chapter:${kind}:${createContentHash(kind).slice(0, 16)}`,
    ordinal,
    kind,
    question,
    questionKey: kind,
    status,
    answer: { text: answer, counts: { factCount: facts.length, ...counts } },
    answerKey: kind,
    facts,
    preferredLens,
    ...(primaryBlockId ? { primaryBlockId } : {}),
    attentionBlockIds: unique(attentionBlockIds).slice(0, MAX_ATTENTION_BLOCKS),
    attentionEdgeIds: unique(attentionEdgeIds).slice(0, MAX_ATTENTION_EDGES),
    gapIds: []
  };
}

function blockFact(
  kind: FunctionTutorGuideFactKind,
  block: FunctionLogicBlock,
  detail: string,
  analysis: FunctionLogicAnalysis
): FunctionTutorGuideFact {
  const evidenceKind: FunctionTutorEvidence["kind"] = kind === "value-change" ? "value-change"
    : kind === "effect" ? "effect-boundary"
      : kind === "return" || kind === "throw" || kind === "exit" ? "terminal" : "fallback";
  const evidence: FunctionTutorEvidence[] = [{ kind: evidenceKind, certainty: block.confidence, filePath: block.filePath, range: block.range, summary: "Function Logic source block." }];
  const edgeIds = analysis.edges.filter((edge) => edge.sourceId === block.id).map((edge) => edge.id);
  return createFact(kind, block.label, detail, block.confidence, [block.id], edgeIds, evidence);
}

function createFact(
  kind: FunctionTutorGuideFactKind,
  label: string,
  detail: string,
  certainty: FunctionTutorCertainty,
  blockIds: string[],
  edgeIds: string[],
  evidence: FunctionTutorEvidence[],
  labelPresentationKey?: FunctionTutorSemanticPresentationKey,
  labelPresentationParams?: PresentationParams
): FunctionTutorGuideFact {
  const sourceDocumentation = kind === "documentation";
  return {
    id: `function-tutor-fact:${kind}:${createContentHash(`${label}\0${detail}\0${blockIds.join(",")}`).slice(0, 20)}`,
    kind,
    label,
    labelPresentationKey,
    labelPresentationParams,
    // Documentation is user/source text and must remain literal. Every other
    // planner explanation is owned prose rendered from the browser catalog.
    detail: sourceDocumentation ? detail : "",
    presentationKey: sourceDocumentation ? undefined : `tutor-fact-${kind}`,
    certainty,
    blockIds,
    edgeIds,
    evidence
  };
}

function collectParameterAttention(analysis: FunctionLogicAnalysis, bindingIds: string[]): string[] {
  const blockIds = analysis.blocks.flatMap((block) => (block.valueAccesses ?? []).some((access) => bindingIds.includes(access.bindingId)) ? [block.id] : []);
  return unique(blockIds).slice(0, 8);
}

function rankWorkFacts(facts: FunctionTutorGuideFact[]): FunctionTutorGuideFact[] {
  const rank: Record<FunctionTutorGuideFactKind, number> = { effect: 0, "value-change": 1, call: 2, render: 3, event: 4, embedded: 5, documentation: 6, owner: 6, architecture: 6, entrypoint: 6, caller: 6, parameter: 6, decision: 6, loop: 6, return: 6, throw: 6, exit: 6, scenario: 6, gap: 6 };
  return facts.sort((left, right) => rank[left.kind] - rank[right.kind] || certaintyRank(left.certainty) - certaintyRank(right.certainty) || left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

function decisionRank(block: FunctionLogicBlock): number {
  return block.kind === "condition" ? 0 : block.kind === "switch" ? 1 : block.kind === "loop" ? 2 : 3;
}

function architectureCertainty(value: "high" | "medium" | "low" | "unknown"): FunctionTutorCertainty {
  return value === "high" ? "exact" : value === "unknown" ? "unknown" : "inferred";
}

function certaintyRank(value: FunctionTutorCertainty): number {
  return value === "exact" ? 0 : value === "inferred" ? 1 : 2;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function plural(value: number): string {
  return value === 1 ? "" : "s";
}
