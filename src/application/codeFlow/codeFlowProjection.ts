/**
 * Pure CodeFlow protocol projection. It turns the complete host-side graph and
 * semantic-flow index into bounded, source-tokenized reading surfaces without
 * depending on VS Code or browser APIs.
 */

import {
  createFunctionArchitecturePayload,
  formatArchitectureLayer
} from "../functionArchitecture";
import { createSourceDisplayFormatter } from "../sourcePresentation";
import type { FunctionArchitectureIndex } from "../../insights/architecturalLayers";
import type {
  SemanticFlow,
  SemanticFlowCoverageGap,
  SemanticFlowIndex,
  SemanticFlowStep
} from "../../insights/semanticFlow";
import type {
  CodeFlowDetailPayload,
  CodeFlowGapPayload,
  CodeFlowId,
  CodeFlowResolution,
  CodeFlowStage,
  CodeFlowStepPayload
} from "../../protocol/codeFlow";
import type { FunctionArchitecturePayload } from "../../protocol/functionArchitecture";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import { createContentHash } from "../../shared/hash";
import type {
  EdgeConfidence,
  GraphEdge,
  ProjectGraph,
  SymbolNode
} from "../../shared/types";
import {
  compareCodeFlowCatalogItems,
  createCodeFlowCatalogItem
} from "./codeFlowCatalog";
import { createCodeFlowIdentity } from "./codeFlowIdentity";

/** Conservative defaults keep the narrow reader usable on large call graphs. */
const SYMBOL_FLOW_DEFAULT_MAX_DEPTH = 3;
const SYMBOL_FLOW_DEFAULT_MAX_STEPS = 30;
const SYMBOL_FLOW_DEFAULT_ORIGIN_LIMIT = 5;
const SYMBOL_FLOW_ALLOWED_MAX_DEPTH = 12;
const SYMBOL_FLOW_ALLOWED_MAX_STEPS = 200;
const SYMBOL_FLOW_ALLOWED_ORIGIN_LIMIT = 20;
const DISPLAY_TEXT_LIMIT = 180;

const CONFIDENCE_RANK: Record<EdgeConfidence, number> = {
  exact: 0,
  resolved: 1,
  inferred: 2,
  unresolved: 3
};

/** Host callback replacing a concrete graph identity with a source token. */
export type CodeFlowSourceTokenFactory = (
  nodeId: string
) => SourceNodeToken | undefined;

/** Caller-controlled traversal bounds for a selected-function context. */
export type SymbolCodeFlowProjectionOptions = {
  maxDepth?: number;
  maxSteps?: number;
  originLimit?: number;
  maxLogicBlocks?: number;
};

/** Projects one framework entrypoint and its static downstream call evidence. */
export function createEntrypointCodeFlowDetail(
  graph: ProjectGraph,
  flow: SemanticFlow,
  deliveryVersion: string,
  architectureIndex: FunctionArchitectureIndex,
  createSourceToken: CodeFlowSourceTokenFactory
): CodeFlowDetailPayload {
  const flowId = createCodeFlowIdentity(deliveryVersion, flow.id);
  const sourceDisplay = createSourceDisplayFormatter(graph.workspaceRoot);
  const stepIdsByFunctionId = new Map<string, string>();
  const steps: CodeFlowStepPayload[] = [];
  let boundaryStepId: string | undefined;

  for (let index = 0; index < flow.steps.length; index += 1) {
    const step = flow.steps[index];
    const stepId = createStepId(flowId, step, index);
    const architecture = getStepArchitecture(step, architectureIndex);
    const parentId = getSemanticStepParentId(step, boundaryStepId, stepIdsByFunctionId);
    const payload = createSemanticStepPayload(
      step,
      stepId,
      parentId,
      architecture,
      sourceDisplay.location(step.filePath, step.range),
      createSourceToken
    );

    steps.push(payload);
    if (step.kind === "route" || step.kind === "operation") {
      boundaryStepId = stepId;
    }
    if (step.functionId && step.resolution === "concrete") {
      stepIdsByFunctionId.set(step.functionId, stepId);
    }
  }

  const gaps = flow.coverageGaps.map((gap, index) =>
    createSemanticGapPayload(flowId, gap, index)
  );

  return {
    graphVersion: deliveryVersion,
    id: flowId,
    kind: "entrypoint",
    title: safeText(flow.name, "Unnamed entrypoint"),
    subtitle: createEntrypointSubtitle(flow),
    semantics: "static",
    focusStepId: boundaryStepId,
    steps,
    origins: [],
    gaps,
    summary: createDetailSummary(steps, gaps)
  };
}

