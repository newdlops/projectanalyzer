/**
 * Function Explorer projection for HTTP route and GraphQL operation flows.
 * This application adapter is the only layer that translates insight-domain
 * evidence and coverage gaps into Webview protocol rows.
 */

import type { SemanticFlow, SemanticFlowIndex, SemanticFlowStep } from "../../insights/semanticFlow";
import type {
  FunctionExplorerJsonValue,
  FunctionExplorerRole,
  FunctionExplorerRow
} from "../../protocol/functionExplorer";

/** Stable wire-compatible section root used by existing Function Explorer refresh requests. */
export const REQUEST_FLOW_ROWS_ROOT_ID = "function-flows:framework-handlers";

/** Options controlling expanded request-flow branches. */
export type SemanticFlowRowsOptions = {
  expandedRowIds?: Iterable<string>;
};

/**
 * Creates a summary-first default that stays bounded in large repositories.
 * Framework buckets remain collapsed until the user chooses a concrete scope.
 */
export function createDefaultSemanticFlowExpandedRowIds(_index: SemanticFlowIndex): string[] {
  return [REQUEST_FLOW_ROWS_ROOT_ID];
}

/** Projects semantic flows into a bounded, expandable request-flow tree. */
export function createSemanticFlowRows(
  index: SemanticFlowIndex,
  options: SemanticFlowRowsOptions = {}
): FunctionExplorerRow[] {
  const expandedRowIds = new Set(options.expandedRowIds ?? []);
  const flowsByFramework = groupFlowsByFramework(index.flows);
  const sectionExpanded = expandedRowIds.has(REQUEST_FLOW_ROWS_ROOT_ID);
  const rows: FunctionExplorerRow[] = [createSectionRow(index, sectionExpanded)];

  if (!sectionExpanded) {
    return rows;
  }

  for (const [framework, flows] of flowsByFramework) {
    appendFrameworkRows(rows, framework, flows, expandedRowIds);
  }

  return rows;
}

/** Creates the top-level Request Flows summary row. */
function createSectionRow(index: SemanticFlowIndex, expanded: boolean): FunctionExplorerRow {
  const summary = index.summary;

  return {
    id: REQUEST_FLOW_ROWS_ROOT_ID,
    sectionId: "frameworkHandlers",
    kind: "section",
    label: "Request Flows",
    depth: 0,
    hasChildren: summary.entrypointCount > 0,
    expanded: summary.entrypointCount > 0 && expanded,
    detail:
      `${summary.entrypointCount} entrypoints (${summary.routeCount} routes, ` +
      `${summary.operationCount} operations) / ${summary.mappedHandlerCount} handlers / ` +
      `${index.coverageGaps.length} gaps`,
    metadata: {
      name: "Request Flows",
      legacyKind: "semantic"
    }
  };
}

/** Appends one framework bucket and its currently visible entrypoint summaries. */
function appendFrameworkRows(
  rows: FunctionExplorerRow[],
  framework: string,
  flows: SemanticFlow[],
  expandedRowIds: Set<string>
): void {
  const rowId = createFrameworkRowId(framework);
  const expanded = expandedRowIds.has(rowId);
  const mappedCount = flows.filter(hasMappedHandler).length;

  rows.push({
    id: rowId,
    sectionId: "frameworkHandlers",
    kind: "bucket",
    label: framework,
    depth: 1,
    parentId: REQUEST_FLOW_ROWS_ROOT_ID,
    hasChildren: flows.length > 0,
    expanded,
    detail: createFrameworkDetail(flows, mappedCount),
    metadata: {
      framework,
      name: framework,
      legacyKind: "semantic"
    }
  });

  if (!expanded) {
    return;
  }

  const routeFlows = flows.filter((flow) => flow.entrypointKind === "httpRoute");
  const operationFlows = flows.filter((flow) => flow.entrypointKind === "graphqlOperation");

  for (const flow of routeFlows) {
    appendEntrypointRows(rows, rowId, 2, flow, expandedRowIds);
  }

  appendGraphQLOperationBuckets(rows, rowId, operationFlows, expandedRowIds);
}

