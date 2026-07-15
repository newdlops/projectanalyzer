/**
 * Deterministic best-evidenced learning paths for one selected project scope.
 *
 * Only mapped semantic flows are eligible. A path keeps the source entrypoint,
 * one concrete handler, and one fixed child chain. Child traversal is iterative,
 * visited-guarded, and capped at five steps; all omitted source steps remain
 * visible through exact counters.
 */

import type { FunctionArchitectureIndex } from "../architecturalLayers";
import type { SemanticFlow, SemanticFlowStep } from "../semanticFlow";
import {
  compareSemanticFlows,
  getGraphQLOperationType,
  isMappedSemanticFlow,
  type IndexedProjectReadingScope
} from "./scopeIndex";
import {
  PROJECT_READING_PATH_LIMIT,
  PROJECT_READING_STEP_LIMIT,
  type ProjectReadingBoundaryKind,
  type ProjectReadingContextInference,
  type ProjectReadingGraphQLOperationType,
  type ProjectReadingPath,
  type ProjectReadingStep,
  type ProjectReadingTraceStatus,
  type ProjectReadingTransport
} from "./types";
import {
  createReadingRecommendation,
  getReadingRecommendationRank,
  getReadingStepArchitecture
} from "./pathArchitecture";

/** Fixed evidence order prefers explicit semantic boundaries over plain leaves. */
const BOUNDARY_KIND_ORDER: Record<ProjectReadingBoundaryKind, number> = {
  repository: 0,
  model: 1,
  externalCall: 2,
  sideEffect: 3,
  unresolvedCall: 4,
  observedTerminal: 5
};

type SelectedReadingStep = {
  step: SemanticFlowStep;
  boundaryKind?: ProjectReadingBoundaryKind;
  contextInference?: ProjectReadingContextInference;
};

/** Fixed reading-only explanation for a topology-derived workflow candidate. */
const WORKFLOW_BRIDGE_INFERENCE: ProjectReadingContextInference = {
  role: "workflowBridgeCandidate",
  confidence: "low",
  evidence: [
    "Local function lies between a mapped handler and an explicit effect boundary; topology suggests possible workflow ownership, not layer, business logic, or purity."
  ]
};

type CallStepIndex = {
  childrenByParentId: Map<string, SemanticFlowStep[]>;
  callByFunctionId: Map<string, SemanticFlowStep>;
};

type BoundaryChain = {
  boundaryKind: ProjectReadingBoundaryKind;
  boundary: SemanticFlowStep;
  chain: SemanticFlowStep[];
};

type ContextualBoundarySelection = {
  boundaryChain: BoundaryChain;
  target: SemanticFlowStep;
};

/** Internal candidate shared by scope top-K and graph-wide top-1 selection. */
export type ProjectReadingPathCandidate = {
  flow: SemanticFlow;
  path: ProjectReadingPath;
};

/** Bounded mapped-flow projection with exact eligibility and omission counts. */
export type ProjectReadingPathProjection = {
  readingPaths: ProjectReadingPath[];
  mappedFlowCount: number;
  omittedMappedFlowCount: number;
  unmappedEntrypointCount: number;
};

/** Projects up to three evidence-ranked mapped flows for a selected scope. */
export function createProjectReadingPaths(
  scope: IndexedProjectReadingScope,
  architectureIndex: FunctionArchitectureIndex
): ProjectReadingPathProjection {
  const selected: ProjectReadingPathCandidate[] = [];
  let mappedFlowCount = 0;

  for (const flow of scope.flows) {
    if (!isMappedSemanticFlow(flow)) {
      continue;
    }
    mappedFlowCount += 1;
    insertRankedReadingPath(selected, {
      flow,
      path: createProjectReadingPath(scope.summary.id, flow, architectureIndex)
    });
  }

  return {
    readingPaths: selected.map((candidate) => candidate.path),
    mappedFlowCount,
    omittedMappedFlowCount: mappedFlowCount - selected.length,
    unmappedEntrypointCount: scope.flows.length - mappedFlowCount
  };
}

