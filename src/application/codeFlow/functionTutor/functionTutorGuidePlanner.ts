/**
 * Builds the five fixed Function Guide questions from structured static facts.
 *
 * The planner deliberately emits data and deterministic counts, not free-form
 * purpose inference. Browser copy can therefore explain the same snapshot
 * consistently while retaining every fact's certainty and source evidence.
 */

import { createContentHash } from "../../../shared/hash";
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
    facts.push(createFact("documentation", "Source documentation", context.documentation.summary, "exact", [], [], context.documentation.evidence));
  }
  for (const owner of context.owners.slice(0, 2)) {
    facts.push(createFact("owner", `${owner.kind}: ${owner.name}`, "Lexical owner in the current graph snapshot.", owner.certainty, [], [], owner.evidence));
  }
  if (context.architecture) {
    const certainty = architectureCertainty(context.architecture.confidence);
    const detail = context.architecture.conflicted
      ? "Multiple architecture signals are present in the current graph."
      : `Architecture evidence classifies this as ${context.architecture.layer}.`;
    facts.push(createFact("architecture", `Layer: ${context.architecture.layer}`, detail, certainty, [], [], context.architecture.evidence.flatMap((item) => item.evidence)));
  }
  for (const entrypoint of context.entrypoints.slice(0, 1)) {
    facts.push(createFact("entrypoint", entrypoint.label, `${entrypoint.steps.length} bounded entrypoint steps reach this function.`, entrypoint.certainty, [], [], entrypoint.evidence));
  }
  for (const caller of context.callers.slice(0, 1)) {
    facts.push(createFact("caller", caller.qualifiedName, `${caller.callCount} direct callsite${plural(caller.callCount)} in the current graph.`, caller.certainty, [], [], caller.evidence));
  }
  const retained = facts.slice(0, MAX_FACTS);
  const answer = retained.length === 0
    ? "The current bounded graph does not provide source-backed placement context for this function."
    : `The current graph provides ${retained.length} source-backed placement fact${plural(retained.length)} for this function.`;
  return createChapter(1, "place", "Where Does It Fit?", retained, answer, "calls", input.functionLogic.blocks[0]?.id, [], []);
}

function buildInputChapter(input: BuildFunctionTutorGuideInput): FunctionTutorGuideChapter {
  const facts: FunctionTutorGuideFact[] = [];
  for (const parameter of input.declaration.parameters.slice(0, 4)) {
    const type = parameter.typeText ?? parameter.typeKind;
    const detail = parameter.defaultValue
      ? `Declared ${type}; default is statically known.`
      : `Declared ${type}.`;
    facts.push(createFact("parameter", parameter.name, detail, parameter.declarationEvidence.some((evidence) => evidence.certainty === "unknown") ? "unknown" : "exact", [], [], parameter.declarationEvidence));
  }
  if (input.declaration.parameters.length > 4) {
    facts.push(createFact("parameter", `${input.declaration.parameters.length - 4} more parameters`, "Additional declared inputs remain available in the function signature.", "exact", [], [], []));
  }
  const parameterBlocks = collectParameterAttention(input.functionLogic, input.declaration.parameters.map((parameter) => parameter.bindingId).filter((id): id is string => Boolean(id)));
  const answer = input.declaration.parameters.length === 0
    ? "No declared parameters are visible in the current function declaration."
    : `${input.declaration.parameters.length} declared input${plural(input.declaration.parameters.length)} and ${input.scenarios.filter((seed) => seed.certainty === "exact").length} exact callsite tuple${plural(input.scenarios.filter((seed) => seed.certainty === "exact").length)} are available for static reading.`;
  return createChapter(2, "inputs", "What Comes In?", facts.slice(0, MAX_INPUT_FACTS), answer, "values", parameterBlocks[0], parameterBlocks, []);
}

function buildDecisionChapter(input: BuildFunctionTutorGuideInput): FunctionTutorGuideChapter {
  const candidates = input.functionLogic.blocks
    .filter((block) => block.kind === "condition" || block.kind === "loop" || block.kind === "switch" || block.kind === "try")
    .sort((left, right) => decisionRank(left) - decisionRank(right) || left.range.startLine - right.range.startLine || left.id.localeCompare(right.id));
  const facts = candidates.slice(0, MAX_FACTS).map((block) => {
    const kind: FunctionTutorGuideFactKind = block.kind === "loop" ? "loop" : "decision";
    const outgoing = input.functionLogic.edges.filter((edge) => edge.sourceId === block.id).length;
    return blockFact(kind, block, `${outgoing} visible control continuation${plural(outgoing)}.`, input.functionLogic);
  });
  const branchCount = candidates.filter((block) => block.kind !== "loop").length;
  const loopCount = candidates.filter((block) => block.kind === "loop").length;
  const answer = candidates.length === 0
    ? "No branch or loop is visible in the bounded function body."
    : `${branchCount} decision${plural(branchCount)} and ${loopCount} loop${plural(loopCount)} can change the static path.`;
  return createChapter(3, "decisions", "What Changes the Path?", facts, answer, "flow", candidates[0]?.id, candidates.map((block) => block.id), candidates.flatMap((block) => input.functionLogic.edges.filter((edge) => edge.sourceId === block.id).map((edge) => edge.id)));
}

