/** Bounded input domains and coverage-driven scenario selection; no source code execution. */
import { createContentHash } from "../../../shared/hash";
import { areFunctionTutorStaticValuesEqual, createFunctionTutorUnknown, stringifyFunctionTutorStaticValue } from "../../../analyzer/functionTutor/staticValue";
import { evaluateFunctionTutorInputs } from "../../../analyzer/functionTutor";
import type { FunctionTutorCallsiteTuple, FunctionTutorDeclarationAnalysis, FunctionTutorParameterFact, FunctionTutorStaticValue } from "../../../analyzer/functionTutor";
import type { FunctionTutorCoverageObjective, FunctionTutorInputCandidate, FunctionTutorScenarioSeed } from "./types";
import { createFunctionTutorConstraintRecommendations } from "./functionTutorInputRecommendations";

const MAX_CANDIDATES = 64;
const MAX_SCENARIOS = 12;
const MAX_POOL = 384;

/** Creates type/default/callsite/constraint candidates in fixed precedence order. */
export function createCandidateDomains(
  declaration: FunctionTutorDeclarationAnalysis,
  callsites: FunctionTutorCallsiteTuple[]
): Map<string, FunctionTutorInputCandidate[]> {
  const result = new Map<string, FunctionTutorInputCandidate[]>();
  for (const parameter of declaration.parameters) {
    const candidates: FunctionTutorInputCandidate[] = [];
    for (const tuple of callsites) {
      const argument = tuple.arguments.find((candidate) => candidate.parameterId === parameter.id);
      if (!argument) continue;
      appendCandidate(candidates, {
        id: createCandidateId(parameter.id, argument.value, "callsite"),
        parameterId: parameter.id,
        value: argument.value,
        certainty: argument.certainty,
        source: "callsite",
        evidence: argument.evidence
      });
    }
    if (parameter.defaultValue) appendCandidate(candidates, {
      id: createCandidateId(parameter.id, parameter.defaultValue, "default"),
      parameterId: parameter.id,
      value: parameter.defaultValue,
      certainty: "exact",
      source: "default",
      evidence: parameter.declarationEvidence.filter((evidence) => evidence.kind === "parameter-default")
    });
    for (const value of parameter.literalValues) appendCandidate(candidates, {
      id: createCandidateId(parameter.id, value, "literal-type"),
      parameterId: parameter.id,
      value,
      certainty: "exact",
      source: "literal-type",
      evidence: parameter.declarationEvidence.filter((evidence) => evidence.kind === "parameter-type")
    });
    for (const constraint of declaration.constraints.filter((candidate) => candidate.parameterId === parameter.id)) {
      for (const value of createFunctionTutorConstraintRecommendations(
        parameter,
        constraint,
        candidates.map((candidate) => candidate.value)
      )) {
        appendCandidate(candidates, {
          id: createCandidateId(parameter.id, value, "constraint-boundary"),
          parameterId: parameter.id,
          value,
          certainty: "inferred",
          source: "constraint-boundary",
          evidence: constraint.evidence
        });
      }
    }
    for (const value of createTypeRepresentatives(parameter)) appendCandidate(candidates, {
      id: createCandidateId(parameter.id, value, "type-representative"),
      parameterId: parameter.id,
      value,
      certainty: "inferred",
      source: "type-representative",
      evidence: parameter.declarationEvidence
    });
    if (candidates.length === 0) appendCandidate(candidates, {
      id: createCandidateId(parameter.id, createFunctionTutorUnknown("not-inferred"), "unknown"),
      parameterId: parameter.id,
      value: createFunctionTutorUnknown("not-inferred", "No safe static input example is available."),
      certainty: "unknown",
      source: "unknown",
      evidence: parameter.declarationEvidence
    });
    result.set(parameter.id, candidates.slice(0, MAX_CANDIDATES));
  }
  return result;
}

/** Preserves first-source precedence while removing structurally identical values. */
function appendCandidate(candidates: FunctionTutorInputCandidate[], candidate: FunctionTutorInputCandidate): void {
  if (candidates.some((existing) => areFunctionTutorStaticValuesEqual(existing.value, candidate.value))) return;
  if (candidates.length < MAX_CANDIDATES) candidates.push(candidate);
}

