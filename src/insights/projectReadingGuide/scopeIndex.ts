/**
 * Deterministic root-scope index for the Project Reading Guide.
 *
 * Framework detectors, framework units, and semantic flows contribute explicit
 * root evidence. Source files not contained by one of those roots are assigned
 * to a workspace source scope. Path ownership uses an iterative parent walk so
 * nested scopes stay non-overlapping without recursion.
 */

import type { ProjectGraph, SymbolNode } from "../../shared/types";
import type { SemanticFlow, SemanticFlowIndex } from "../semanticFlow";
import type { PortableProjectPathNormalizer } from "./portableRootPath";
import {
  PROJECT_READING_FRAMEWORK_LIMIT,
  PROJECT_READING_SCOPE_LIMIT,
  type ProjectReadingExecutionCounts,
  type ProjectReadingGuideIndex,
  type ProjectReadingScopeBasis,
  type ProjectReadingScopeSummary
} from "./types";

/** Source file identity already assigned to its nearest explicit scope. */
export type IndexedProjectReadingFile = {
  key: string;
  filePath: string;
  displayPath: string;
};

/** Callable identity retained only for exact per-scope and per-area counts. */
export type IndexedProjectReadingCallable = {
  id: string;
  pathKey: string;
  filePath: string;
};

/** Full host-side scope record; only its summary crosses the first stage. */
export type IndexedProjectReadingScope = {
  key: string;
  summary: ProjectReadingScopeSummary;
  flows: SemanticFlow[];
  files: IndexedProjectReadingFile[];
  callables: IndexedProjectReadingCallable[];
  frameworkRootKeys: Set<string>;
};

/** Full lookup plus the bounded first-stage result. */
export type ProjectReadingScopeIndex = {
  graphVersion: string;
  workspaceRootKey: string;
  normalizer: PortableProjectPathNormalizer;
  scopes: IndexedProjectReadingScope[];
  scopesById: Map<string, IndexedProjectReadingScope>;
  projectIndex: ProjectReadingGuideIndex;
};

type MutableScope = {
  key: string;
  displayPath: string;
  basis: ProjectReadingScopeBasis;
  frameworkNames: Set<string>;
  frameworkRootKeys: Set<string>;
  flows: SemanticFlow[];
  filesByKey: Map<string, IndexedProjectReadingFile>;
  callablesById: Map<string, IndexedProjectReadingCallable>;
};

/** Fixed evidence ordering; it is not a repository-importance score. */
const SCOPE_BASIS_ORDER: Record<ProjectReadingScopeBasis, number> = {
  application: 0,
  detected: 1,
  source: 2
};

/**
 * Builds all addressable scopes and a bounded three-scope first-stage index.
 * The supplied SemanticFlowIndex is reused and never rebuilt or mutated.
 */