/** Appends collapsed GraphQL scope and operation-type summaries. */
function appendGraphQLOperationBuckets(
  rows: FunctionExplorerRow[],
  frameworkRowId: string,
  flows: SemanticFlow[],
  expandedRowIds: Set<string>
): void {
  if (flows.length === 0) {
    return;
  }

  const flowsByRootPath = groupFlowsByRootPath(flows);
  const scoped = flowsByRootPath.length > 1;

  for (const [rootPath, rootFlows] of flowsByRootPath) {
    if (!scoped) {
      appendGraphQLOperationTypeBuckets(rows, frameworkRowId, 2, rootFlows, expandedRowIds);
      continue;
    }

    const scopeRowId = `${frameworkRowId}:scope:${encodeURIComponent(rootPath)}`;
    const expanded = expandedRowIds.has(scopeRowId);
    rows.push({
      id: scopeRowId,
      sectionId: "frameworkHandlers",
      kind: "bucket",
      label: rootPath || "workspace root",
      depth: 2,
      parentId: frameworkRowId,
      hasChildren: rootFlows.length > 0,
      expanded,
      detail: `${rootFlows.length} GraphQL operations`,
      metadata: { legacyKind: "semantic", name: rootPath || "workspace root", rootPath }
    });

    if (expanded) {
      appendGraphQLOperationTypeBuckets(rows, scopeRowId, 3, rootFlows, expandedRowIds);
    }
  }
}

/** Groups GraphQL operations as Query, Mutation, and Subscription summaries. */
function appendGraphQLOperationTypeBuckets(
  rows: FunctionExplorerRow[],
  parentId: string,
  depth: number,
  flows: SemanticFlow[],
  expandedRowIds: Set<string>
): void {
  for (const [operationType, operationFlows] of groupGraphQLOperationsByType(flows)) {
    const rowId = `${parentId}:graphql:${operationType.toLowerCase()}`;
    const expanded = expandedRowIds.has(rowId);
    rows.push({
      id: rowId,
      sectionId: "frameworkHandlers",
      kind: "bucket",
      label: operationType,
      depth,
      parentId,
      hasChildren: operationFlows.length > 0,
      expanded,
      detail: `${operationFlows.length} operations`,
      role: "schema",
      tags: ["frameworkDispatch"],
      metadata: { graphqlOperationType: operationType, legacyKind: "semantic", name: operationType }
    });

    if (!expanded) {
      continue;
    }

    for (const flow of operationFlows) {
      appendEntrypointRows(rows, rowId, depth + 1, flow, expandedRowIds);
    }
  }
}

/** Appends one entrypoint followed by handler or coverage-gap children. */
function appendEntrypointRows(
  rows: FunctionExplorerRow[],
  parentId: string,
  depth: number,
  flow: SemanticFlow,
  expandedRowIds: Set<string>
): void {
  const entrypointRowId = createEntrypointRowId(parentId, flow);
  const handlerSteps = flow.steps.filter((step) => step.kind === "handler");
  const resolvedHandler = handlerSteps.find(isConcreteHandlerStep);
  const hasChildren = handlerSteps.length > 0 || flow.coverageGaps.length > 0;
  const expanded = hasChildren && expandedRowIds.has(entrypointRowId);
  const entrypointStep = flow.steps.find((step) => step.kind === "route" || step.kind === "operation");

  rows.push({
    id: entrypointRowId,
    sectionId: "frameworkHandlers",
    kind: "relation",
    label: flow.name,
    depth,
    parentId,
    hasChildren,
    expanded,
    functionId: resolvedHandler?.functionId,
    symbolId: resolvedHandler?.functionId,
    detail: createEntrypointDetail(flow, handlerSteps),
    filePath: resolvedHandler?.filePath ?? entrypointStep?.filePath,
    range: resolvedHandler?.range ?? entrypointStep?.range,
    functionKind: resolvedHandler ? "handler" : undefined,
    role: flow.entrypointKind === "graphqlOperation" ? "resolver" : "routeHandler",
    tags: ["frameworkDispatch"],
    confidence: flow.confidence ?? "unresolved",
    metadata: {
      complete: flow.coverageGaps.length === 0,
      entrypointKind: flow.entrypointKind,
      entrypointUnitId: flow.entrypointUnitId,
      flowId: flow.id,
      framework: flow.framework,
      frameworkUnitId: flow.entrypointUnitId,
      legacyKind: "semantic",
      name: flow.name
    }
  });

  if (!expanded) {
    return;
  }

  const callStepsByParentId = groupCallStepsByParentId(flow.steps);
  const limitGapsBySourceId = groupLimitGapsBySourceId(flow);

  for (const handlerStep of handlerSteps) {
    const handlerRow = createHandlerRow(entrypointRowId, depth + 1, flow, handlerStep);
    rows.push(handlerRow);
    appendDownstreamRows(
      rows,
      handlerRow,
      handlerStep,
      callStepsByParentId,
      limitGapsBySourceId
    );
  }

  for (const gap of flow.coverageGaps) {
    if (gap.sourceFunctionId) {
      continue;
    }

    rows.push({
      id: `${entrypointRowId}:gap:${gap.reason}`,
      sectionId: "frameworkHandlers",
      kind: "diagnostic",
      label: getCoverageGapLabel(gap.reason),
      depth: depth + 1,
      parentId: entrypointRowId,
      hasChildren: false,
      expanded: false,
      detail: gap.message,
      confidence: "unresolved",
      metadata: {
        candidateFunctionIds: gap.candidateFunctionIds,
        limit: gap.limit ?? null,
        omittedFunctionIds: gap.omittedFunctionIds,
        reason: gap.reason,
        sourceFunctionId: gap.sourceFunctionId ?? null,
        targetFrameworkUnitIds: gap.targetFrameworkUnitIds
      }
    });
  }
}