/** Adds non-semantic, clearly-inferred representatives only when no stronger fact exists. */
function createTypeRepresentatives(parameter: FunctionTutorParameterFact): FunctionTutorStaticValue[] {
  // A complete analyzer-owned shape is more useful than the broad fallback,
  // but source/default/literal/constraint candidates have already won above.
  if (parameter.typeRepresentative && !isTruncatedTypeRepresentative(parameter.typeRepresentative)) {
    return [parameter.typeRepresentative];
  }
  switch (parameter.typeKind) {
    case "boolean": return [{ kind: "boolean", value: false }, { kind: "boolean", value: true }];
    case "number": return [{ kind: "number", value: 0 }, { kind: "number", value: 1 }, { kind: "number", value: -1 }];
    case "string": return [{ kind: "string", value: "" }, { kind: "string", value: "sample" }];
    case "array": case "tuple": return [{ kind: "array", items: [], truncated: false }];
    case "object": {
      const shaped = createObjectTypeRepresentative(parameter);
      const empty = { kind: "object" as const, entries: [], truncated: false };
      return shaped.entries.length > 0 ? [shaped, empty] : [shaped];
    }
    default: return parameter.optional ? [{ kind: "undefined" }] : [];
  }
}

/** Rejects incomplete declared trees rather than quietly applying partial input. */
function isTruncatedTypeRepresentative(value: FunctionTutorStaticValue): boolean {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if ((current.kind === "array" || current.kind === "object") && current.truncated) return true;
    if (current.kind === "array") pending.push(...current.items);
    if (current.kind === "object") pending.push(...current.entries.map((entry) => entry.value));
  }
  return false;
}

type TypeRepresentativeNode = {
  children: Map<string, TypeRepresentativeNode>;
  value?: FunctionTutorStaticValue;
  truncated: boolean;
};

/** Builds a deterministic two-level object example from required member facts. */
function createObjectTypeRepresentative(parameter: FunctionTutorParameterFact): FunctionTutorStaticValue & { kind: "object" } {
  const root: TypeRepresentativeNode = { children: new Map(), truncated: false };
  for (const fact of parameter.memberFacts) {
    if (fact.optional || fact.path.length === 0 || fact.path.length > 2) continue;
    const value = createMemberTypeRepresentative(fact);
    if (!value) {
      root.truncated = true;
      continue;
    }
    let node = root;
    for (const part of fact.path) {
      const child = node.children.get(part) ?? { children: new Map(), truncated: false };
      node.children.set(part, child);
      node = child;
    }
    node.value = value;
  }
  const values = new Map<TypeRepresentativeNode, FunctionTutorStaticValue>();
  const pending: Array<{ node: TypeRepresentativeNode; expanded: boolean }> = [{ node: root, expanded: false }];
  while (pending.length > 0) {
    const frame = pending.pop()!;
    if (!frame.expanded) {
      pending.push({ ...frame, expanded: true });
      for (const child of [...frame.node.children.values()].reverse()) pending.push({ node: child, expanded: false });
      continue;
    }
    if (frame.node.children.size === 0 && frame.node.value) {
      values.set(frame.node, frame.node.value);
      continue;
    }
    const entries: Array<{ key: string; value: FunctionTutorStaticValue }> = [];
    let truncated = frame.node.truncated;
    for (const [key, child] of frame.node.children) {
      const childValue = values.get(child);
      if (childValue) entries.push({ key, value: childValue });
      else truncated = true;
    }
    values.set(frame.node, { kind: "object", entries, truncated });
  }
  return values.get(root) as FunctionTutorStaticValue & { kind: "object" };
}

/** Chooses one conservative value for a required object member. */
function createMemberTypeRepresentative(
  fact: FunctionTutorParameterFact["memberFacts"][number]
): FunctionTutorStaticValue | undefined {
  if (fact.literalValues.length > 0) return fact.literalValues[0];
  switch (fact.typeKind) {
    case "boolean": return { kind: "boolean", value: false };
    case "number": return { kind: "number", value: 0 };
    case "string": return { kind: "string", value: "" };
    case "null": return { kind: "null" };
    case "undefined": return { kind: "undefined" };
    case "array": case "tuple": return { kind: "array", items: [], truncated: false };
    case "object": return { kind: "object", entries: [], truncated: false };
    default: return undefined;
  }
}

/** Each decision outcome is counted once, even when its predicate has many atoms. */
export function createObjectives(declaration: FunctionTutorDeclarationAnalysis): FunctionTutorCoverageObjective[] {
  return declaration.program.blocks.filter((block) => block.decision).flatMap((block) =>
    ["true", "false"].filter((outcome) => block.decision!.outcomes.some((item) => item.matches === outcome || outcome === "false" && item.matches === "loop-exit")).map((outcome) => ({
      id: "tutor-objective:" + outcome + ":" + block.blockId,
      kind: ("condition-" + outcome) as "condition-true" | "condition-false",
      blockId: block.blockId, weight: 100
    }))
  ).slice(0, 128);
}