/**
 * Builds a selected-function context with known entrypoints and bounded callees.
 * The iterative queue and flow-wide visited set keep large cyclic call graphs
 * finite without presenting duplicate targets as additional execution events.
 */
export function createSymbolCodeFlowDetail(
  graph: ProjectGraph,
  semanticFlows: SemanticFlowIndex,
  node: SymbolNode,
  deliveryVersion: string,
  architectureIndex: FunctionArchitectureIndex,
  createSourceToken: CodeFlowSourceTokenFactory,
  options: SymbolCodeFlowProjectionOptions = {}
): CodeFlowDetailPayload {
  const maxDepth = normalizeProjectionLimit(
    options.maxDepth,
    SYMBOL_FLOW_DEFAULT_MAX_DEPTH,
    SYMBOL_FLOW_ALLOWED_MAX_DEPTH,
    0
  );
  const maxSteps = normalizeProjectionLimit(
    options.maxSteps,
    SYMBOL_FLOW_DEFAULT_MAX_STEPS,
    SYMBOL_FLOW_ALLOWED_MAX_STEPS,
    1
  );
  const originLimit = normalizeProjectionLimit(
    options.originLimit,
    SYMBOL_FLOW_DEFAULT_ORIGIN_LIMIT,
    SYMBOL_FLOW_ALLOWED_ORIGIN_LIMIT,
    0
  );
  const flowId = createCodeFlowIdentity(deliveryVersion, `symbol\0${node.id}`);
  const sourceDisplay = createSourceDisplayFormatter(graph.workspaceRoot);
  const nodesById = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
  const outgoingCallsBySourceId = createOutgoingCallIndex(graph.edges, nodesById);
  const rootArchitecture = getNodeArchitecture(node.id, architectureIndex);
  const rootStepId = createContentBoundStepId(flowId, `root\0${node.id}`);
  const rootSourceLocation = sourceDisplay.location(node.filePath, node.range);
  const steps: CodeFlowStepPayload[] = [
    createNodeStepPayload({
      stepId: rootStepId,
      node,
      depth: 0,
      architecture: rootArchitecture,
      confidence: undefined,
      resolution: "concrete",
      sourceLocation: rootSourceLocation,
      sourceToken: createSourceToken(node.id),
      evidenceLabel: "Selected source definition"
    })
  ];
  const gaps: CodeFlowGapPayload[] = [];
  const visitedNodeIds = new Set<string>([node.id]);
  const queue: Array<{ nodeId: string; stepId: string; depth: number }> = [
    { nodeId: node.id, stepId: rootStepId, depth: 0 }
  ];
  let queueIndex = 0;
  let duplicateOrCycleCount = 0;
  let depthLimitedCount = 0;
  let stepLimitedCount = 0;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;
    const outgoing = outgoingCallsBySourceId.get(current.nodeId) ?? [];

    if (outgoing.length === 0) {
      continue;
    }
    if (current.depth >= maxDepth) {
      depthLimitedCount += outgoing.length;
      continue;
    }

    for (const edge of outgoing) {
      if (steps.length >= maxSteps) {
        stepLimitedCount += 1;
        continue;
      }

      if (visitedNodeIds.has(edge.targetId)) {
        duplicateOrCycleCount += 1;
        continue;
      }

      const target = nodesById.get(edge.targetId);
      const resolution = getEdgeResolution(edge, target);
      const stepId = createContentBoundStepId(flowId, `edge\0${edge.id}`);
      const architecture = target && resolution === "concrete"
        ? getNodeArchitecture(target.id, architectureIndex)
        : undefined;
      const usesDefinition = target !== undefined && resolution === "concrete";
      const sourceLocation = sourceDisplay.location(
        usesDefinition ? target.filePath : edge.filePath,
        usesDefinition ? target.range : edge.range
      );
      const targetLabel = getCallTargetLabel(edge, target);

      steps.push(
        target
          ? createNodeStepPayload({
              stepId,
              parentId: current.stepId,
              node: target,
              depth: current.depth + 1,
              architecture,
              confidence: edge.confidence,
              resolution,
              sourceLocation,
              sourceToken: usesDefinition ? createSourceToken(target.id) : undefined,
              evidenceLabel: createCallEvidenceLabel(edge.confidence, resolution)
            })
          : createMissingTargetStepPayload({
              stepId,
              parentId: current.stepId,
              label: targetLabel,
              depth: current.depth + 1,
              confidence: edge.confidence,
              sourceLocation
            })
      );
      visitedNodeIds.add(edge.targetId);

      if (target && resolution === "concrete" && isCallableNode(target)) {
        queue.push({
          nodeId: target.id,
          stepId,
          depth: current.depth + 1
        });
      }
    }
  }

  if (depthLimitedCount > 0) {
    gaps.push(createBoundGap(
      flowId,
      "depthLimit",
      "More calls beyond the reading depth",
      `${depthLimitedCount} additional call relationship(s) were left collapsed at depth ${maxDepth}.`
    ));
  }
  if (stepLimitedCount > 0) {
    gaps.push(createBoundGap(
      flowId,
      "stepLimit",
      "Flow step limit reached",
      `At least ${stepLimitedCount} additional call relationship(s) were omitted after ${maxSteps} visible steps.`
    ));
  }
  if (duplicateOrCycleCount > 0) {
    gaps.push(createBoundGap(
      flowId,
      "cycleOrDuplicate",
      "Repeated or cyclic calls collapsed",
      `${duplicateOrCycleCount} relationship(s) reached a function already represented in this flow.`
    ));
  }

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
    .slice(0, originLimit);

  if (originFlows.length === 0) {
    gaps.push(createBoundGap(
      flowId,
      "entrypointNotFound",
      "No supported entrypoint found",
      "The current static index does not connect this function to a supported HTTP or GraphQL entrypoint."
    ));
  }

  return {
    graphVersion: deliveryVersion,
    id: flowId,
    kind: "symbol",
    title: safeText(node.qualifiedName || node.name, "Anonymous callable"),
    subtitle: rootSourceLocation
      ? `Function context · ${rootSourceLocation}`
      : "Function context",
    semantics: "static",
    focusStepId: rootStepId,
    steps,
    origins,
    gaps,
    summary: createDetailSummary(steps, gaps)
  };
}

