/**
 * Pure selection, aggregation, presentation, and ordering helpers for Module
 * Flow projection. This internal module has no snapshot lifecycle or token
 * authority; the service owns those stateful boundaries and consumes these
 * deterministic helpers.
 */

import type {
  ProjectModule,
  ProjectModuleRelation
} from "../../insights/projectModules";
import type {
  ModuleFlowBoundaryEvidencePayload,
  ModuleFlowConfidenceCounts,
  ModuleFlowEdgeId,
  ModuleFlowEdgePayload,
  ModuleFlowModuleId,
  ModuleFlowRelationCountPayload,
  ModuleFlowRelationKind,
  ModuleFlowViewMode
} from "../../protocol/moduleFlow";
import type { EdgeConfidence, GraphEdge, SymbolNode } from "../../shared/types";
import { createModuleFlowEdgeId } from "./moduleFlowIdentity";

/** One pair-aggregated Host relation retained for detail projection. */
export type RelationAggregate = {
  key: string;
  sourceModuleId: string;
  targetModuleId: string;
  relations: ProjectModuleRelation[];
};

/** One callable and its cross-module call evidence. */
export type BoundaryFunction = {
  node: SymbolNode;
  incoming: GraphEdge[];
  outgoing: GraphEdge[];
};

const EXECUTION_RELATIONS = new Set<ModuleFlowRelationKind>([
  "calls", "routesTo", "usesModel", "renders", "injects", "configures"
]);
const DEPENDENCY_RELATIONS = new Set<ModuleFlowRelationKind>([
  "imports", "exports", "extends"
]);

/** Groups relation-specific domain rows into one visual route per module pair. */
export function createRelationAggregates(
  relations: readonly ProjectModuleRelation[],
  mode: ModuleFlowViewMode,
  includeInferred: boolean
): RelationAggregate[] {
  const byPair = new Map<string, RelationAggregate>();
  for (const relation of relations) {
    if (!relationMatchesMode(relation.kind, mode)) {
      continue;
    }
    if (!includeInferred
      && relation.confidenceCounts.exact + relation.confidenceCounts.resolved === 0) {
      continue;
    }
    const key = `${relation.sourceModuleId}\0${relation.targetModuleId}`;
    const aggregate = byPair.get(key) ?? {
      key,
      sourceModuleId: relation.sourceModuleId,
      targetModuleId: relation.targetModuleId,
      relations: []
    };
    aggregate.relations.push(relation);
    byPair.set(key, aggregate);
  }
  return [...byPair.values()]
    .map((aggregate) => ({
      ...aggregate,
      relations: aggregate.relations.sort((left, right) => compareText(left.kind, right.kind))
    }))
    .sort((left, right) => compareText(left.key, right.key));
}

/** Selects important modules while including an ancestor chain when budget permits. */
export function selectModules(
  modules: readonly ProjectModule[],
  limit: number,
  modulesById: ReadonlyMap<string, ProjectModule>
): ProjectModule[] {
  const selectedIds = new Set<string>();
  const ranked = [...modules].sort((left, right) =>
    moduleScore(right) - moduleScore(left) || compareModules(left, right)
  );
  const availableIds = new Set(modules.map((module) => module.id));
  for (const module of ranked) {
    if (selectedIds.has(module.id)) {
      continue;
    }
    const chain: string[] = [];
    const visited = new Set<string>();
    let current: ProjectModule | undefined = module;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (availableIds.has(current.id) && !selectedIds.has(current.id)) {
        chain.push(current.id);
      }
      current = current.parentModuleId
        ? modulesById.get(current.parentModuleId)
        : undefined;
    }
    if (selectedIds.size + chain.length > limit) {
      continue;
    }
    for (const id of chain.reverse()) {
      selectedIds.add(id);
    }
    if (selectedIds.size >= limit) {
      break;
    }
  }
  return modules
    .filter((module) => selectedIds.has(module.id))
    .sort((left, right) => moduleDepth(left, modulesById) - moduleDepth(right, modulesById)
      || compareModules(left, right));
}

/** Builds every parent-child edge before the independent edge budget is applied. */
export function createContainmentEdges(
  modules: readonly ProjectModule[],
  graphVersion: string,
  moduleTokens: ReadonlyMap<string, ModuleFlowModuleId>
): ModuleFlowEdgePayload[] {
  const moduleIds = new Set(modules.map((module) => module.id));
  const edges: ModuleFlowEdgePayload[] = [];
  for (const module of modules) {
    if (!module.parentModuleId || !moduleIds.has(module.parentModuleId)) {
      continue;
    }
    const sourceId = moduleTokens.get(module.parentModuleId);
    const targetId = moduleTokens.get(module.id);
    if (!sourceId || !targetId) {
      continue;
    }
    edges.push(createContainmentEdgePayload(
      createModuleFlowEdgeId(graphVersion, `contains\0${module.parentModuleId}\0${module.id}`),
      sourceId,
      targetId
    ));
  }
  return edges;
}