/** Gathers a bounded pool before selecting inputs by reached branches and outcomes. */
export function createScenarioSeeds(
  declaration: FunctionTutorDeclarationAnalysis,
  callsites: FunctionTutorCallsiteTuple[],
  candidatesByParameter: Map<string, FunctionTutorInputCandidate[]>,
  objectives: FunctionTutorCoverageObjective[]
): FunctionTutorScenarioSeed[] {
  const pool: FunctionTutorScenarioSeed[] = [];
  const seen = new Set<string>();
  const append = (seed: FunctionTutorScenarioSeed): FunctionTutorScenarioSeed => {
    const key = inputKey(seed);
    const existing = pool.find((candidate) => inputKey(candidate) === key);
    if (existing) return existing;
    if (seen.has(key) || pool.length >= MAX_POOL) return seed;
    seen.add(key);
    const evaluated = evaluateScenarioSeed(declaration, seed, objectives);
    pool.push(evaluated);
    return evaluated;
  };
  for (const tuple of callsites) append(createSeedFromCallsite(tuple, pool.length + 1));
  const baseline = append(createBaselineSeed(declaration, candidatesByParameter, pool.length + 1));
  // Every source predicate gets a chance before any display limit is applied.
  for (const constraint of declaration.constraints) {
    const parameter = declaration.parameters.find((item) => item.id === constraint.parameterId);
    if (!parameter) continue;
    const baseValue = baseline.inputs.find((item) => item.parameterId === parameter.id)?.value;
    for (const value of createFunctionTutorConstraintRecommendations(parameter, constraint, baseValue ? [baseValue] : [])) {
      append(cloneSeedWithInput(baseline, parameter.id, value, constraint.blockId));
    }
  }
  // A desired CFG path is a search target, never evidence. Repair the first
  // mismatching predicate while preserving the tuple that passed earlier guards.
  for (const objective of objectives) {
    if (pool.length >= MAX_POOL) break;
    const target = declaration.program.blocks.find((block) => block.blockId === objective.blockId);
    const outcome = objective.kind === "condition-true" ? "true" : "false";
    const edgeId = target?.decision?.outcomes.find((item) => item.matches === outcome || outcome === "false" && item.matches === "loop-exit")?.edgeId;
    if (!edgeId || pool.some((seed) => seed.quality?.evaluation.edgeIds.includes(edgeId))) continue;
    const desired = findTargetPath(declaration, edgeId);
    if (!desired) continue;
    let best = pool.reduce((current, seed) => prefixLength(seed, desired) > prefixLength(current, desired) ? seed : current, baseline);
    for (let attempt = 0; attempt < 12 && pool.length < MAX_POOL; attempt += 1) {
      const progress = prefixLength(best, desired);
      if (progress === desired.length) break;
      const edge = declaration.program.edges.find((item) => item.edgeId === desired[progress]);
      const constraints = declaration.constraints.filter((item) => item.blockId === edge?.sourceBlockId);
      if (!constraints.length) break;
      let variants = [best];
      // Compose atomic recommendations at the same decision, including members
      // of the same object. The cap bounds compound guards without recursion.
      for (const constraint of constraints.slice(0, 8)) {
        const parameter = declaration.parameters.find((item) => item.id === constraint.parameterId);
        if (!parameter) continue;
        const expanded: FunctionTutorScenarioSeed[] = [];
        const keys = new Set<string>();
        for (const variant of variants) {
          const base = variant.inputs.find((item) => item.parameterId === parameter.id)?.value;
          const values = createFunctionTutorConstraintRecommendations(parameter, constraint, base ? [base] : []);
          for (const value of values) {
            const candidate = cloneSeedWithInput(variant, parameter.id, value, constraint.blockId);
            const key = inputKey(candidate);
            if (!keys.has(key)) { keys.add(key); expanded.push(candidate); }
          }
        }
        variants = expanded.length ? expanded.slice(0, 24) : variants;
      }
      let improved = best;
      for (const variant of variants) {
        const evaluated = append(variant);
        if (prefixLength(evaluated, desired) > prefixLength(improved, desired)) improved = evaluated;
      }
      if (prefixLength(improved, desired) <= progress) break;
      best = improved;
    }
  }
  return selectScenarioSeeds(pool);
}

