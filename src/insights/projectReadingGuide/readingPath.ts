/**
 * Deterministic representative execution paths for one selected project scope.
 *
 * Only mapped semantic flows are eligible. A path keeps the source entrypoint,
 * one concrete handler, and one fixed child chain. Child traversal is iterative,
 * visited-guarded, and capped at five steps; all omitted source steps remain
 * visible through exact counters.
 */

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
  type ProjectReadingGraphQLOperationType,
  type ProjectReadingPath,
  type ProjectReadingStep,
  type ProjectReadingTraceStatus,
  type ProjectReadingTransport
} from "./types";

/** Fixed transport order provides diversity without a repository-specific score. */
const READING_TRANSPORT_ORDER: ProjectReadingTransport[] = [
  "http",
  "graphqlQuery",
  "graphqlMutation",
  "graphqlSubscription",
  "graphqlOther"
];

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

/** Bounded mapped-flow projection with exact eligibility and omission counts. */
export type ProjectReadingPathProjection = {
  readingPaths: ProjectReadingPath[];
  mappedFlowCount: number;
  omittedMappedFlowCount: number;
  unmappedEntrypointCount: number;
};

/** Projects up to three identity-ordered mapped flows for a selected scope. */
export function createProjectReadingPaths(
  scope: IndexedProjectReadingScope
): ProjectReadingPathProjection {
  const selection = selectRepresentativeFlows(scope.flows);

  return {
    readingPaths: selection.flows.map((flow) => createReadingPath(scope.summary.id, flow)),
    mappedFlowCount: selection.mappedFlowCount,
    omittedMappedFlowCount: selection.mappedFlowCount - selection.flows.length,
    unmappedEntrypointCount: scope.flows.length - selection.mappedFlowCount
  };
}

/** Selects one flow per transport bucket before filling any remaining budget. */
function selectRepresentativeFlows(
  flows: readonly SemanticFlow[]
): { flows: SemanticFlow[]; mappedFlowCount: number } {
  const representativeByTransport = new Map<ProjectReadingTransport, SemanticFlow>();
  const fallbackFlows: SemanticFlow[] = [];
  let mappedFlowCount = 0;

  for (const flow of flows) {
    if (!isMappedSemanticFlow(flow)) {
      continue;
    }

    mappedFlowCount += 1;
    const transport = getReadingTransport(
      flow,
      flow.entrypointKind === "graphqlOperation"
        ? getGraphQLOperationType(flow)
        : undefined
    );
    const current = representativeByTransport.get(transport);

    if (!current) {
      representativeByTransport.set(transport, flow);
    } else if (compareSemanticFlows(flow, current) < 0) {
      insertBoundedFlow(fallbackFlows, current);
      representativeByTransport.set(transport, flow);
    } else {
      insertBoundedFlow(fallbackFlows, flow);
    }
  }

  const representatives = READING_TRANSPORT_ORDER
    .map((transport) => representativeByTransport.get(transport))
    .filter((flow): flow is SemanticFlow => flow !== undefined);
  const selected = representatives.slice(0, PROJECT_READING_PATH_LIMIT);

  if (selected.length < PROJECT_READING_PATH_LIMIT) {
    selected.push(...fallbackFlows.slice(0, PROJECT_READING_PATH_LIMIT - selected.length));
  }

  return { flows: selected, mappedFlowCount };
}

/** Inserts one fallback into an already bounded, identity-ordered flow prefix. */
function insertBoundedFlow(selected: SemanticFlow[], flow: SemanticFlow): void {
  let insertionIndex = 0;
  while (
    insertionIndex < selected.length
    && compareSemanticFlows(selected[insertionIndex], flow) <= 0
  ) {
    insertionIndex += 1;
  }

  if (insertionIndex >= PROJECT_READING_PATH_LIMIT) {
    return;
  }
  selected.splice(insertionIndex, 0, flow);
  if (selected.length > PROJECT_READING_PATH_LIMIT) {
    selected.pop();
  }
}

/** Converts one mapped semantic flow into a bounded, linear source-reading path. */
function createReadingPath(scopeId: string, flow: SemanticFlow): ProjectReadingPath {
  const selectedSteps = selectReadingSteps(flow.steps);
  const operationType = flow.entrypointKind === "graphqlOperation"
    ? getGraphQLOperationType(flow)
    : undefined;
  const depthLimitReached = flow.coverageGaps.some((gap) => gap.reason === "depthLimit");
  const stepLimitReached = flow.coverageGaps.some((gap) => gap.reason === "stepLimit");
  const unresolvedCallCount = flow.steps.filter((step) =>
    step.kind === "call" && step.resolution === "unresolved"
  ).length;

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
    steps: selectedSteps.map(toReadingStep),
    totalStepCount: flow.steps.length,
    omittedStepCount: Math.max(0, flow.steps.length - selectedSteps.length),
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
function selectReadingSteps(steps: readonly SemanticFlowStep[]): SelectedReadingStep[] {
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
  const boundaryChain = selectBoundaryChain(handler.functionId, steps, callIndex);
  if (!boundaryChain) {
    return selected;
  }

  const availableCallSteps = PROJECT_READING_STEP_LIMIT - selected.length;
  const boundedChain = boundBoundaryChain(boundaryChain.chain, availableCallSteps);

  for (const step of boundedChain) {
    selected.push({
      step,
      boundaryKind: step === boundaryChain.boundary
        ? boundaryChain.boundaryKind
        : undefined
    });
  }

  return selected;
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
  callIndex: CallStepIndex
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

    const candidate: BoundaryChain = { boundaryKind, boundary: step, chain };
    if (!selected || compareBoundaryChains(candidate, selected) < 0) {
      selected = candidate;
    }
  }

  return selected;
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
function boundBoundaryChain(
  chain: readonly SemanticFlowStep[],
  limit: number
): SemanticFlowStep[] {
  if (chain.length <= limit) {
    return [...chain];
  }
  if (limit <= 0) {
    return [];
  }
  if (limit === 1) {
    return [chain[chain.length - 1]];
  }

  return chain.slice(0, limit - 1).concat(chain[chain.length - 1]);
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
function toReadingStep(selected: SelectedReadingStep): ProjectReadingStep {
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