/** Converts one domain step while preserving definition/callsite semantics. */
function createSemanticStepPayload(
  step: SemanticFlowStep,
  stepId: string,
  parentId: string | undefined,
  architecture: FunctionArchitecturePayload,
  sourceLocation: string | undefined,
  createSourceToken: CodeFlowSourceTokenFactory
): CodeFlowStepPayload {
  const concrete = step.resolution === "concrete";
  const sourceToken = concrete && step.functionId
    ? createSourceToken(step.functionId)
    : undefined;
  const resolution: CodeFlowResolution = step.kind === "route" || step.kind === "operation"
    ? "concrete"
    : step.resolution;
  const label =
    step.functionQualifiedName
    ?? step.functionName
    ?? step.qualifiedName
    ?? step.name;

  return {
    id: stepId,
    parentId,
    stage: getSemanticStepStage(step, architecture),
    label: safeText(label, "Unnamed flow step"),
    detail: createStepDetail(step, architecture, sourceLocation),
    depth: Math.max(0, step.depth),
    relation: step.kind === "route" || step.kind === "operation" ? "starts" : "calls",
    confidence: step.confidence,
    resolution,
    architectureLayer: architecture.layer,
    sourceToken,
    sourceLocation,
    evidenceLabel: createSemanticEvidenceLabel(step)
  };
}

/** Creates one concrete or external node step for an arbitrary symbol flow. */
function createNodeStepPayload(input: {
  stepId: string;
  parentId?: string;
  node: SymbolNode;
  depth: number;
  architecture?: FunctionArchitecturePayload;
  confidence?: EdgeConfidence;
  resolution: CodeFlowResolution;
  sourceLocation?: string;
  sourceToken?: SourceNodeToken;
  evidenceLabel: string;
}): CodeFlowStepPayload {
  const architecture = input.architecture;
  const stage = getNodeStage(input.node, input.resolution, architecture);
  const location = input.sourceLocation ? ` · ${input.sourceLocation}` : "";
  const layer = architecture ? formatArchitectureLayer(architecture.layer) : "Unclassified";

  return {
    id: input.stepId,
    parentId: input.parentId,
    stage,
    label: safeText(input.node.qualifiedName || input.node.name, "Anonymous callable"),
    detail: `${layer}${location}`,
    depth: input.depth,
    relation: input.parentId ? "calls" : undefined,
    confidence: input.confidence,
    resolution: input.resolution,
    architectureLayer: architecture?.layer,
    sourceToken: input.sourceToken,
    sourceLocation: input.sourceLocation,
    evidenceLabel: input.evidenceLabel
  };
}