/** Creates a source-navigable handler row or a unit-only fallback row. */
function createHandlerRow(
  parentId: string,
  depth: number,
  flow: SemanticFlow,
  step: SemanticFlowStep
): FunctionExplorerRow {
  const label = step.functionQualifiedName ?? step.functionName ?? step.qualifiedName ?? step.name;
  const frameworkUnitId = step.frameworkUnitId ?? step.functionId ?? step.name;
  const concrete = step.resolution === "concrete" && step.functionId !== undefined;

  return {
    id: `${parentId}:handler:${encodeURIComponent(step.functionId ?? frameworkUnitId)}`,
    sectionId: "frameworkHandlers",
    kind: concrete ? "function" : "relation",
    label,
    depth,
    parentId,
    hasChildren: false,
    expanded: false,
    functionId: step.functionId,
    symbolId: concrete ? step.functionId : undefined,
    detail: `${getUnitKindLabel(step.unitKind)} · ${formatSourceLocation(step)}`,
    filePath: step.filePath,
    range: step.range,
    functionKind: concrete ? "handler" : step.functionId ? "unresolved" : undefined,
    role: toFunctionExplorerRole(step.role),
    tags: ["frameworkDispatch"],
    confidence: concrete ? flow.confidence ?? "unresolved" : "unresolved",
    metadata: {
      evidence: flow.evidence.map(toJsonEvidence),
      framework: flow.framework,
      frameworkUnitId,
      legacyKind: concrete ? "semantic" : "diagnostic",
      name: label
    }
  };
}

/**
 * Appends the bounded downstream call tree below one handler without recursive
 * projection. Core traversal already guarantees depth and step limits; the
 * adapter only preserves its parent relation and deterministic sibling order.
 */
function appendDownstreamRows(
  rows: FunctionExplorerRow[],
  handlerRow: FunctionExplorerRow,
  handlerStep: SemanticFlowStep,
  callStepsByParentId: Map<string, SemanticFlowStep[]>,
  limitGapsBySourceId: Map<string, SemanticFlow["coverageGaps"]>
): void {
  if (!handlerStep.functionId) {
    return;
  }

  const work: DownstreamProjectionWork[] = createDownstreamWork(
    handlerStep.functionId,
    handlerRow.id,
    handlerRow.depth,
    callStepsByParentId,
    limitGapsBySourceId
  );

  while (work.length > 0) {
    const current = work.pop();

    if (!current) {
      continue;
    }

    if (current.kind === "gap") {
      rows.push(createLimitGapRow(current.parentRowId, current.parentDepth, current.gap));
      continue;
    }

    const row = createDownstreamRow(current.parentRowId, current.parentDepth, current.step);
    rows.push(row);

    if (!current.step.functionId || current.step.resolution !== "concrete") {
      continue;
    }

    work.push(...createDownstreamWork(
      current.step.functionId,
      row.id,
      row.depth,
      callStepsByParentId,
      limitGapsBySourceId
    ));
  }
}

/** Stack item used to preserve pre-order output without recursive calls. */
type DownstreamProjectionWork =
  | {
    kind: "call";
    parentRowId: string;
    parentDepth: number;
    step: SemanticFlowStep;
  }
  | {
    kind: "gap";
    parentRowId: string;
    parentDepth: number;
    gap: SemanticFlow["coverageGaps"][number];
  };