/** Rechecks both static and model inputs; intentions cannot award coverage. */
export function evaluateScenarioSeed(
  declaration: FunctionTutorDeclarationAnalysis,
  seed: FunctionTutorScenarioSeed,
  objectives = createObjectives(declaration)
): FunctionTutorScenarioSeed {
  const evaluation = evaluateFunctionTutorInputs(declaration, seed.inputs);
  const objectiveIds = objectives.filter((objective) => evaluation.decisions.some((decision) =>
    decision.blockId === objective.blockId && objective.kind === "condition-" + decision.outcome
  )).map((objective) => objective.id);
  return { ...seed, objectiveIds, quality: {
    purpose: seed.quality?.purpose ?? (seed.source === "callsite" ? "caller" : seed.source === "branch" ? "boundary" : seed.source === "model" ? "model" : "baseline"),
    reason: seed.quality?.reason, assumptions: seed.quality?.assumptions,
    targetBlockIds: seed.quality?.targetBlockIds ?? [], evaluation
  } };
}

/** Greedy set coverage favors new branches, exceptions and distinct source boundaries. */
export function selectScenarioSeeds(pool: FunctionTutorScenarioSeed[], limit = MAX_SCENARIOS): FunctionTutorScenarioSeed[] {
  const selected: FunctionTutorScenarioSeed[] = [];
  const covered = new Set<string>();
  const keys = new Set<string>();
  const add = (seed: FunctionTutorScenarioSeed | undefined): void => {
    if (!seed || keys.has(inputKey(seed)) || selected.length >= limit) return;
    selected.push(seed); keys.add(inputKey(seed));
    for (const feature of seedFeatures(seed)) covered.add(feature.key);
  };
  // Preserve one original complete call tuple and one readable baseline as context.
  add(pool.find((seed) => seed.source === "callsite"));
  add(pool.find((seed) => seed.quality?.purpose === "baseline"));
  while (selected.length < limit) {
    const ranked = pool.filter((seed) => !keys.has(inputKey(seed))).map((seed) => ({
      seed, score: seedFeatures(seed).reduce((sum, item) => sum + (covered.has(item.key) ? 0 : item.weight), 0)
        + (seed.source === "model" && seed.quality?.reason ? 2 : 0)
    })).sort((a, b) => b.score - a.score || a.seed.id.localeCompare(b.seed.id));
    if (!ranked.length || ranked[0].score <= 0) break;
    add(ranked[0].seed);
  }
  // The first recommendation should explain a boundary, while the retained
  // baseline remains available as context rather than dominating Apply Inputs.
  const order = (seed: FunctionTutorScenarioSeed): number => seed.source === "branch" || seed.source === "model" ? 0 : seed.source === "callsite" ? 1 : 2;
  return selected.sort((a, b) => order(a) - order(b)
    || (b.quality?.evaluation.decisions.length ?? 0) - (a.quality?.evaluation.decisions.length ?? 0))
    .map((seed, index) => ({ ...seed, ordinal: index + 1 }));
}

function seedFeatures(seed: FunctionTutorScenarioSeed): Array<{ key: string; weight: number }> {
  const evaluation = seed.quality?.evaluation;
  const features = (evaluation?.decisions ?? []).map((item) => ({ key: "edge:" + item.edgeId, weight: 100 }));
  if (evaluation?.terminal) features.push({ key: "terminal:" + evaluation.terminal.blockId, weight: evaluation.terminal.kind === "throw" ? 180 : evaluation.status === "verified" ? 120 : 30 });
  for (const blockId of seed.quality?.targetBlockIds ?? []) {
    // A boundary that cannot even reach its source predicate adds no coverage.
    if (evaluation?.blockIds.includes(blockId)) features.push({ key: "boundary:" + blockId + ":" + inputKey(seed), weight: 8 });
  }
  return features;
}

/** Finds one acyclic bounded route to a target edge, independent of feasibility. */
function findTargetPath(declaration: FunctionTutorDeclarationAnalysis, targetId: string): string[] | undefined {
  const queue = [{ blockId: declaration.program.entryBlockId, path: [] as string[] }];
  const visited = new Set<string>();
  const edges = declaration.program.edges.filter((edge) => edge.kind !== "defines" && edge.kind !== "deferred");
  for (let cursor = 0; cursor < queue.length && cursor < 256; cursor += 1) {
    const current = queue[cursor];
    if (visited.has(current.blockId) || current.path.length >= 64) continue;
    visited.add(current.blockId);
    for (const edge of edges.filter((item) => item.sourceBlockId === current.blockId)) {
      const path = [...current.path, edge.edgeId];
      if (edge.edgeId === targetId) return path;
      if (!visited.has(edge.targetBlockId)) queue.push({ blockId: edge.targetBlockId, path });
    }
  }
  return undefined;
}