/** Maintains a constant-size prefix ranked by explainable learning evidence. */
function insertRankedReadingPath(
  selected: ProjectReadingPathCandidate[],
  candidate: ProjectReadingPathCandidate
): void {
  let insertionIndex = 0;
  while (
    insertionIndex < selected.length
    && compareProjectReadingPathCandidates(selected[insertionIndex], candidate) <= 0
  ) {
    insertionIndex += 1;
  }

  if (insertionIndex >= PROJECT_READING_PATH_LIMIT) {
    return;
  }
  selected.splice(insertionIndex, 0, candidate);
  if (selected.length > PROJECT_READING_PATH_LIMIT) {
    selected.pop();
  }
}

/** Orders business reach and evidence before stable flow identity. */
export function compareProjectReadingPathCandidates(
  left: ProjectReadingPathCandidate,
  right: ProjectReadingPathCandidate
): number {
  const leftRank = getReadingRecommendationRank(
    left.path.recommendation,
    left.path.steps,
    left.path.unresolvedCallCount,
    left.path.traceStatus,
    left.path.confidence
  );
  const rightRank = getReadingRecommendationRank(
    right.path.recommendation,
    right.path.steps,
    right.path.unresolvedCallCount,
    right.path.traceStatus,
    right.path.confidence
  );
  for (let index = 0; index < Math.max(leftRank.length, rightRank.length); index += 1) {
    const difference = (rightRank[index] ?? 0) - (leftRank[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return compareSemanticFlows(left.flow, right.flow);
}

/** Converts one mapped semantic flow into a bounded, layered source-reading path. */
export function createProjectReadingPath(
  scopeId: string,
  flow: SemanticFlow,
  architectureIndex: FunctionArchitectureIndex
): ProjectReadingPath {
  const selectedSteps = selectReadingSteps(flow.steps, architectureIndex);
  const operationType = flow.entrypointKind === "graphqlOperation"
    ? getGraphQLOperationType(flow)
    : undefined;
  const depthLimitReached = flow.coverageGaps.some((gap) => gap.reason === "depthLimit");
  const stepLimitReached = flow.coverageGaps.some((gap) => gap.reason === "stepLimit");
  const unresolvedCallCount = flow.steps.filter((step) =>
    step.kind === "call" && step.resolution === "unresolved"
  ).length;
  const readingSteps = selectedSteps.map((step) => toReadingStep(step, architectureIndex));
  const omittedStepCount = Math.max(0, flow.steps.length - selectedSteps.length);
  const recommendation = createReadingRecommendation(
    readingSteps,
    depthLimitReached,
    stepLimitReached,
    unresolvedCallCount,
    omittedStepCount
  );

  return {
    id: createReadingPathId(scopeId, flow),
    scopeId,
    entrypointKind: flow.entrypointKind,
    entrypointUnitId: flow.entrypointUnitId,
    transport: getReadingTransport(flow, operationType),
    operationType,
    framework: flow.framework,
    name: flow.name,
    confidence: flow.confidence,
    traceStatus: getTraceStatus(depthLimitReached, stepLimitReached, unresolvedCallCount),
    recommendation,
    steps: readingSteps,
    totalStepCount: flow.steps.length,
    omittedStepCount,
    depthLimitReached,
    stepLimitReached,
    unresolvedCallCount
  };
}

/**
 * Selects one stable source chain without recursive graph traversal.
 * Entrypoint and handler rows are reserved, then an explicit repository/model,
 * external, unresolved, side-effect, or observed terminal boundary is chosen
 * from the already bounded semantic flow and walked back to its handler.
 */
function selectReadingSteps(
  steps: readonly SemanticFlowStep[],
  architectureIndex: FunctionArchitectureIndex
): SelectedReadingStep[] {
  const selected: SelectedReadingStep[] = [];
  const entrypoint = selectMinimumStep(steps, (step) =>
    step.kind === "route" || step.kind === "operation"
  );
  const handler = selectMinimumStep(steps, (step) =>
      step.kind === "handler"
        && step.resolution === "concrete"
        && step.functionId !== undefined
  );

  appendWithinLimit(selected, entrypoint);
  appendWithinLimit(selected, handler);

  if (!handler?.functionId || selected.length >= PROJECT_READING_STEP_LIMIT) {
    return selected;
  }

  const callIndex = createCallStepIndex(steps);
  const businessTarget = selectBusinessTarget(
    handler.functionId,
    steps,
    callIndex,
    architectureIndex
  );
  const contextualSelection = businessTarget
    ? undefined
    : selectContextualBoundaryChain(
      handler.functionId,
      steps,
      callIndex,
      architectureIndex
    );
  const boundaryChain = businessTarget
    ? selectBoundaryChain(handler.functionId, steps, callIndex, businessTarget.functionId)
    : contextualSelection?.boundaryChain
      ?? selectBoundaryChain(handler.functionId, steps, callIndex);
  const targetChain = businessTarget
    ? walkBoundaryToHandler(handler.functionId, businessTarget, callIndex.callByFunctionId)
    : undefined;
  const selectedChain = boundaryChain?.chain ?? targetChain;
  if (!selectedChain) {
    return selected;
  }

  const contextualTarget = contextualSelection?.target;
  const availableCallSteps = PROJECT_READING_STEP_LIMIT - selected.length;
  const boundedChain = boundLearningChain(
    selectedChain,
    availableCallSteps,
    businessTarget ?? contextualTarget,
    boundaryChain?.boundary
  );

  for (const step of boundedChain) {
    selected.push({
      step,
      boundaryKind: step === boundaryChain?.boundary
        ? boundaryChain.boundaryKind
        : undefined,
      contextInference: step === contextualTarget
        ? { ...WORKFLOW_BRIDGE_INFERENCE, evidence: [...WORKFLOW_BRIDGE_INFERENCE.evidence] }
        : undefined
    });
  }

  return selected;
}

/** Prefers an explicit effect chain containing a safe contextual candidate. */
function selectContextualBoundaryChain(
  handlerFunctionId: string,
  steps: readonly SemanticFlowStep[],
  callIndex: CallStepIndex,
  architectureIndex: FunctionArchitectureIndex
): ContextualBoundarySelection | undefined {
  let selected: ContextualBoundarySelection | undefined;

  for (const step of steps) {
    const boundaryKind = getBoundaryKind(step, callIndex.childrenByParentId);
    if (!boundaryKind || !isExplicitEffectBoundary(boundaryKind)) {
      continue;
    }
    const chain = walkBoundaryToHandler(
      handlerFunctionId,
      step,
      callIndex.callByFunctionId
    );
    if (!chain) {
      continue;
    }
    const boundaryChain = { boundaryKind, boundary: step, chain };
    const target = selectContextualWorkflowTarget(boundaryChain, architectureIndex);
    if (!target) {
      continue;
    }
    const candidate = { boundaryChain, target };
    if (!selected || compareContextualSelections(candidate, selected) < 0) {
      selected = candidate;
    }
  }

  return selected;
}

/** Orders explicit effect semantics, then handler proximity and stable identity. */
function compareContextualSelections(
  left: ContextualBoundarySelection,
  right: ContextualBoundarySelection
): number {
  return BOUNDARY_KIND_ORDER[left.boundaryChain.boundaryKind]
      - BOUNDARY_KIND_ORDER[right.boundaryChain.boundaryKind]
    || left.target.depth - right.target.depth
    || compareSemanticFlowSteps(left.target, right.target)
    || compareBoundaryChains(left.boundaryChain, right.boundaryChain);
}

/**
 * Selects the handler-nearest strict interior function on an explicit effect
 * chain. The intrinsic assessment remains unclassified and unmodified.
 */
function selectContextualWorkflowTarget(
  boundaryChain: BoundaryChain,
  architectureIndex: FunctionArchitectureIndex
): SemanticFlowStep | undefined {
  if (!isExplicitEffectBoundary(boundaryChain.boundaryKind)) {
    return undefined;
  }

  for (let index = 0; index < boundaryChain.chain.length - 1; index += 1) {
    const step = boundaryChain.chain[index];
    if (
      step.resolution !== "concrete"
      || !step.functionId
      || step.role === "repository"
      || step.role === "model"
      || step.role === "external"
      || step.role === "sideEffect"
    ) {
      continue;
    }
    const architecture = getReadingStepArchitecture(step, architectureIndex);
    if (
      architecture.layer === "unclassified"
      && architecture.businessLogic === "unknown"
      && !architecture.conflicted
    ) {
      return step;
    }
  }

  return undefined;
}

function isExplicitEffectBoundary(boundaryKind: ProjectReadingBoundaryKind): boolean {
  return boundaryKind === "repository"
    || boundaryKind === "model"
    || boundaryKind === "sideEffect";
}

/** Builds parent and target indexes once without sorting a wide call branch. */
function createCallStepIndex(
  steps: readonly SemanticFlowStep[]
): CallStepIndex {
  const childrenByParentId = new Map<string, SemanticFlowStep[]>();
  const callByFunctionId = new Map<string, SemanticFlowStep>();

  for (const step of steps) {
    if (step.kind !== "call") {
      continue;
    }

    if (step.parentFunctionId) {
      const children = childrenByParentId.get(step.parentFunctionId) ?? [];
      children.push(step);
      childrenByParentId.set(step.parentFunctionId, children);
    }

    if (step.functionId) {
      const current = callByFunctionId.get(step.functionId);
      if (!current || compareSemanticFlowSteps(step, current) < 0) {
        callByFunctionId.set(step.functionId, step);
      }
    }
  }

  return { childrenByParentId, callByFunctionId };
}

/** Selects the fixed-order boundary whose parent chain reaches the handler. */
function selectBoundaryChain(
  handlerFunctionId: string,
  steps: readonly SemanticFlowStep[],
  callIndex: CallStepIndex,
  requiredFunctionId?: string
): BoundaryChain | undefined {
  let selected: BoundaryChain | undefined;

  for (const step of steps) {
    const boundaryKind = getBoundaryKind(step, callIndex.childrenByParentId);
    if (!boundaryKind) {
      continue;
    }

    const chain = walkBoundaryToHandler(
      handlerFunctionId,
      step,
      callIndex.callByFunctionId
    );
    if (!chain) {
      continue;
    }
    if (requiredFunctionId && !chain.some((item) => item.functionId === requiredFunctionId)) {
      continue;
    }

    const candidate: BoundaryChain = { boundaryKind, boundary: step, chain };
    if (!selected || compareBoundaryChains(candidate, selected) < 0) {
      selected = candidate;
    }
  }

  return selected;
}

/** Selects the strongest reachable business candidate without calling it critical. */
function selectBusinessTarget(
  handlerFunctionId: string,
  steps: readonly SemanticFlowStep[],
  callIndex: CallStepIndex,
  architectureIndex: FunctionArchitectureIndex
): SemanticFlowStep | undefined {
  let selected: SemanticFlowStep | undefined;

  for (const step of steps) {
    if (step.kind !== "call" || step.resolution !== "concrete" || !step.functionId) {
      continue;
    }
    const architecture = getReadingStepArchitecture(step, architectureIndex);
    if (
      architecture.businessLogic !== "domainRuleCandidate"
      && architecture.businessLogic !== "applicationWorkflowCandidate"
    ) {
      continue;
    }
    if (!walkBoundaryToHandler(handlerFunctionId, step, callIndex.callByFunctionId)) {
      continue;
    }
    if (!selected || compareBusinessTargets(step, selected, architectureIndex) < 0) {
      selected = step;
    }
  }

  return selected;
}

/** Orders domain before application, then confidence, distance, and source identity. */
function compareBusinessTargets(
  left: SemanticFlowStep,
  right: SemanticFlowStep,
  architectureIndex: FunctionArchitectureIndex
): number {
  const leftArchitecture = getReadingStepArchitecture(left, architectureIndex);
  const rightArchitecture = getReadingStepArchitecture(right, architectureIndex);
  return getBusinessRank(rightArchitecture.businessLogic) - getBusinessRank(leftArchitecture.businessLogic)
    || getArchitectureConfidenceRank(rightArchitecture.confidence)
      - getArchitectureConfidenceRank(leftArchitecture.confidence)
    || left.depth - right.depth
    || getEdgeConfidenceRank(left.confidence) - getEdgeConfidenceRank(right.confidence)
    || compareSemanticFlowSteps(left, right);
}

function getBusinessRank(
  businessLogic: ProjectReadingStep["architecture"]["businessLogic"]
): number {
  return businessLogic === "domainRuleCandidate"
    ? 2
    : businessLogic === "applicationWorkflowCandidate" ? 1 : 0;
}

function getArchitectureConfidenceRank(
  confidence: ProjectReadingStep["architecture"]["confidence"]
): number {
  return confidence === "high" ? 3 : confidence === "medium" ? 2 : confidence === "low" ? 1 : 0;
}

function getEdgeConfidenceRank(confidence: SemanticFlowStep["confidence"]): number {
  if (confidence === "exact") return 0;
  if (confidence === "resolved") return 1;
  if (confidence === "inferred") return 2;
  return 3;
}

/** Walks parentFunctionId links iteratively and rejects cycles or broken chains. */
function walkBoundaryToHandler(
  handlerFunctionId: string,
  boundary: SemanticFlowStep,
  callByFunctionId: ReadonlyMap<string, SemanticFlowStep>
): SemanticFlowStep[] | undefined {
  const reverseChain: SemanticFlowStep[] = [];
  const visitedFunctionIds = new Set<string>();
  let current: SemanticFlowStep | undefined = boundary;

  while (current) {
    reverseChain.push(current);
    const parentFunctionId = current.parentFunctionId;
    if (parentFunctionId === handlerFunctionId) {
      return reverseChain.reverse();
    }
    if (!parentFunctionId || visitedFunctionIds.has(parentFunctionId)) {
      return undefined;
    }

    visitedFunctionIds.add(parentFunctionId);
    current = callByFunctionId.get(parentFunctionId);
  }

  return undefined;
}

/** Identifies only explicit semantic or observed terminal boundary evidence. */
function getBoundaryKind(
  step: SemanticFlowStep,
  childrenByParentId: ReadonlyMap<string, SemanticFlowStep[]>
): ProjectReadingBoundaryKind | undefined {
  if (step.kind !== "call") {
    return undefined;
  }
  if (step.role === "repository") {
    return "repository";
  }
  if (step.role === "model") {
    return "model";
  }
  if (step.resolution === "external" || step.role === "external") {
    return "externalCall";
  }
  if (step.role === "sideEffect") {
    return "sideEffect";
  }
  if (step.resolution === "unresolved") {
    return "unresolvedCall";
  }
  if (
    step.functionId
    && (childrenByParentId.get(step.functionId)?.length ?? 0) === 0
  ) {
    return "observedTerminal";
  }

  return undefined;
}

/** Preserves the handler-side prefix and the selected boundary under the cap. */
function boundLearningChain(
  chain: readonly SemanticFlowStep[],
  limit: number,
  learningTarget: SemanticFlowStep | undefined,
  boundary: SemanticFlowStep | undefined
): SemanticFlowStep[] {
  if (chain.length <= limit) {
    return [...chain];
  }
  if (limit <= 0) {
    return [];
  }
  if (limit === 1) {
    return [learningTarget ?? boundary ?? chain[0]];
  }

  const selectedIndexes = new Set<number>([0]);
  const targetIndex = learningTarget ? chain.indexOf(learningTarget) : -1;
  const boundaryIndex = boundary ? chain.indexOf(boundary) : -1;
  if (targetIndex >= 0) {
    selectedIndexes.add(targetIndex);
  }
  if (boundaryIndex >= 0) {
    selectedIndexes.add(boundaryIndex);
  }
  for (let index = 0; index < chain.length && selectedIndexes.size < limit; index += 1) {
    selectedIndexes.add(index);
  }
  return [...selectedIndexes]
    .sort((left, right) => left - right)
    .slice(0, limit)
    .map((index) => chain[index]);
}

/** Orders explicit boundary kinds first, then uses stable source identity. */
function compareBoundaryChains(left: BoundaryChain, right: BoundaryChain): number {
  return BOUNDARY_KIND_ORDER[left.boundaryKind] - BOUNDARY_KIND_ORDER[right.boundaryKind]
    || compareSemanticFlowSteps(left.boundary, right.boundary);
}

/** Selects one comparator-minimum step without sorting a wide branch. */
function selectMinimumStep(
  steps: readonly SemanticFlowStep[],
  predicate: (step: SemanticFlowStep) => boolean
): SemanticFlowStep | undefined {
  let selected: SemanticFlowStep | undefined;

  for (const step of steps) {
    if (!predicate(step)) {
      continue;
    }
    if (!selected || compareSemanticFlowSteps(step, selected) < 0) {
      selected = step;
    }
  }

  return selected;
}

/** Appends an optional reserved step without exceeding the hard path limit. */
function appendWithinLimit(
  selected: SelectedReadingStep[],
  step: SemanticFlowStep | undefined
): void {
  if (step && selected.length < PROJECT_READING_STEP_LIMIT) {
    selected.push({ step });
  }
}

/** Copies only source-reading fields and preserves analyzer confidence. */
function toReadingStep(
  selected: SelectedReadingStep,
  architectureIndex: FunctionArchitectureIndex
): ProjectReadingStep {
  const step = selected.step;
  return {
    kind: step.kind,
    depth: step.depth,
    role: step.role,
    resolution: step.resolution,
    name: step.name,
    qualifiedName: step.qualifiedName ?? step.functionQualifiedName,
    functionId: step.functionId,
    ownerFunctionId: step.parentFunctionId,
    frameworkUnitId: step.frameworkUnitId,
    callEdgeId: step.callEdgeId,
    filePath: step.filePath,
    range: step.range,
    confidence: step.confidence,
    unitKind: step.unitKind,
    architecture: getReadingStepArchitecture(step, architectureIndex),
    contextInference: selected.contextInference
      ? { ...selected.contextInference, evidence: [...selected.contextInference.evidence] }
      : undefined,
    readingCues: [],
    boundaryKind: selected.boundaryKind
  };
}

/** Maps an explicit GraphQL root or HTTP route to the transport vocabulary. */
function getReadingTransport(
  flow: SemanticFlow,
  operationType: ProjectReadingGraphQLOperationType | undefined
): ProjectReadingTransport {
  if (flow.entrypointKind === "httpRoute") {
    return "http";
  }

  switch (operationType) {
    case "Query":
      return "graphqlQuery";
    case "Mutation":
      return "graphqlMutation";
    case "Subscription":
      return "graphqlSubscription";
    default:
      return "graphqlOther";
  }
}

/** States only observed traversal limits or unresolved calls, never runtime risk. */
function getTraceStatus(
  depthLimitReached: boolean,
  stepLimitReached: boolean,
  unresolvedCallCount: number
): ProjectReadingTraceStatus {
  if (depthLimitReached || stepLimitReached) {
    return "limited";
  }
  if (unresolvedCallCount > 0) {
    return "unresolved";
  }
  return "mapped";
}

/** Stable path identity composes the selected scope and entrypoint evidence. */
function createReadingPathId(scopeId: string, flow: SemanticFlow): string {
  return `${scopeId}:flow:${encodeURIComponent(flow.entrypointUnitId)}:${encodeURIComponent(flow.id)}`;
}

/** Orders source steps by structure, source coordinates, and analyzer identity. */
function compareSemanticFlowSteps(
  left: SemanticFlowStep,
  right: SemanticFlowStep
): number {
  return left.depth - right.depth
    || getStepKindOrder(left.kind) - getStepKindOrder(right.kind)
    || compareText(left.filePath, right.filePath)
    || compareOptionalNumbers(left.range?.startLine, right.range?.startLine)
    || compareOptionalNumbers(left.range?.startCharacter, right.range?.startCharacter)
    || compareText(left.functionId ?? "", right.functionId ?? "")
    || compareText(left.frameworkUnitId ?? "", right.frameworkUnitId ?? "")
    || compareText(left.callEdgeId ?? "", right.callEdgeId ?? "")
    || compareText(left.qualifiedName ?? left.name, right.qualifiedName ?? right.name);
}

/** Fixed structural ordering keeps entrypoint and handler stages predictable. */
function getStepKindOrder(kind: SemanticFlowStep["kind"]): number {
  switch (kind) {
    case "route":
    case "operation":
      return 0;
    case "handler":
      return 1;
    default:
      return 2;
  }
}

/** Puts present zero-based source coordinates before missing coordinates. */
function compareOptionalNumbers(left: number | undefined, right: number | undefined): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return left - right;
}

/** Locale-independent comparison for reproducible persisted projections. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