export function createProjectReadingScopeIndex(
  graph: ProjectGraph,
  semanticFlows: SemanticFlowIndex,
  normalizer: PortableProjectPathNormalizer
): ProjectReadingScopeIndex {
  const workspace = normalizer.normalize(graph.workspaceRoot);
  const mutableScopesByKey = new Map<string, MutableScope>();

  for (const flow of semanticFlows.flows) {
    const scope = ensureMutableScope(
      mutableScopesByKey,
      normalizer,
      flow.rootPath,
      "application"
    );
    addFrameworkName(scope, flow.framework);
    scope.frameworkRootKeys.add(scope.key);
    scope.flows.push(flow);
  }

  for (const framework of graph.metadata.frameworks ?? []) {
    const scope = ensureMutableScope(
      mutableScopesByKey,
      normalizer,
      framework.rootPath ?? graph.workspaceRoot,
      "detected"
    );
    addFrameworkName(scope, framework.name);
    scope.frameworkRootKeys.add(scope.key);
  }

  for (const unit of graph.metadata.frameworkUnits ?? []) {
    const scope = ensureMutableScope(
      mutableScopesByKey,
      normalizer,
      unit.rootPath,
      "application"
    );
    addFrameworkName(scope, unit.framework);
    scope.frameworkRootKeys.add(scope.key);
  }

  const fileNodes = createDistinctFileNodes(graph.nodes, normalizer);
  const hasUnscopedFiles = fileNodes.some((file) =>
    findOwningScope(file.key, mutableScopesByKey) === undefined
  );

  if (mutableScopesByKey.size === 0 || hasUnscopedFiles) {
    ensureMutableScope(
      mutableScopesByKey,
      normalizer,
      graph.workspaceRoot,
      "source"
    );
  }

  const scopesByKey = new Map(
    [...mutableScopesByKey.values()].map((scope) => [scope.key, scope])
  );

  for (const file of fileNodes) {
    const owner = findOwningScope(file.key, scopesByKey);
    owner?.filesByKey.set(file.key, file);
  }

  for (const node of graph.nodes) {
    if (!isCallable(node)) {
      continue;
    }

    const pathKey = normalizer.normalize(node.filePath).key;
    const owner = findOwningScope(pathKey, scopesByKey);
    owner?.callablesById.set(node.id, {
      id: node.id,
      pathKey,
      filePath: node.filePath
    });
  }

  const scopes = [...mutableScopesByKey.values()].map(finalizeScope);
  const visibleScopes = selectDeterministicTopK(
    scopes,
    PROJECT_READING_SCOPE_LIMIT,
    compareIndexedScopes
  );
  const scopesById = new Map(scopes.map((scope) => [scope.summary.id, scope]));

  return {
    graphVersion: graph.version,
    workspaceRootKey: workspace.key,
    normalizer,
    scopes,
    scopesById,
    projectIndex: {
      graphVersion: graph.version,
      workspaceRoot: graph.workspaceRoot,
      scopes: visibleScopes.map((scope) => scope.summary),
      totalScopeCount: scopes.length,
      omittedScopeCount: scopes.length - visibleScopes.length
    }
  };
}

/**
 * Finds the nearest indexed ancestor with an explicit stack-safe parent walk.
 * Malformed canonical keys cannot loop forever because every key is visited at
 * most once and a non-shrinking parent terminates the walk.
 */
export function findOwningScope<T>(
  pathKey: string,
  scopesByKey: ReadonlyMap<string, T>
): T | undefined {
  const visited = new Set<string>();
  let currentKey: string | undefined = pathKey;

  while (currentKey !== undefined && !visited.has(currentKey)) {
    visited.add(currentKey);
    const scope = scopesByKey.get(currentKey);
    if (scope !== undefined) {
      return scope;
    }

    const parentKey = getPortableParentKey(currentKey);
    currentKey = parentKey !== currentKey ? parentKey : undefined;
  }

  return undefined;
}

/** Returns the lexical parent of a canonical portable path key. */
export function getPortableParentKey(key: string): string | undefined {
  const normalized = trimNonRootTrailingSeparators(key);

  if (
    normalized === "."
    || normalized === "/"
    || /^[a-z]:\/$/u.test(normalized)
    || /^\/\/[^/]+\/[^/]+$/u.test(normalized)
  ) {
    return undefined;
  }

  const separatorIndex = normalized.lastIndexOf("/");
  if (separatorIndex < 0) {
    return ".";
  }
  if (separatorIndex === 0) {
    return "/";
  }
  if (separatorIndex === 2 && /^[a-z]:\//u.test(normalized)) {
    return normalized.slice(0, 3);
  }

  return normalized.slice(0, separatorIndex);
}

