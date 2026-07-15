/**
 * Shared Project Reading Guide unit-test fixtures. Keeping graph and flow
 * builders separate lets scenario tests stay focused on ranking assertions.
 */

import assert from "node:assert/strict";
import {
  createProjectReadingGuideProjector,
  type ProjectScopeReadingGuide
} from "../../../insights/projectReadingGuide";
import type {
  SemanticFlow,
  SemanticFlowCoverageGap,
  SemanticFlowIndex,
  SemanticFlowStep
} from "../../../insights/semanticFlow";
import type {
  DetectedFramework,
  FrameworkUnit,
  ProjectGraph,
  SourceRange,
  SymbolNode
} from "../../../shared/types";

/** Projects the only visible scope for deterministic flow comparisons. */
export function projectOnlyScope(
  graph: ProjectGraph,
  flows: SemanticFlow[]
): ProjectScopeReadingGuide {
  const projector = createProjectReadingGuideProjector(
    graph,
    createFlowIndex(graph.version, flows)
  );
  return requireScope(projector.projectScope(projector.projectIndex().scopes[0]?.id ?? ""));
}

/** Narrows an optional scope result inside tests. */
export function requireScope(
  guide: ProjectScopeReadingGuide | undefined
): ProjectScopeReadingGuide {
  assert.ok(guide);
  return guide;
}

/** Creates a graph with explicit source file and callable fixtures. */
export function createGraph(options: {
  frameworks?: DetectedFramework[];
  units?: FrameworkUnit[];
  files?: string[];
  callables?: SymbolNode[];
} = {}): ProjectGraph {
  const fileNodes = (options.files ?? []).map((filePath, index) =>
    createFileNode(`file:${index}:${filePath}`, filePath)
  );
  const nodes = fileNodes.concat(options.callables ?? []);

  return {
    workspaceRoot: "/workspace",
    version: "project-reading-guide-test",
    generatedAt: "2026-07-13T00:00:00.000Z",
    nodes,
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      frameworks: options.frameworks ?? [],
      frameworkUnits: options.units ?? [],
      frameworkUnitEdges: [],
      fileCount: fileNodes.length,
      symbolCount: nodes.length,
      edgeCount: 0
    }
  };
}

/** Creates one deterministic framework detector record. */
export function createFramework(name: string, rootPath: string): DetectedFramework {
  return {
    name,
    ecosystem: "test",
    category: "backend",
    confidence: "high",
    rootPath,
    evidence: [`${name} fixture`]
  };
}

/** Creates one explicit framework unit, which is application-scope evidence. */
export function createFrameworkUnit(
  id: string,
  framework: string,
  rootPath: string
): FrameworkUnit {
  return {
    id,
    framework,
    rootPath,
    kind: "app",
    name: id,
    filePath: `${rootPath}/app.ts`,
    range: createRange(0)
  };
}

/** Creates one file graph node. */
function createFileNode(id: string, filePath: string): SymbolNode {
  return {
    id,
    kind: "file",
    name: filePath.split("/").at(-1) ?? filePath,
    qualifiedName: filePath,
    filePath,
    range: createRange(0),
    selectionRange: createRange(0),
    language: filePath.endsWith(".py") ? "python" : "typescript"
  };
}

/** Creates one callable node assigned by source path. */
export function createCallable(id: string, filePath: string): SymbolNode {
  return {
    id,
    kind: "function",
    name: id,
    qualifiedName: id,
    filePath,
    range: createRange(1),
    selectionRange: createRange(1),
    language: filePath.endsWith(".py") ? "python" : "typescript"
  };
}

/** Creates one mapped HTTP or GraphQL semantic flow. */
export function createMappedFlow(
  id: string,
  framework: string,
  rootPath: string,
  entrypointKind: SemanticFlow["entrypointKind"],
  operationType: "Query" | "Mutation" | "Subscription" | "Other" | undefined,
  options: { gaps?: SemanticFlowCoverageGap[] } = {}
): SemanticFlow {
  const operation = entrypointKind === "graphqlOperation";
  const entrypointStep: SemanticFlowStep = {
    kind: operation ? "operation" : "route",
    depth: 0,
    role: operation ? "resolver" : "routeHandler",
    resolution: "concrete",
    frameworkUnitId: id,
    functionId: id,
    framework,
    unitKind: operation ? "operation" : "route",
    name: id,
    qualifiedName: operation ? `${operationType ?? "Other"}.${id}` : id,
    filePath: `${rootPath}/routes.ts`,
    range: createRange(0)
  };
  const handlerId = `${id}:handler`;
  const handlerStep: SemanticFlowStep = {
    kind: "handler",
    depth: 1,
    role: operation ? "resolver" : "routeHandler",
    resolution: "concrete",
    frameworkUnitId: `${id}:handler-unit`,
    functionId: handlerId,
    framework,
    unitKind: operation ? "operation" : "controller",
    name: handlerId,
    functionName: handlerId,
    functionQualifiedName: handlerId,
    filePath: `${rootPath}/handler.ts`,
    range: createRange(1)
  };

  return {
    id,
    entrypointKind,
    entrypointUnitId: id,
    routeUnitId: operation ? undefined : id,
    framework,
    rootPath,
    name: id,
    steps: [entrypointStep, handlerStep],
    evidence: [{
      kind: "directCallable",
      confidence: "resolved",
      description: "test mapping",
      entrypointUnitId: id,
      routeUnitId: operation ? undefined : id,
      frameworkUnitId: handlerStep.frameworkUnitId ?? `${id}:handler-unit`,
      functionId: handlerId
    }],
    confidence: "resolved",
    coverageGaps: options.gaps ?? []
  };
}

