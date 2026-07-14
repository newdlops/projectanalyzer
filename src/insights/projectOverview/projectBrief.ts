/**
 * Deterministic Project Brief construction from graph and semantic-flow facts.
 *
 * The implementation groups entrypoints instead of listing them, retains at
 * most three representative groups, and never derives a business purpose from
 * source names or paths.
 */

import type {
  DetectedFramework,
  FrameworkUnit,
  LanguageSummary,
  ProjectGraph,
  SymbolNode
} from "../../shared/types";
import type { SemanticFlow, SemanticFlowIndex } from "../semanticFlow";
import {
  PROJECT_BRIEF_ENTRYPOINT_GROUP_LIMIT,
  type ProjectBrief,
  type ProjectBriefEntrypointGroup,
  type ProjectBriefFrameworkRoot,
  type ProjectBriefGraphQLOperationType,
  type ProjectBriefLanguage
} from "./types";

/** Maximum source identities retained as examples within one brief group. */
const REPRESENTATIVE_ENTRYPOINT_LIMIT = 3;

type MutableEntrypointGroup = ProjectBriefEntrypointGroup & {
  entrypointUnitIds: string[];
};

/**
 * Creates one compact Project Brief using a precomputed SemanticFlowIndex.
 * Neither input is mutated and ordering is independent from analyzer arrays.
 */
export function createProjectBrief(
  graph: ProjectGraph,
  semanticFlows: SemanticFlowIndex
): ProjectBrief {
  const executionGroups = createEntrypointGroups(semanticFlows.flows);
  const visibleGroups = executionGroups.slice(0, PROJECT_BRIEF_ENTRYPOINT_GROUP_LIMIT);
  const omittedGroups = executionGroups.slice(PROJECT_BRIEF_ENTRYPOINT_GROUP_LIMIT);
  const mappingGapCount = semanticFlows.flows.reduce(
    (count, flow) => count + (hasMappingGap(flow) ? 1 : 0),
    0
  );

  return {
    graphVersion: graph.version,
    scope: {
      analyzedFileCount: graph.metadata.fileCount,
      symbolCount: graph.metadata.symbolCount,
      callableCount: graph.nodes.filter(isCallable).length,
      callEdgeCount: graph.edges.filter((edge) => edge.kind === "calls").length
    },
    stack: {
      languages: createLanguageBrief(graph),
      frameworkRoots: createFrameworkRootBrief(graph)
    },
    executionSurface: {
      entrypointCount: semanticFlows.summary.entrypointCount,
      routeCount: semanticFlows.summary.routeCount,
      operationCount: semanticFlows.summary.operationCount,
      mappedCount: semanticFlows.summary.mappedHandlerCount,
      mappingGapCount,
      groups: visibleGroups,
      omittedGroupCount: omittedGroups.length,
      omittedEntrypointCount: omittedGroups.reduce(
        (count, group) => count + group.entrypointCount,
        0
      )
    },
    analysisCoverage: createAnalysisCoverage(graph, semanticFlows)
  };
}

/** Uses analyzer-provided language counts and falls back to declared names. */
function createLanguageBrief(graph: ProjectGraph): ProjectBriefLanguage[] {
  const summaries = graph.metadata.languageSummary;

  if (summaries && summaries.length > 0) {
    return [...summaries]
      .sort(compareLanguageSummaries)
      .map((summary) => ({
        language: summary.language,
        fileCount: summary.fileCount,
        percentage: summary.percentage
      }));
  }

  return uniqueSortedStrings(graph.metadata.languages).map((language) => ({ language }));
}

/** Unifies detected frameworks and source-backed framework-unit roots. */
function createFrameworkRootBrief(graph: ProjectGraph): ProjectBriefFrameworkRoot[] {
  const rootsByIdentity = new Map<string, ProjectBriefFrameworkRoot>();
  const detectedScopeKeys = new Set<string>();

  for (const framework of graph.metadata.frameworks ?? []) {
    const root = createDetectedFrameworkRoot(framework, graph.workspaceRoot);
    const identityKey = createFrameworkRootKey(root.name, root.rootPath, root.ecosystem);
    const current = rootsByIdentity.get(identityKey);

    rootsByIdentity.set(identityKey, selectPreferredFrameworkRoot(current, root));
    detectedScopeKeys.add(createFrameworkScopeKey(root.name, root.rootPath));
  }

  for (const unit of graph.metadata.frameworkUnits ?? []) {
    const scopeKey = createFrameworkScopeKey(unit.framework, unit.rootPath);

    if (!detectedScopeKeys.has(scopeKey)) {
      const root = createFrameworkUnitRoot(unit);
      rootsByIdentity.set(createFrameworkRootKey(root.name, root.rootPath), root);
    }
  }

  return [...rootsByIdentity.values()].sort(compareFrameworkRoots);
}