/** Creates or merges one exact normalized root scope. */
function ensureMutableScope(
  scopesByKey: Map<string, MutableScope>,
  normalizer: PortableProjectPathNormalizer,
  inputPath: string,
  basis: ProjectReadingScopeBasis
): MutableScope {
  const normalized = normalizer.normalize(inputPath);
  const existing = scopesByKey.get(normalized.key);

  if (existing) {
    if (compareText(normalized.displayPath, existing.displayPath) < 0) {
      existing.displayPath = normalized.displayPath;
    }
    if (SCOPE_BASIS_ORDER[basis] < SCOPE_BASIS_ORDER[existing.basis]) {
      existing.basis = basis;
    }
    return existing;
  }

  const scope: MutableScope = {
    key: normalized.key,
    displayPath: normalized.displayPath,
    basis,
    frameworkNames: new Set<string>(),
    frameworkRootKeys: new Set<string>(),
    flows: [],
    filesByKey: new Map<string, IndexedProjectReadingFile>(),
    callablesById: new Map<string, IndexedProjectReadingCallable>()
  };
  scopesByKey.set(scope.key, scope);
  return scope;
}

/** Adds a non-empty declared framework identity without interpreting it. */
function addFrameworkName(scope: MutableScope, framework: string): void {
  const name = framework.trim();
  if (name) {
    scope.frameworkNames.add(name);
  }
}

/** Converts one mutable accumulator into an immutable-shaped indexed scope. */
function finalizeScope(
  scope: MutableScope
): IndexedProjectReadingScope {
  const visibleFrameworks = selectDeterministicTopK(
    scope.frameworkNames,
    PROJECT_READING_FRAMEWORK_LIMIT,
    compareText
  );
  const flows = [...scope.flows];
  const files = [...scope.filesByKey.values()];
  const callables = [...scope.callablesById.values()];

  return {
    key: scope.key,
    summary: {
      id: createScopeId(scope.key),
      rootPath: scope.key,
      displayPath: scope.displayPath,
      basis: scope.basis,
      frameworks: visibleFrameworks,
      frameworkCount: scope.frameworkNames.size,
      omittedFrameworkCount: scope.frameworkNames.size - visibleFrameworks.length,
      analyzedFileCount: files.length,
      callableCount: callables.length,
      execution: createExecutionCounts(flows)
    },
    flows,
    files,
    callables,
    frameworkRootKeys: new Set(scope.frameworkRootKeys)
  };
}

/**
 * Keeps only a comparator-defined prefix while scanning all candidates once.
 * Public top-K projections therefore stay bounded without allocating or sorting
 * a repository-sized candidate array.
 */
export function selectDeterministicTopK<T>(
  values: Iterable<T>,
  limit: number,
  compare: (left: T, right: T) => number
): T[] {
  if (limit <= 0) {
    return [];
  }

  const selected: T[] = [];

  for (const value of values) {
    let insertionIndex = 0;
    while (
      insertionIndex < selected.length
      && compare(selected[insertionIndex], value) <= 0
    ) {
      insertionIndex += 1;
    }

    if (insertionIndex >= limit) {
      continue;
    }

    selected.splice(insertionIndex, 0, value);
    if (selected.length > limit) {
      selected.pop();
    }
  }

  return selected;
}

/** Creates exact transport and mapping counters for one scope. */
function createExecutionCounts(flows: readonly SemanticFlow[]): ProjectReadingExecutionCounts {
  const counts: ProjectReadingExecutionCounts = {
    entrypointCount: flows.length,
    mappedCount: 0,
    mappingGapCount: 0,
    httpRouteCount: 0,
    graphqlQueryCount: 0,
    graphqlMutationCount: 0,
    graphqlSubscriptionCount: 0,
    graphqlOtherCount: 0
  };

  for (const flow of flows) {
    if (isMappedSemanticFlow(flow)) {
      counts.mappedCount += 1;
    }
    if (hasEntrypointMappingGap(flow)) {
      counts.mappingGapCount += 1;
    }

    if (flow.entrypointKind === "httpRoute") {
      counts.httpRouteCount += 1;
      continue;
    }

    switch (getGraphQLOperationType(flow)) {
      case "Query":
        counts.graphqlQueryCount += 1;
        break;
      case "Mutation":
        counts.graphqlMutationCount += 1;
        break;
      case "Subscription":
        counts.graphqlSubscriptionCount += 1;
        break;
      default:
        counts.graphqlOtherCount += 1;
        break;
    }
  }

  return counts;
}