/** Creates the neutral route used for hierarchy and module ownership. */
export function createContainmentEdgePayload(
  id: ModuleFlowEdgeId,
  sourceId: ModuleFlowEdgePayload["sourceId"],
  targetId: ModuleFlowEdgePayload["targetId"]
): ModuleFlowEdgePayload {
  return {
    id,
    sourceId,
    targetId,
    presentationKind: "contains",
    relations: [],
    confidenceCounts: createConfidenceCounts(),
    evidenceCount: 0,
    omittedEvidenceCount: 0,
    hasDetails: false
  };
}

/**
 * Applies an expansion edge budget without orphaning visible function cards.
 * Ownership routes are deterministic and always consume budget before calls.
 */
export function selectBoundaryExpansionEdges(
  containmentEdges: readonly ModuleFlowEdgePayload[],
  concreteEdges: readonly ModuleFlowEdgePayload[],
  limit: number
): ModuleFlowEdgePayload[] {
  return [
    ...[...containmentEdges].sort(compareProjectedEdges),
    ...[...concreteEdges].sort(compareProjectedEdges)
  ].slice(0, limit);
}

/** Converts one module's retained boundary signal into non-sensitive prose. */
export function projectBoundaryEvidence(
  kind: ProjectModule["evidence"][number]["kind"],
  module: ProjectModule
): ModuleFlowBoundaryEvidencePayload {
  const frameworkLabels = createBoundedDisplayLabels(module.frameworks, "frameworks");
  const frameworkSuffix = frameworkLabels.length > 0
    ? `: ${frameworkLabels.join(", ")}`
    : "";
  const labels: Record<typeof kind, string> = {
    manifest: "Manifest-backed workspace package",
    explicitRoot: "Adapter-provided project boundary",
    framework: `Detected framework boundary${frameworkSuffix}`,
    frameworkUnit: `Framework semantic-unit boundary${frameworkSuffix}`,
    sourceArea: "Conservative source-area boundary",
    workspace: "Analyzed workspace boundary",
    external: "External or statically unresolved boundary"
  };
  return { kind, label: labels[kind] };
}

/** Returns a concise but complete module classification line. */
export function describeModule(module: ProjectModule): string {
  const basisLabels: Record<ProjectModule["basis"], string> = {
    workspacePackage: "Workspace package",
    frameworkRoot: "Framework responsibility boundary",
    sourceArea: "Inferred source area",
    workspaceRoot: "Workspace root",
    externalBoundary: "External or unresolved boundary"
  };
  return `${basisLabels[module.basis]} · ${module.confidence} confidence`;
}

/** Module ordering is deterministic across analyzer array order. */
export function compareModules(left: ProjectModule, right: ProjectModule): number {
  return compareText(left.displayPath, right.displayPath) || compareText(left.id, right.id);
}

/** Stable callable order falls back to source location and opaque Host ID. */
export function compareNodes(left: SymbolNode, right: SymbolNode): number {
  return compareText(left.qualifiedName || left.name, right.qualifiedName || right.name)
    || compareText(left.filePath, right.filePath)
    || compareNumbers(left.selectionRange.startLine, right.selectionRange.startLine)
    || compareText(left.id, right.id);
}

/** Creates exact empty confidence buckets for synthetic and aggregate edges. */
export function createConfidenceCounts(): ModuleFlowConfidenceCounts {
  return { exact: 0, resolved: 0, inferred: 0, unresolved: 0 };
}

/** Adds one exact confidence distribution into another. */
export function addConfidenceCounts(
  target: ModuleFlowConfidenceCounts,
  source: ModuleFlowConfidenceCounts
): void {
  target.exact += source.exact;
  target.resolved += source.resolved;
  target.inferred += source.inferred;
  target.unresolved += source.unresolved;
}

/** Converts relation-count maps to sorted JSON rows. */
export function toRelationCounts(
  counts: ReadonlyMap<ModuleFlowRelationKind, number>
): ModuleFlowRelationCountPayload[] {
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort(compareRelationCounts);
}