/** Selects duplicate detector evidence without depending on input array order. */
function selectPreferredFrameworkRoot(
  current: ProjectBriefFrameworkRoot | undefined,
  candidate: ProjectBriefFrameworkRoot
): ProjectBriefFrameworkRoot {
  if (!current) {
    return candidate;
  }

  const confidenceDifference = getFrameworkConfidenceRank(candidate.confidence)
    - getFrameworkConfidenceRank(current.confidence);
  if (confidenceDifference !== 0) {
    return confidenceDifference > 0 ? candidate : current;
  }

  const categoryDifference = Number(candidate.category !== "unknown")
    - Number(current.category !== "unknown");
  if (categoryDifference !== 0) {
    return categoryDifference > 0 ? candidate : current;
  }

  return compareText(candidate.category, current.category) < 0 ? candidate : current;
}

/** Ranks only analyzer-declared confidence without inventing a score. */
function getFrameworkConfidenceRank(
  confidence: ProjectBriefFrameworkRoot["confidence"]
): number {
  return confidence === "high" ? 3 : confidence === "medium" ? 2 : confidence === "low" ? 1 : 0;
}

/** Converts one detector record without strengthening missing fields. */
function createDetectedFrameworkRoot(
  framework: DetectedFramework,
  workspaceRoot: string
): ProjectBriefFrameworkRoot {
  return {
    name: framework.name,
    ecosystem: framework.ecosystem,
    category: framework.category,
    confidence: framework.confidence,
    rootPath: framework.rootPath ?? workspaceRoot
  };
}

/** Creates a conservative root record when only framework units are present. */
function createFrameworkUnitRoot(unit: FrameworkUnit): ProjectBriefFrameworkRoot {
  return {
    name: unit.framework,
    category: "unknown",
    rootPath: unit.rootPath
  };
}

/** Groups flows by explicit framework root, entrypoint kind, and operation type. */
function createEntrypointGroups(flows: SemanticFlow[]): ProjectBriefEntrypointGroup[] {
  const groupsByIdentity = new Map<string, MutableEntrypointGroup>();

  for (const flow of flows) {
    const operationType = flow.entrypointKind === "graphqlOperation"
      ? getGraphQLOperationType(flow)
      : undefined;
    const id = createEntrypointGroupId(flow, operationType);
    const group = groupsByIdentity.get(id) ?? {
      id,
      framework: flow.framework,
      rootPath: flow.rootPath,
      entrypointKind: flow.entrypointKind,
      operationType,
      entrypointCount: 0,
      mappedCount: 0,
      mappingGapCount: 0,
      representativeEntrypointUnitIds: [],
      entrypointUnitIds: []
    };

    group.entrypointCount += 1;
    group.mappedCount += hasMappedHandler(flow) ? 1 : 0;
    group.mappingGapCount += hasMappingGap(flow) ? 1 : 0;
    group.entrypointUnitIds.push(flow.entrypointUnitId);
    groupsByIdentity.set(id, group);
  }

  return [...groupsByIdentity.values()]
    .map(finalizeEntrypointGroup)
    .sort(compareEntrypointGroups);
}

/** Removes mutable indexing state and retains bounded source examples. */
function finalizeEntrypointGroup(group: MutableEntrypointGroup): ProjectBriefEntrypointGroup {
  const { entrypointUnitIds, ...publicGroup } = group;

  return {
    ...publicGroup,
    representativeEntrypointUnitIds: uniqueSortedStrings(entrypointUnitIds)
      .slice(0, REPRESENTATIVE_ENTRYPOINT_LIMIT)
  };
}

/** Reads only the analyzer's documented GraphQL root qualified-name prefix. */
function getGraphQLOperationType(flow: SemanticFlow): ProjectBriefGraphQLOperationType {
  const operation = flow.steps.find((step) => step.kind === "operation");
  const prefix = operation?.qualifiedName?.split(".", 1)[0];

  return prefix === "Query" || prefix === "Mutation" || prefix === "Subscription"
    ? prefix
    : "Other";
}