/** Counts only a concrete source-backed handler as a mapped entrypoint. */
export function isMappedSemanticFlow(flow: SemanticFlow): boolean {
  return flow.steps.some((step) =>
    step.kind === "handler"
      && step.resolution === "concrete"
      && step.functionId !== undefined
  );
}

/** Returns the analyzer-qualified GraphQL root or the explicit Other bucket. */
export function getGraphQLOperationType(
  flow: SemanticFlow
): "Query" | "Mutation" | "Subscription" | "Other" {
  const operation = flow.steps.find((step) => step.kind === "operation");
  const prefix = operation?.qualifiedName?.split(".", 1)[0];

  return prefix === "Query" || prefix === "Mutation" || prefix === "Subscription"
    ? prefix
    : "Other";
}

/** Counts a flow once even when it carries multiple mapping diagnostics. */
function hasEntrypointMappingGap(flow: SemanticFlow): boolean {
  return flow.coverageGaps.some((gap) =>
    gap.reason === "ambiguous" || gap.reason === "handlerNotMapped"
  );
}

/** Creates stable file records and collapses duplicate file-node paths. */
function createDistinctFileNodes(
  nodes: readonly SymbolNode[],
  normalizer: PortableProjectPathNormalizer
): IndexedProjectReadingFile[] {
  const filesByKey = new Map<string, IndexedProjectReadingFile>();

  for (const node of nodes) {
    if (node.kind !== "file") {
      continue;
    }

    const normalized = normalizer.normalize(node.filePath);
    const candidate: IndexedProjectReadingFile = {
      key: normalized.key,
      filePath: node.filePath,
      displayPath: normalized.displayPath
    };
    const current = filesByKey.get(normalized.key);
    if (!current || compareText(candidate.filePath, current.filePath) < 0) {
      filesByKey.set(normalized.key, candidate);
    }
  }

  return [...filesByKey.values()];
}

/** Narrows graph symbols to concrete callable categories. */
function isCallable(node: SymbolNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Fixed scope order uses evidence class, measured exposure, then canonical path. */
function compareIndexedScopes(
  left: IndexedProjectReadingScope,
  right: IndexedProjectReadingScope
): number {
  return SCOPE_BASIS_ORDER[left.summary.basis] - SCOPE_BASIS_ORDER[right.summary.basis]
    || right.summary.execution.entrypointCount - left.summary.execution.entrypointCount
    || right.summary.analyzedFileCount - left.summary.analyzedFileCount
    || compareText(left.key, right.key)
    || compareText(left.summary.id, right.summary.id);
}

/** Orders flows by declared transport and stable source identity, never by score. */
export function compareSemanticFlows(left: SemanticFlow, right: SemanticFlow): number {
  return getFlowTransportOrder(left) - getFlowTransportOrder(right)
    || compareText(left.framework, right.framework)
    || compareText(left.name, right.name)
    || compareText(left.entrypointUnitId, right.entrypointUnitId)
    || compareText(left.id, right.id);
}

/** Returns one fixed presentation bucket for deterministic flow ordering. */
function getFlowTransportOrder(flow: SemanticFlow): number {
  if (flow.entrypointKind === "httpRoute") {
    return 0;
  }

  switch (getGraphQLOperationType(flow)) {
    case "Query":
      return 1;
    case "Mutation":
      return 2;
    case "Subscription":
      return 3;
    default:
      return 4;
  }
}

/** Stable scope identity contains the complete collision-safe canonical key. */
function createScopeId(scopeKey: string): string {
  return `project-reading:scope:${encodeURIComponent(scopeKey)}`;
}

/** Removes trailing separators without changing canonical volume roots. */
function trimNonRootTrailingSeparators(key: string): string {
  if (key === "/" || /^[a-z]:\/$/u.test(key)) {
    return key;
  }
  return key.replace(/\/+$/u, "");
}

/** Locale-independent comparison for reproducible persisted projections. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