/** Relation labels stay stable regardless of input edge order. */
export function compareRelationCounts(
  left: ModuleFlowRelationCountPayload,
  right: ModuleFlowRelationCountPayload
): number {
  return compareText(left.kind, right.kind);
}

/** Important execution edges are rendered before structural containment. */
export function compareProjectedEdges(
  left: ModuleFlowEdgePayload,
  right: ModuleFlowEdgePayload
): number {
  const presentationRank = (edge: ModuleFlowEdgePayload): number =>
    edge.presentationKind === "concreteCall" ? 0 : edge.presentationKind === "aggregate" ? 1 : 2;
  return presentationRank(left) - presentationRank(right)
    || right.evidenceCount - left.evidenceCount
    || compareText(left.id, right.id);
}

/** Uses the strongest confidence represented by concrete call evidence. */
export function strongestConfidence(edges: readonly GraphEdge[]): EdgeConfidence | undefined {
  const rank: Record<EdgeConfidence, number> = {
    exact: 0,
    resolved: 1,
    inferred: 2,
    unresolved: 3
  };
  return [...edges].sort((left, right) =>
    rank[left.confidence] - rank[right.confidence]
  )[0]?.confidence;
}

/** Allows only callable definitions whose Function Visualizer can open. */
export function isCallable(node: SymbolNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Keeps external boundaries out of source and function expansion. */
export function isExternalModule(module: ProjectModule): boolean {
  return module.basis === "externalBoundary";
}

/** Full strings are retained; control characters alone are normalized. */
export function safeLabel(value: string, fallback: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
  return normalized || fallback;
}

/**
 * Bounds metadata labels without truncating strings or hiding omission. The
 * final row states the exact additional count and therefore remains readable.
 */
export function createBoundedDisplayLabels(
  values: readonly string[],
  noun: string,
  limit = 8
): string[] {
  const unique = [...new Set(values.map((value) => safeLabel(value, "")).filter(Boolean))]
    .sort(compareText);
  if (unique.length <= limit) {
    return unique;
  }
  const retainedCount = Math.max(0, limit - 1);
  return [
    ...unique.slice(0, retainedCount),
    `${unique.length - retainedCount} additional ${noun}`
  ];
}

/** Domain display paths are workspace-relative; absolute-looking values are hidden. */
export function safeLocationLabel(value: string): string | undefined {
  const normalized = safeLabel(value, "");
  return normalized
    && !normalized.startsWith("/")
    && !/^[A-Za-z]:[\\/]/u.test(normalized)
    ? normalized
    : undefined;
}

/** Describes boundary direction without truncating the function name. */
export function formatBoundaryFunctionDetail(incoming: number, outgoing: number): string {
  if (incoming === 0 && outgoing === 0) {
    return "Representative module function";
  }
  return `${incoming} incoming boundary call${incoming === 1 ? "" : "s"} · `
    + `${outgoing} outgoing boundary call${outgoing === 1 ? "" : "s"}`;
}

/** Clamps untrusted request budgets to protocol hard limits. */
export function clampLimit(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

/** Locale-independent identity comparison for reproducible payloads. */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Numeric comparison used by source coordinates. */
export function compareNumbers(left: number, right: number): number {
  return left - right;
}

/** Higher activity and concrete package evidence keep useful modules in view. */
function moduleScore(module: ProjectModule): number {
  const basisScore = module.basis === "workspacePackage"
    ? 10_000
    : module.basis === "frameworkRoot"
      ? 8_000
      : module.basis === "sourceArea"
        ? 6_000
        : module.basis === "workspaceRoot"
          ? 4_000
          : 0;
  return basisScore
    + module.entrypointCount * 100
    + module.incomingEvidenceCount
    + module.outgoingEvidenceCount
    + module.descendantCallableCount;
}

/** Iteratively counts parent levels with cycle protection. */
function moduleDepth(
  module: ProjectModule,
  modulesById: ReadonlyMap<string, ProjectModule>
): number {
  let depth = 0;
  let parentId = module.parentModuleId;
  const visited = new Set<string>([module.id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    depth += 1;
    parentId = modulesById.get(parentId)?.parentModuleId;
  }
  return depth;
}

/** Maps a relation kind into one of the three UI lenses. */
function relationMatchesMode(kind: ModuleFlowRelationKind, mode: ModuleFlowViewMode): boolean {
  return mode === "boundary"
    || (mode === "execution" && EXECUTION_RELATIONS.has(kind))
    || (mode === "dependency" && DEPENDENCY_RELATIONS.has(kind));
}