function buildWorkChapter(input: BuildFunctionTutorGuideInput): FunctionTutorGuideChapter {
  const facts: FunctionTutorGuideFact[] = [];
  for (const block of input.functionLogic.blocks) {
    if ((block.valueChanges?.length ?? 0) > 0) facts.push(blockFact("value-change", block, `${block.valueChanges?.length} visible value change${plural(block.valueChanges?.length ?? 0)}.`, input.functionLogic));
    if (block.kind === "effect") facts.push(blockFact("effect", block, "Possible static effect boundary.", input.functionLogic));
    if (block.kind === "render") facts.push(blockFact("render", block, "Source-backed render relation.", input.functionLogic));
    if (block.kind === "event") facts.push(blockFact("event", block, "Source-backed event relation.", input.functionLogic));
    if (block.kind === "call") facts.push(blockFact("call", block, "Source-backed call block.", input.functionLogic));
    if (block.kind === "embedded" || block.kind === "callable") facts.push(blockFact("embedded", block, "Static embedded-code boundary.", input.functionLogic));
  }
  for (const callee of input.context.callees) {
    facts.push(createFact(callee.relation === "render" ? "render" : callee.relation === "event" ? "event" : "call", callee.name, `${callee.kind} target with ${callee.callCount} direct callsite${plural(callee.callCount)}.`, callee.certainty, callee.sourceBlockId ? [callee.sourceBlockId] : [], [], callee.evidence));
  }
  const retained = rankWorkFacts(facts).slice(0, MAX_FACTS);
  const changeCount = input.functionLogic.blocks.reduce((total, block) => total + (block.valueChanges?.length ?? 0), 0);
  const effectCount = input.functionLogic.blocks.filter((block) => block.kind === "effect").length;
  const answer = retained.length === 0
    ? "No classified value change, call, render, event, or effect is visible in the bounded function body."
    : `${changeCount} visible value change${plural(changeCount)}, ${effectCount} effect block${plural(effectCount)}, and ${input.context.callees.length} direct outgoing relation${plural(input.context.callees.length)} are available for inspection.`;
  return createChapter(4, "work", "What Does It Change or Call?", retained, answer, "calls", retained[0]?.blockIds[0], retained.flatMap((fact) => fact.blockIds), []);
}

function buildOutcomeChapter(input: BuildFunctionTutorGuideInput): FunctionTutorGuideChapter {
  const terminalBlocks = input.functionLogic.blocks.filter((block) => block.kind === "return" || block.kind === "throw" || block.kind === "exit");
  const facts = terminalBlocks.slice(0, MAX_FACTS).map((block) => blockFact(block.kind === "throw" ? "throw" : block.kind === "return" ? "return" : "exit", block, "Visible function terminal.", input.functionLogic));
  if (input.scenarios.length > 0) facts.push(createFact("scenario", `${input.scenarios.length} static input case${plural(input.scenarios.length)}`, "Possible outcomes are calculated only when Static Input Cases is opened.", "inferred", [], [], []));
  const returnCount = terminalBlocks.filter((block) => block.kind === "return").length;
  const throwCount = terminalBlocks.filter((block) => block.kind === "throw").length;
  const answer = terminalBlocks.length === 0
    ? "No explicit return, throw, or exit block is visible; follow the final transfer in the graph."
    : `${returnCount} return point${plural(returnCount)} and ${throwCount} throw${plural(throwCount)} are visible in the bounded function body.`;
  return createChapter(5, "outcomes", "How Can It Finish?", facts.slice(0, MAX_FACTS), answer, "effects", terminalBlocks[0]?.id, terminalBlocks.map((block) => block.id), []);
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
  attentionEdgeIds: string[]
): FunctionTutorGuideChapter {
  const status = facts.length >= 2 ? "ready" : facts.length === 1 ? "partial" : "unavailable";
  return {
    id: `function-tutor-chapter:${kind}:${createContentHash(question).slice(0, 16)}`,
    ordinal,
    kind,
    question,
    status,
    answer: { text: answer, counts: { factCount: facts.length } },
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
  evidence: FunctionTutorEvidence[]
): FunctionTutorGuideFact {
  return {
    id: `function-tutor-fact:${kind}:${createContentHash(`${label}\0${detail}\0${blockIds.join(",")}`).slice(0, 20)}`,
    kind,
    label,
    detail,
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