/** Represents an edge whose target node is absent without inventing source. */
function createMissingTargetStepPayload(input: {
  stepId: string;
  parentId: string;
  label: string;
  depth: number;
  confidence: EdgeConfidence;
  sourceLocation?: string;
}): CodeFlowStepPayload {
  return {
    id: input.stepId,
    parentId: input.parentId,
    stage: "unknown",
    label: safeText(input.label, "Unresolved call target"),
    detail: input.sourceLocation
      ? `Unresolved callsite · ${input.sourceLocation}`
      : "Unresolved callsite",
    depth: input.depth,
    relation: "calls",
    confidence: input.confidence,
    resolution: "unresolved",
    sourceLocation: input.sourceLocation,
    evidenceLabel: createCallEvidenceLabel(input.confidence, "unresolved")
  };
}

/** Finds the visible parent without relying on recursive tree construction. */
function getSemanticStepParentId(
  step: SemanticFlowStep,
  boundaryStepId: string | undefined,
  stepIdsByFunctionId: Map<string, string>
): string | undefined {
  if (step.kind === "route" || step.kind === "operation") {
    return undefined;
  }
  if (step.kind === "handler") {
    return boundaryStepId;
  }
  if (step.parentFunctionId) {
    return stepIdsByFunctionId.get(step.parentFunctionId) ?? boundaryStepId;
  }
  return boundaryStepId;
}

/** Returns bounded architecture evidence for one semantic step. */
function getStepArchitecture(
  step: SemanticFlowStep,
  architectureIndex: FunctionArchitectureIndex
): FunctionArchitecturePayload {
  if (step.kind === "route" || step.kind === "operation") {
    return {
      layer: "entrypoint",
      confidence: "medium",
      businessLogic: "notBusinessLogic",
      purity: "unknown",
      evidence: ["Framework route or operation is the flow boundary."],
      alternatives: [],
      conflicted: false
    };
  }

  const architecture = step.functionId
    ? architectureIndex.assessmentsByFunctionId.get(step.functionId)
    : undefined;
  return architecture
    ? createFunctionArchitecturePayload(architecture)
    : createUnknownArchitecture();
}

/** Returns architecture evidence for one graph node without widening claims. */
function getNodeArchitecture(
  nodeId: string,
  architectureIndex: FunctionArchitectureIndex
): FunctionArchitecturePayload | undefined {
  const assessment = architectureIndex.assessmentsByFunctionId.get(nodeId);
  return assessment ? createFunctionArchitecturePayload(assessment) : undefined;
}

/** Fixed unknown architecture record used for unresolved or unclassified steps. */
function createUnknownArchitecture(): FunctionArchitecturePayload {
  return {
    layer: "unclassified",
    confidence: "unknown",
    businessLogic: "unknown",
    purity: "unknown",
    evidence: [],
    alternatives: [],
    conflicted: false
  };
}

/** Maps only supported evidence onto the reading frame's stage vocabulary. */
function getSemanticStepStage(
  step: SemanticFlowStep,
  architecture: FunctionArchitecturePayload
): CodeFlowStage {
  if (step.kind === "route" || step.kind === "operation") {
    return "boundary";
  }
  if (step.resolution === "unresolved") {
    return "unknown";
  }
  if (
    step.resolution === "external"
    || step.role === "repository"
    || step.role === "model"
    || step.role === "sideEffect"
    || architecture.layer === "dataAccess"
    || architecture.layer === "infrastructure"
  ) {
    return "effect";
  }
  if (
    architecture.businessLogic === "domainRuleCandidate"
    || architecture.businessLogic === "applicationWorkflowCandidate"
    || architecture.layer === "domain"
    || architecture.layer === "application"
  ) {
    return "decision";
  }
  if (step.kind === "handler" || architecture.layer === "interface") {
    return "boundary";
  }
  return "path";
}