function prefixLength(seed: FunctionTutorScenarioSeed, desired: string[]): number {
  const actual = seed.quality?.evaluation.edgeIds ?? [];
  let count = 0;
  while (count < actual.length && count < desired.length && actual[count] === desired[count]) count += 1;
  return count;
}

function inputKey(seed: FunctionTutorScenarioSeed): string {
  return seed.inputs.map((input) => input.parameterId + "=" + (input.omitted ? "<omitted>" : stringifyFunctionTutorStaticValue(input.value))).join("\0");
}

function createSeedFromCallsite(
  tuple: FunctionTutorCallsiteTuple,
  ordinal: number
): FunctionTutorScenarioSeed {
  return {
    id: `tutor-seed:${createContentHash(tuple.id).slice(0, 24)}`,
    ordinal,
    title: `Callsite Example ${ordinal}`,
    source: "callsite",
    certainty: tuple.certainty,
    inputs: tuple.arguments.map((argument) => ({ ...argument })),
    objectiveIds: [],
    evidence: tuple.evidence,
    gaps: []
  };
}

function createBaselineSeed(
  declaration: FunctionTutorDeclarationAnalysis,
  candidatesByParameter: Map<string, FunctionTutorInputCandidate[]>,
  ordinal: number
): FunctionTutorScenarioSeed {
  const inputs = declaration.parameters.map((parameter) => {
    const candidates = candidatesByParameter.get(parameter.id) ?? [];
    // A dynamic callsite is useful evidence, but its unknown argument must not
    // hide a safe default/literal/type representative in the baseline case.
    const candidate = candidates.find((item) => item.source === "default")
      ?? candidates.find((item) => item.source === "literal-type")
      ?? candidates.find((item) => item.source === "type-representative"
        && !(item.value.kind === "object" && item.value.entries.length === 0 && candidates.some((candidate) => candidate.source === "constraint-boundary")))
      ?? candidates.find((item) => item.source === "constraint-boundary")
      ?? candidates.find((item) => item.value.kind !== "unknown") ?? candidates[0];
    return {
      parameterId: parameter.id,
      value: candidate?.value ?? createFunctionTutorUnknown("not-inferred"),
      omitted: false,
      certainty: candidate?.certainty ?? "unknown",
      evidence: candidate?.evidence ?? parameter.declarationEvidence
    };
  });
  const source = inputs.some((input) => input.certainty === "unknown") ? "mixed" : declaration.parameters.some((parameter) => parameter.defaultValue) ? "default" : "type";
  return {
    id: `tutor-seed:${createContentHash(inputs.map((input) => `${input.parameterId}=${stringifyFunctionTutorStaticValue(input.value)}`).join("\0")).slice(0, 24)}`,
    ordinal,
    title: source === "default" ? "Declared Defaults" : source === "type" ? "Type Baseline" : "Partial Type Baseline",
    source,
    certainty: inputs.some((input) => input.certainty === "unknown") ? "unknown" : inputs.some((input) => input.certainty === "inferred") ? "inferred" : "exact",
    inputs,
    objectiveIds: declaration.parameters.flatMap((parameter) => [
      `tutor-objective:type:${parameter.id}`,
      ...(parameter.defaultValue ? [`tutor-objective:default:${parameter.id}`] : [])
    ]),
    evidence: inputs.flatMap((input) => input.evidence),
    gaps: []
  };
}

function cloneSeedWithInput(
  baseline: FunctionTutorScenarioSeed,
  parameterId: string,
  value: FunctionTutorStaticValue,
  blockId: string
): FunctionTutorScenarioSeed {
  const inputs = baseline.inputs.map((input) => input.parameterId === parameterId
    ? { ...input, value, certainty: value.kind === "unknown" ? "unknown" as const : "inferred" as const }
    : { ...input });
  return {
    ...baseline,
    id: `tutor-seed:${createContentHash(`${baseline.id}\0${parameterId}\0${stringifyFunctionTutorStaticValue(value)}\0${blockId}`).slice(0, 24)}`,
    title: "Branch Boundary",
    source: "branch",
    certainty: inputs.some((input) => input.certainty === "unknown") ? "unknown" : "inferred",
    inputs,
    objectiveIds: [],
    quality: { purpose: "boundary", targetBlockIds: [...new Set([...(baseline.quality?.targetBlockIds ?? []), blockId])],
      evaluation: { status: "partial", blockIds: [], edgeIds: [], decisions: [] } }
  };
}

function createCandidateId(parameterId: string, value: FunctionTutorStaticValue, source: string): string {
  return `tutor-candidate:${createContentHash(`${parameterId}\0${stringifyFunctionTutorStaticValue(value)}\0${source}`).slice(0, 24)}`;
}