/** Creates a GraphQL flow with no concrete handler. */
export function createUnmappedFlow(
  id: string,
  framework: string,
  rootPath: string,
  operationType: "Query" | "Mutation" | "Subscription" | "Other"
): SemanticFlow {
  const gap = createMappingGap(id);
  return {
    id,
    entrypointKind: "graphqlOperation",
    entrypointUnitId: id,
    framework,
    rootPath,
    name: id,
    steps: [{
      kind: "operation",
      depth: 0,
      role: "resolver",
      resolution: "unresolved",
      frameworkUnitId: id,
      framework,
      unitKind: "operation",
      name: id,
      qualifiedName: `${operationType}.${id}`,
      filePath: `${rootPath}/schema.ts`,
      range: createRange(0)
    }],
    evidence: [],
    coverageGaps: [gap]
  };
}

/** Creates one mapping gap associated with its entrypoint. */
export function createMappingGap(entrypointUnitId: string): SemanticFlowCoverageGap {
  return {
    entrypointUnitId,
    reason: "handlerNotMapped",
    message: "test mapping gap",
    candidateFunctionIds: [],
    targetFrameworkUnitIds: [],
    omittedFunctionIds: []
  };
}

/** Creates one concrete call step linked to an explicit parent function. */
export function createCallStep(
  functionId: string,
  parentFunctionId: string,
  role: SemanticFlowStep["role"],
  depth: number,
  filePath: string
): SemanticFlowStep {
  return {
    kind: "call",
    depth,
    role,
    resolution: "concrete",
    relation: "calls",
    parentFunctionId,
    callEdgeId: `edge:${parentFunctionId}:${functionId}`,
    confidence: "resolved",
    functionId,
    name: functionId,
    functionName: functionId,
    functionQualifiedName: functionId,
    filePath,
    range: createRange(depth)
  };
}

/** Creates all SemanticFlowIndex lookup maps without rebuilding analysis. */
export function createFlowIndex(graphVersion: string, flows: SemanticFlow[]): SemanticFlowIndex {
  const flowsByEntrypointUnitId = new Map<string, SemanticFlow[]>();
  const flowsByRouteUnitId = new Map<string, SemanticFlow[]>();
  const coverageGapsByEntrypointUnitId = new Map<string, SemanticFlowCoverageGap[]>();
  const coverageGapsByRouteUnitId = new Map<string, SemanticFlowCoverageGap[]>();
  const coverageGaps: SemanticFlowCoverageGap[] = [];

  for (const flow of flows) {
    flowsByEntrypointUnitId.set(flow.entrypointUnitId, [flow]);
    coverageGapsByEntrypointUnitId.set(flow.entrypointUnitId, flow.coverageGaps);
    coverageGaps.push(...flow.coverageGaps);
    if (flow.routeUnitId) {
      flowsByRouteUnitId.set(flow.routeUnitId, [flow]);
      coverageGapsByRouteUnitId.set(flow.routeUnitId, flow.coverageGaps);
    }
  }

  const ambiguousFlows = flows.filter((flow) =>
    flow.coverageGaps.some((gap) => gap.reason === "ambiguous")
  );

  return {
    graphVersion,
    flows,
    flowsByEntrypointUnitId,
    flowsByRouteUnitId,
    coverageGaps,
    coverageGapsByEntrypointUnitId,
    coverageGapsByRouteUnitId,
    summary: {
      graphVersion,
      entrypointCount: flows.length,
      routeCount: flows.filter((flow) => flow.entrypointKind === "httpRoute").length,
      operationCount: flows.filter((flow) => flow.entrypointKind === "graphqlOperation").length,
      mappedHandlerCount: flows.filter((flow) =>
        flow.steps.some((step) => step.kind === "handler" && step.functionId !== undefined)
      ).length,
      ambiguousEntrypointCount: ambiguousFlows.length,
      ambiguousRouteCount: ambiguousFlows.filter((flow) => flow.entrypointKind === "httpRoute").length,
      ambiguousOperationCount: ambiguousFlows.filter((flow) => flow.entrypointKind === "graphqlOperation").length,
      handlerNotMappedCount: flows.filter((flow) =>
        flow.coverageGaps.some((gap) => gap.reason === "handlerNotMapped")
      ).length
    }
  };
}

/** Creates a zero-based single-line source range. */
export function createRange(line: number): SourceRange {
  return {
    startLine: line,
    startCharacter: 0,
    endLine: line,
    endCharacter: 1
  };
}