/** Creates reverse-ordered stack work for one callable's children and limit gaps. */
function createDownstreamWork(
  functionId: string,
  parentRowId: string,
  parentDepth: number,
  callStepsByParentId: Map<string, SemanticFlowStep[]>,
  limitGapsBySourceId: Map<string, SemanticFlow["coverageGaps"]>
): DownstreamProjectionWork[] {
  const work: DownstreamProjectionWork[] = [];
  const gaps = limitGapsBySourceId.get(functionId) ?? [];
  const callSteps = callStepsByParentId.get(functionId) ?? [];

  // The stack pops from the end, so diagnostics are added first and calls are
  // reversed to retain the domain index's deterministic pre-order.
  for (let index = gaps.length - 1; index >= 0; index -= 1) {
    work.push({ kind: "gap", parentRowId, parentDepth, gap: gaps[index] });
  }

  for (let index = callSteps.length - 1; index >= 0; index -= 1) {
    work.push({ kind: "call", parentRowId, parentDepth, step: callSteps[index] });
  }

  return work;
}

/** Creates one source-navigable concrete call or an honest placeholder row. */
function createDownstreamRow(
  parentRowId: string,
  parentDepth: number,
  step: SemanticFlowStep
): FunctionExplorerRow {
  const label = step.functionQualifiedName ?? step.functionName ?? step.qualifiedName ?? step.name;
  const concrete = step.resolution === "concrete";
  const identity = step.callEdgeId ?? step.functionId ?? createStepLocationIdentity(step);

  return {
    id: `${parentRowId}:call:${encodeURIComponent(identity)}`,
    sectionId: "frameworkHandlers",
    kind: concrete ? "function" : "relation",
    label,
    depth: parentDepth + 1,
    parentId: parentRowId,
    hasChildren: false,
    expanded: false,
    functionId: step.functionId,
    symbolId: concrete ? step.functionId : undefined,
    edgeIds: step.callEdgeId ? [step.callEdgeId] : undefined,
    relation: "downstream",
    detail: `${getDownstreamKindLabel(step)} · ${formatSourceLocation(step)}`,
    filePath: step.filePath || undefined,
    range: step.range,
    functionKind: concrete
      ? "function"
      : step.resolution === "external"
        ? "external"
        : "unresolved",
    role: toFunctionExplorerRole(step.role),
    tags: getDownstreamTags(step),
    confidence: step.confidence ?? "unresolved",
    metadata: {
      callEdgeId: step.callEdgeId ?? null,
      flowDepth: step.depth,
      framework: step.framework ?? null,
      frameworkUnitId: step.frameworkUnitId ?? null,
      legacyKind: concrete ? "semantic" : "unresolved",
      name: label,
      parentFunctionId: step.parentFunctionId ?? null,
      relation: step.relation ?? null,
      resolution: step.resolution,
      semanticRole: step.role
    }
  };
}

/** Creates a nested diagnostic explaining a bounded traversal omission. */
function createLimitGapRow(
  parentRowId: string,
  parentDepth: number,
  gap: SemanticFlow["coverageGaps"][number]
): FunctionExplorerRow {
  return {
    id: `${parentRowId}:gap:${gap.reason}`,
    sectionId: "frameworkHandlers",
    kind: "diagnostic",
    label: getCoverageGapLabel(gap.reason),
    depth: parentDepth + 1,
    parentId: parentRowId,
    hasChildren: false,
    expanded: false,
    detail: gap.message,
    confidence: "unresolved",
    metadata: {
      limit: gap.limit ?? null,
      omittedFunctionIds: gap.omittedFunctionIds,
      reason: gap.reason,
      sourceFunctionId: gap.sourceFunctionId ?? null
    }
  };
}

/** Summarizes an entrypoint's resolved target or visible coverage gap. */
function createEntrypointDetail(flow: SemanticFlow, handlerSteps: SemanticFlowStep[]): string {
  const resolvedHandler = handlerSteps.find((step) => step.functionId !== undefined);
  const target = resolvedHandler ?? handlerSteps[0];
  const targetLabel = target
    ? target.functionQualifiedName ?? target.functionName ?? target.qualifiedName ?? target.name
    : "handler unknown";
  const status = flow.coverageGaps.length === 0 ? flow.confidence ?? "unresolved" : "coverage gap";

  return `${flow.framework} · ${targetLabel} · ${status}`;
}