/** Applies the same conservative stage rules to arbitrary graph nodes. */
function getNodeStage(
  node: SymbolNode,
  resolution: CodeFlowResolution,
  architecture: FunctionArchitecturePayload | undefined
): CodeFlowStage {
  if (resolution === "unresolved") {
    return "unknown";
  }
  if (
    resolution === "external"
    || node.kind === "external"
    || architecture?.layer === "dataAccess"
    || architecture?.layer === "infrastructure"
  ) {
    return "effect";
  }
  if (
    architecture?.businessLogic === "domainRuleCandidate"
    || architecture?.businessLogic === "applicationWorkflowCandidate"
    || architecture?.layer === "domain"
    || architecture?.layer === "application"
  ) {
    return "decision";
  }
  if (architecture?.layer === "entrypoint" || architecture?.layer === "interface") {
    return "boundary";
  }
  return "path";
}

/** Formats a compact detail without treating structural hints as runtime facts. */
function createStepDetail(
  step: SemanticFlowStep,
  architecture: FunctionArchitecturePayload,
  sourceLocation: string | undefined
): string {
  const layer = formatArchitectureLayer(architecture.layer);
  const role = getStepRoleLabel(step);
  const location = sourceLocation ? ` · ${sourceLocation}` : "";
  return `${layer} · ${role}${location}`;
}

/** Returns one short evidence label for the selected step. */
function createSemanticEvidenceLabel(step: SemanticFlowStep): string {
  if (step.kind === "route" || step.kind === "operation") {
    return "Framework entrypoint evidence";
  }
  if (step.kind === "handler") {
    return `Static handler mapping · ${step.confidence ?? "unresolved"}`;
  }
  return createCallEvidenceLabel(step.confidence ?? "unresolved", step.resolution);
}

/** Makes static edge semantics explicit at every call step. */
function createCallEvidenceLabel(
  confidence: EdgeConfidence,
  resolution: CodeFlowResolution
): string {
  const target = resolution === "concrete"
    ? "definition resolved"
    : resolution === "external"
      ? "external target"
      : "target unresolved";
  return `Static calls edge · ${confidence} · ${target}`;
}

/** Produces a role label without adding unsupported effect claims. */
function getStepRoleLabel(step: SemanticFlowStep): string {
  if (step.kind === "route") return "HTTP boundary";
  if (step.kind === "operation") return "GraphQL boundary";
  if (step.kind === "handler") return "Mapped handler";
  switch (step.role) {
    case "controller": return "Controller call";
    case "resolver": return "Resolver call";
    case "service": return "Service call";
    case "repository": return "Repository call";
    case "model": return "Model call";
    case "external": return "External call";
    case "sideEffect": return "Possible effect call";
    default: return step.resolution === "unresolved" ? "Unresolved call" : "Call";
  }
}

/** Converts domain coverage gaps into stable, display-safe protocol records. */
function createSemanticGapPayload(
  flowId: CodeFlowId,
  gap: SemanticFlowCoverageGap,
  index: number
): CodeFlowGapPayload {
  return {
    id: `${flowId}:gap:${gap.reason}:${index}`,
    reason: gap.reason,
    label: getGapLabel(gap.reason),
    detail: createGapDetail(gap)
  };
}

/** Creates a non-domain gap for arbitrary symbol context. */
function createBoundGap(
  flowId: CodeFlowId,
  reason: CodeFlowGapPayload["reason"],
  label: string,
  detail: string
): CodeFlowGapPayload {
  return {
    id: `${flowId}:gap:${reason}`,
    reason,
    label,
    detail
  };
}

/** Removes graph identities from existing domain diagnostic prose. */
function createGapDetail(gap: SemanticFlowCoverageGap): string {
  switch (gap.reason) {
    case "ambiguous":
      return `${gap.candidateFunctionIds.length} equally trusted handler candidate(s) remain.`;
    case "handlerNotMapped":
      return "The framework entrypoint is visible, but no unique callable definition is mapped.";
    case "depthLimit":
      return `${gap.omittedFunctionIds.length} known call target(s) continue beyond depth ${gap.limit ?? "limit"}.`;
    case "stepLimit":
      return `${gap.omittedFunctionIds.length} known call target(s) were omitted after the step limit.`;
  }
}

/** Human-readable gap label shared by entrypoint flows. */
function getGapLabel(reason: SemanticFlowCoverageGap["reason"]): string {
  switch (reason) {
    case "ambiguous": return "Handler mapping is ambiguous";
    case "handlerNotMapped": return "Handler definition is unknown";
    case "depthLimit": return "More calls beyond the reading depth";
    case "stepLimit": return "Flow step limit reached";
  }
}