/** Creates a collision-safe deterministic identity for one execution group. */
function createEntrypointGroupId(
  flow: SemanticFlow,
  operationType: ProjectBriefGraphQLOperationType | undefined
): string {
  return [flow.framework, flow.rootPath, flow.entrypointKind, operationType ?? "http"]
    .map(encodeURIComponent)
    .join(":");
}

/** Counts only a concrete source-backed handler or resolver as mapped. */
function hasMappedHandler(flow: SemanticFlow): boolean {
  return flow.steps.some((step) =>
    step.kind === "handler"
      && step.resolution === "concrete"
      && step.functionId !== undefined
  );
}

/** Keeps traversal bounds separate from entrypoint mapping coverage. */
function hasMappingGap(flow: SemanticFlow): boolean {
  return flow.coverageGaps.some((gap) =>
    gap.reason === "ambiguous" || gap.reason === "handlerNotMapped"
  );
}

/** Creates factual analysis limitation counters without a completeness score. */
function createAnalysisCoverage(
  graph: ProjectGraph,
  semanticFlows: SemanticFlowIndex
): ProjectBrief["analysisCoverage"] {
  const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
  let errorDiagnosticCount = 0;
  let warningDiagnosticCount = 0;
  let infoDiagnosticCount = 0;
  let unresolvedCallEdgeCount = 0;
  let inferredCallEdgeCount = 0;

  for (const diagnostic of graph.diagnostics) {
    if (diagnostic.severity === "error") {
      errorDiagnosticCount += 1;
    } else if (diagnostic.severity === "warning") {
      warningDiagnosticCount += 1;
    } else {
      infoDiagnosticCount += 1;
    }
  }

  for (const edge of graph.edges) {
    if (edge.kind !== "calls") {
      continue;
    }

    if (edge.confidence === "unresolved" || !graphNodeIds.has(edge.targetId)) {
      unresolvedCallEdgeCount += 1;
    }

    if (edge.confidence === "inferred") {
      inferredCallEdgeCount += 1;
    }
  }

  return {
    errorDiagnosticCount,
    warningDiagnosticCount,
    infoDiagnosticCount,
    unresolvedCallEdgeCount,
    inferredCallEdgeCount,
    ambiguousEntrypointCount: semanticFlows.summary.ambiguousEntrypointCount,
    handlerNotMappedCount: semanticFlows.summary.handlerNotMappedCount,
    traversalLimitGapCount: semanticFlows.coverageGaps.filter((gap) =>
      gap.reason === "depthLimit" || gap.reason === "stepLimit"
    ).length
  };
}

/** Narrows graph symbols to concrete callable categories. */
function isCallable(node: SymbolNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Orders language summaries by declared footprint and stable identity. */
function compareLanguageSummaries(left: LanguageSummary, right: LanguageSummary): number {
  return right.fileCount - left.fileCount || compareText(left.language, right.language);
}

/** Orders framework roots by source scope and framework identity. */
function compareFrameworkRoots(
  left: ProjectBriefFrameworkRoot,
  right: ProjectBriefFrameworkRoot
): number {
  return compareText(left.rootPath, right.rootPath)
    || compareText(left.name, right.name)
    || compareText(left.ecosystem ?? "", right.ecosystem ?? "");
}

/** Ranks larger execution surfaces first, then uses stable declared identity. */
function compareEntrypointGroups(
  left: ProjectBriefEntrypointGroup,
  right: ProjectBriefEntrypointGroup
): number {
  return right.entrypointCount - left.entrypointCount
    || compareText(left.framework, right.framework)
    || compareText(left.rootPath, right.rootPath)
    || compareText(left.entrypointKind, right.entrypointKind)
    || compareText(left.operationType ?? "", right.operationType ?? "")
    || compareText(left.id, right.id);
}

/** Creates a stable framework/root composite key. */
function createFrameworkRootKey(
  framework: string,
  rootPath: string,
  ecosystem = ""
): string {
  return `${framework}\u0000${rootPath}\u0000${ecosystem}`;
}

/** Creates a broad detector-vs-unit scope key independent from ecosystem. */
function createFrameworkScopeKey(framework: string, rootPath: string): string {
  return `${framework}\u0000${rootPath}`;
}

/** Returns a sorted distinct string array for stable public records. */
function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

/** Locale-independent comparison used for persisted ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