/** Groups already deterministic flows without losing their domain order. */
function groupFlowsByFramework(flows: SemanticFlow[]): Array<[string, SemanticFlow[]]> {
  const flowsByFramework = new Map<string, SemanticFlow[]>();

  for (const flow of flows) {
    const frameworkFlows = flowsByFramework.get(flow.framework) ?? [];
    frameworkFlows.push(flow);
    flowsByFramework.set(flow.framework, frameworkFlows);
  }

  return [...flowsByFramework.entries()].sort(([left], [right]) => left.localeCompare(right));
}

/** Groups GraphQL operations by analyzer root without merging subprojects. */
function groupFlowsByRootPath(flows: SemanticFlow[]): Array<[string, SemanticFlow[]]> {
  const flowsByRootPath = new Map<string, SemanticFlow[]>();

  for (const flow of flows) {
    const rootFlows = flowsByRootPath.get(flow.rootPath) ?? [];
    rootFlows.push(flow);
    flowsByRootPath.set(flow.rootPath, rootFlows);
  }

  return [...flowsByRootPath.entries()].sort(([left], [right]) => left.localeCompare(right));
}

type GraphQLOperationType = "Query" | "Mutation" | "Subscription" | "Other";

/** Parses only the analyzer's documented `Query.field` qualified-name prefix. */
function getGraphQLOperationType(flow: SemanticFlow): GraphQLOperationType {
  const operation = flow.steps.find((step) => step.kind === "operation");
  const prefix = operation?.qualifiedName?.split(".", 1)[0];

  return prefix === "Query" || prefix === "Mutation" || prefix === "Subscription"
    ? prefix
    : "Other";
}

/** Returns operation buckets in execution-facing order, independent of input. */
function groupGraphQLOperationsByType(
  flows: SemanticFlow[]
): Array<[GraphQLOperationType, SemanticFlow[]]> {
  const order: GraphQLOperationType[] = ["Query", "Mutation", "Subscription", "Other"];
  const flowsByType = new Map<GraphQLOperationType, SemanticFlow[]>();

  for (const flow of flows) {
    const operationType = getGraphQLOperationType(flow);
    const typeFlows = flowsByType.get(operationType) ?? [];
    typeFlows.push(flow);
    flowsByType.set(operationType, typeFlows);
  }

  return order.flatMap((operationType) => {
    const typeFlows = flowsByType.get(operationType);
    return typeFlows ? [[operationType, typeFlows] as [GraphQLOperationType, SemanticFlow[]]] : [];
  });
}

/** Creates a compact framework-level summary without calling operations routes. */
function createFrameworkDetail(flows: SemanticFlow[], mappedCount: number): string {
  const routeCount = flows.filter((flow) => flow.entrypointKind === "httpRoute").length;
  const operationCount = flows.length - routeCount;

  if (operationCount === 0) {
    return `${routeCount} routes / ${mappedCount} handlers`;
  }

  if (routeCount === 0) {
    return `${operationCount} operations / ${mappedCount} resolvers`;
  }

  return `${routeCount} routes + ${operationCount} operations / ${mappedCount} handlers`;
}

/** Groups call steps by their concrete parent while preserving domain order. */
function groupCallStepsByParentId(steps: SemanticFlowStep[]): Map<string, SemanticFlowStep[]> {
  const stepsByParentId = new Map<string, SemanticFlowStep[]>();

  for (const step of steps) {
    if (step.kind !== "call" || !step.parentFunctionId) {
      continue;
    }

    const children = stepsByParentId.get(step.parentFunctionId) ?? [];
    children.push(step);
    stepsByParentId.set(step.parentFunctionId, children);
  }

  return stepsByParentId;
}

/** Groups only bounded-traversal diagnostics by the callable where expansion stopped. */
function groupLimitGapsBySourceId(
  flow: SemanticFlow
): Map<string, SemanticFlow["coverageGaps"]> {
  const gapsBySourceId = new Map<string, SemanticFlow["coverageGaps"]>();

  for (const gap of flow.coverageGaps) {
    if (!gap.sourceFunctionId || (gap.reason !== "depthLimit" && gap.reason !== "stepLimit")) {
      continue;
    }

    const gaps = gapsBySourceId.get(gap.sourceFunctionId) ?? [];
    gaps.push(gap);
    gapsBySourceId.set(gap.sourceFunctionId, gaps);
  }

  return gapsBySourceId;
}