/** Counts only visible protocol state so omitted graph data is not implied. */
function createDetailSummary(
  steps: CodeFlowStepPayload[],
  gaps: CodeFlowGapPayload[]
): CodeFlowDetailPayload["summary"] {
  return {
    stepCount: steps.length,
    concreteStepCount: steps.filter((step) => step.resolution === "concrete").length,
    decisionStepCount: steps.filter((step) => step.stage === "decision").length,
    effectStepCount: steps.filter((step) => step.stage === "effect").length,
    unknownStepCount: steps.filter((step) => step.stage === "unknown").length,
    gapCount: gaps.length
  };
}

/** Builds deterministic, calls-only outgoing buckets with target dedupe. */
function createOutgoingCallIndex(
  edges: GraphEdge[],
  nodesById: Map<string, SymbolNode>
): Map<string, GraphEdge[]> {
  const bestBySourceAndTarget = new Map<string, Map<string, GraphEdge>>();

  for (const edge of edges) {
    if (edge.kind !== "calls") {
      continue;
    }
    const byTarget = bestBySourceAndTarget.get(edge.sourceId) ?? new Map<string, GraphEdge>();
    const current = byTarget.get(edge.targetId);
    if (!current || compareCallEdges(edge, current, nodesById) < 0) {
      byTarget.set(edge.targetId, edge);
    }
    bestBySourceAndTarget.set(edge.sourceId, byTarget);
  }

  const result = new Map<string, GraphEdge[]>();
  for (const [sourceId, byTarget] of bestBySourceAndTarget) {
    result.set(
      sourceId,
      [...byTarget.values()].sort((left, right) => compareCallEdges(left, right, nodesById))
    );
  }
  return result;
}

/** Prefers stronger confidence, then stable target labels and edge identities. */
function compareCallEdges(
  left: GraphEdge,
  right: GraphEdge,
  nodesById: Map<string, SymbolNode>
): number {
  return CONFIDENCE_RANK[left.confidence] - CONFIDENCE_RANK[right.confidence]
    || compareText(
      getCallTargetLabel(left, nodesById.get(left.targetId)),
      getCallTargetLabel(right, nodesById.get(right.targetId))
    )
    || compareText(left.id, right.id);
}

/** Distinguishes a definition target from external and callsite-only evidence. */
function getEdgeResolution(
  edge: GraphEdge,
  target: SymbolNode | undefined
): CodeFlowResolution {
  if (edge.confidence === "unresolved" || !target) {
    return "unresolved";
  }
  return target.kind === "external" ? "external" : "concrete";
}

/** Reads only explicit display metadata before falling back to a generic label. */
function getCallTargetLabel(edge: GraphEdge, target: SymbolNode | undefined): string {
  if (target?.qualifiedName || target?.name) {
    return target.qualifiedName || target.name;
  }
  for (const key of ["targetName", "calleeName", "qualifiedName", "name"]) {
    const value = edge.metadata?.[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "Unresolved call target";
}

/** Narrows downstream expansion to callable definitions. */
function isCallableNode(node: SymbolNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Creates stable step identities without exposing edge or node IDs. */
function createStepId(
  flowId: CodeFlowId,
  step: SemanticFlowStep,
  index: number
): string {
  const identity = step.callEdgeId
    ?? step.functionId
    ?? step.frameworkUnitId
    ?? `${step.kind}\0${step.name}\0${index}`;
  return createContentBoundStepId(flowId, `${index}\0${identity}`);
}

/** Hashes one step identity inside its already opaque flow scope. */
function createContentBoundStepId(flowId: CodeFlowId, identity: string): string {
  return `code-step:${createContentHash(`${flowId}\0${identity}`).slice(0, 32)}`;
}

/** Entry flow subtitle describes evidence type without claiming execution. */
function createEntrypointSubtitle(flow: SemanticFlow): string {
  const kind = flow.entrypointKind === "httpRoute" ? "HTTP entrypoint" : "GraphQL operation";
  return `${safeText(flow.framework, "Unknown framework")} · ${kind} · static path`;
}

/** Locale-independent stable text ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Bounds analyzer-owned labels before they reach a compact visual surface. */
function safeText(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() || fallback;
  return normalized.length <= DISPLAY_TEXT_LIMIT
    ? normalized
    : `${normalized.slice(0, DISPLAY_TEXT_LIMIT - 1)}…`;
}

/** Normalizes public traversal inputs so callers can narrow but not unbound work. */
function normalizeProjectionLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
  minimum: number
): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.min(maximum, Math.max(minimum, Math.floor(value)));
}