/** Creates one stable framework bucket identity. */
function createFrameworkRowId(framework: string): string {
  return `${REQUEST_FLOW_ROWS_ROOT_ID}:framework:${encodeURIComponent(framework)}`;
}

/** Creates one stable entrypoint identity below its current scope bucket. */
function createEntrypointRowId(parentId: string, flow: SemanticFlow): string {
  const prefix = flow.entrypointKind === "graphqlOperation" ? "operation" : "route";
  return `${parentId}:${prefix}:${encodeURIComponent(flow.entrypointUnitId)}`;
}

/** Returns whether a route has a concrete source symbol handler. */
function hasMappedHandler(flow: SemanticFlow): boolean {
  return flow.steps.some(isConcreteHandlerStep);
}

/** Returns whether a handler identity is backed by a concrete navigable symbol. */
function isConcreteHandlerStep(step: SemanticFlowStep): boolean {
  return step.kind === "handler" && step.resolution === "concrete" && step.functionId !== undefined;
}

/** Formats source coordinates for compact tree details. */
function formatSourceLocation(step: SemanticFlowStep): string {
  const line = step.range ? `:${step.range.startLine + 1}` : "";
  return step.filePath ? `${step.filePath}${line}` : "source unavailable";
}

/** Converts framework unit kinds into concise user-facing labels. */
function getUnitKindLabel(unitKind: SemanticFlowStep["unitKind"]): string {
  if (unitKind === "operation") {
    return "Resolver";
  }

  return unitKind === "view" ? "View" : unitKind === "controller" ? "Controller" : "Handler";
}

/** Maps domain-only semantic roles onto the existing Function Explorer vocabulary. */
function toFunctionExplorerRole(role: SemanticFlowStep["role"]): FunctionExplorerRole {
  if (role === "model") {
    return "modelOperation";
  }

  if (role === "sideEffect") {
    return "unknown";
  }

  return role;
}

/** Returns a concise, evidence-safe call classification for a row detail. */
function getDownstreamKindLabel(step: SemanticFlowStep): string {
  if (step.resolution === "unresolved") {
    return "Unresolved call target";
  }

  if (step.resolution === "external") {
    return "External call target";
  }

  switch (step.role) {
    case "resolver": return "Resolver";
    case "controller": return "Controller";
    case "service": return "Service";
    case "repository": return "Repository";
    case "model": return "Model operation";
    case "sideEffect": return "Possible side effect";
    case "routeHandler": return "Route handler";
    default: return "Call";
  }
}

/** Converts every domain coverage category into an explicit user-facing diagnosis. */
function getCoverageGapLabel(reason: SemanticFlow["coverageGaps"][number]["reason"]): string {
  switch (reason) {
    case "ambiguous": return "Ambiguous handler mapping";
    case "handlerNotMapped": return "Handler symbol not resolved";
    case "depthLimit": return "More calls beyond depth limit";
    case "stepLimit": return "More calls beyond step limit";
  }
}

/** Adds only tags supported by the step's explicit resolution or role evidence. */
function getDownstreamTags(step: SemanticFlowStep): FunctionExplorerRow["tags"] {
  if (step.resolution === "unresolved") {
    return ["unresolvedCall"];
  }

  if (step.resolution === "external") {
    return ["externalCall"];
  }

  return step.role === "sideEffect" ? ["sideEffect"] : [];
}

/** Creates a deterministic fallback identity when an analyzer omitted edge identity. */
function createStepLocationIdentity(step: SemanticFlowStep): string {
  const start = step.range ? `${step.range.startLine}:${step.range.startCharacter}` : "unknown";
  return `${step.filePath}:${start}:${step.name}:${step.depth}`;
}

/** Converts typed domain evidence into the protocol's JSON metadata vocabulary. */
function toJsonEvidence(evidence: SemanticFlow["evidence"][number]): FunctionExplorerJsonValue {
  return {
    confidence: evidence.confidence,
    description: evidence.description,
    frameworkUnitId: evidence.frameworkUnitId,
    functionId: evidence.functionId ?? null,
    kind: evidence.kind,
    entrypointUnitId: evidence.entrypointUnitId,
    routeUnitId: evidence.routeUnitId ?? null,
    sourceFrameworkUnitId: evidence.sourceFrameworkUnitId ?? null,
    targetFrameworkUnitId: evidence.targetFrameworkUnitId ?? null
  };
}
