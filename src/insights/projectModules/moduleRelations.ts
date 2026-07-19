/**
 * Cross-module relation aggregation over source and framework graph evidence.
 *
 * Internal evidence becomes a module metric rather than a confusing self-loop.
 * External targets are handled before path ownership because analyzer external
 * nodes intentionally carry the observing source file as their `filePath`.
 */

import type {
  EdgeConfidence,
  FrameworkUnitEdge,
  GraphEdge,
  ProjectGraph,
  SourceRange,
  SymbolNode
} from "../../shared/types";
import {
  PROJECT_MODULE_RELATION_EVIDENCE_LIMIT,
  type ProjectModuleConfidenceCounts,
  type ProjectModuleRelation,
  type ProjectModuleRelationCounts,
  type ProjectModuleRelationEvidence,
  type ProjectModuleRelationKind
} from "./types";

/** Ownership adapter keeps relation aggregation independent from boundary inference. */
export type ProjectModuleRelationOwnership = {
  moduleIdByNodeId: ReadonlyMap<string, string>;
  findModuleIdByFilePath(filePath?: string): string | undefined;
  externalModuleId: string;
};

/** Exact relation coverage returned to the module index summary. */
export type ProjectModuleRelationCoverage = {
  crossModuleEvidenceCount: number;
  internalRelationEvidenceCount: number;
  externalRelationEvidenceCount: number;
  unownedRelationEvidenceCount: number;
};

/** Aggregate relations, internal counters, and external-boundary usage. */
export type ProjectModuleRelationAggregation = {
  relations: ProjectModuleRelation[];
  internalCountsByModuleId: ReadonlyMap<string, ProjectModuleRelationCounts>;
  coverage: ProjectModuleRelationCoverage;
  usesExternalBoundary: boolean;
};

type RelationInput = {
  source: "graphEdge" | "frameworkUnitEdge";
  edgeId: string;
  kind: ProjectModuleRelationKind;
  sourceModuleId?: string;
  targetModuleId?: string;
  targetIsExternal: boolean;
  filePath?: string;
  range?: SourceRange;
  confidence: EdgeConfidence;
};

type MutableRelation = {
  id: string;
  sourceModuleId: string;
  targetModuleId: string;
  kind: ProjectModuleRelationKind;
  evidenceCount: number;
  confidenceCounts: ProjectModuleConfidenceCounts;
  evidence: ProjectModuleRelationEvidence[];
};

/**
 * Aggregates relation-specific edges while retaining confidence buckets and a
 * bounded deterministic source sample. Duplicate stable evidence IDs count once.
 */
export function createProjectModuleRelations(
  graph: ProjectGraph,
  ownership: ProjectModuleRelationOwnership
): ProjectModuleRelationAggregation {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const unitsById = new Map(
    (graph.metadata.frameworkUnits ?? []).map((unit) => [unit.id, unit])
  );
  const inputsByEvidenceKey = new Map<string, RelationInput>();

  for (const edge of graph.edges) {
    const kind = getGraphRelationKind(edge);
    if (!kind) {
      continue;
    }

    const input = createGraphRelationInput(edge, kind, nodesById, ownership);
    retainDeterministicInput(inputsByEvidenceKey, input);
  }

  for (const edge of graph.metadata.frameworkUnitEdges ?? []) {
    const kind = getFrameworkRelationKind(edge);
    if (!kind) {
      continue;
    }

    const input = createFrameworkRelationInput(edge, kind, unitsById, ownership);
    retainDeterministicInput(inputsByEvidenceKey, input);
  }

  const relationsByKey = new Map<string, MutableRelation>();
  const internalCountsByModuleId = new Map<string, ProjectModuleRelationCounts>();
  const coverage: ProjectModuleRelationCoverage = {
    crossModuleEvidenceCount: 0,
    internalRelationEvidenceCount: 0,
    externalRelationEvidenceCount: 0,
    unownedRelationEvidenceCount: 0
  };
  let usesExternalBoundary = false;

  for (const evidenceKey of [...inputsByEvidenceKey.keys()].sort(compareText)) {
    const input = inputsByEvidenceKey.get(evidenceKey);
    if (!input?.sourceModuleId || !input.targetModuleId) {
      coverage.unownedRelationEvidenceCount += 1;
      continue;
    }

    if (input.sourceModuleId === input.targetModuleId) {
      const counts = ensureRelationCounts(internalCountsByModuleId, input.sourceModuleId);
      counts[input.kind] += 1;
      coverage.internalRelationEvidenceCount += 1;
      continue;
    }

    const relationKey = createRelationKey(
      input.sourceModuleId,
      input.targetModuleId,
      input.kind
    );
    const relation = relationsByKey.get(relationKey) ?? createMutableRelation(
      input.sourceModuleId,
      input.targetModuleId,
      input.kind
    );
    relationsByKey.set(relationKey, relation);
    relation.evidenceCount += 1;
    relation.confidenceCounts[input.confidence] += 1;
    insertBoundedEvidence(relation.evidence, {
      source: input.source,
      edgeId: input.edgeId,
      filePath: input.filePath,
      range: input.range ? { ...input.range } : undefined,
      confidence: input.confidence
    });

    coverage.crossModuleEvidenceCount += 1;
    if (input.targetIsExternal) {
      usesExternalBoundary = true;
      coverage.externalRelationEvidenceCount += 1;
    }
  }

  const relations = [...relationsByKey.values()]
    .map(finalizeRelation)
    .sort(compareRelations);

  return {
    relations,
    internalCountsByModuleId,
    coverage,
    usesExternalBoundary
  };
}

/** Converts supported graph edge kinds into the module relation vocabulary. */
function getGraphRelationKind(edge: GraphEdge): ProjectModuleRelationKind | undefined {
  switch (edge.kind) {
    case "calls":
    case "imports":
    case "exports":
    case "extends":
      return edge.kind;
    default:
      return undefined;
  }
}

/** Converts framework semantics while excluding structural contains edges. */
function getFrameworkRelationKind(
  edge: FrameworkUnitEdge
): ProjectModuleRelationKind | undefined {
  switch (edge.kind) {
    case "calls":
    case "routesTo":
    case "usesModel":
    case "renders":
    case "injects":
    case "configures":
    case "extends":
      return edge.kind;
    case "contains":
      return undefined;
  }
}

/** Resolves graph endpoints without assigning external targets by their filePath. */
function createGraphRelationInput(
  edge: GraphEdge,
  kind: ProjectModuleRelationKind,
  nodesById: ReadonlyMap<string, SymbolNode>,
  ownership: ProjectModuleRelationOwnership
): RelationInput {
  const sourceNode = nodesById.get(edge.sourceId);
  const targetNode = nodesById.get(edge.targetId);
  const targetIsExternal = targetNode?.kind === "external"
    || (targetNode === undefined && edge.confidence === "unresolved");
  const sourceModuleId = sourceNode?.kind === "external"
    ? undefined
    : ownership.moduleIdByNodeId.get(edge.sourceId)
      ?? ownership.findModuleIdByFilePath(edge.filePath);
  const targetModuleId = targetIsExternal
    ? ownership.externalModuleId
    : ownership.moduleIdByNodeId.get(edge.targetId);

  return {
    source: "graphEdge",
    edgeId: edge.id,
    kind,
    sourceModuleId,
    targetModuleId,
    targetIsExternal,
    // Source locations stay host-only at this layer. Webview projections must
    // replace them with a safe display string plus an opaque evidence token.
    filePath: edge.filePath,
    range: edge.range,
    confidence: edge.confidence
  };
}

/** Resolves semantic unit endpoints by their concrete source file locations. */
function createFrameworkRelationInput(
  edge: FrameworkUnitEdge,
  kind: ProjectModuleRelationKind,
  unitsById: ReadonlyMap<string, { filePath: string }>,
  ownership: ProjectModuleRelationOwnership
): RelationInput {
  const sourceUnit = unitsById.get(edge.sourceId);
  const targetUnit = unitsById.get(edge.targetId);
  const confidence = edge.confidence ?? "inferred";
  const targetIsExternal = targetUnit === undefined && confidence === "unresolved";
  const edgeId = edge.id?.trim() || createFrameworkEvidenceId(edge, confidence);

  return {
    source: "frameworkUnitEdge",
    edgeId,
    kind,
    sourceModuleId: ownership.findModuleIdByFilePath(sourceUnit?.filePath ?? edge.filePath),
    targetModuleId: targetIsExternal
      ? ownership.externalModuleId
      : ownership.findModuleIdByFilePath(targetUnit?.filePath),
    targetIsExternal,
    // Preserve the concrete Host path so an approved evidence token can reveal
    // the exact location later without reconstructing a platform-specific path.
    filePath: edge.filePath ?? sourceUnit?.filePath,
    range: edge.range,
    confidence
  };
}

/** Synthesizes stable identity only for framework edges whose adapter omitted one. */
function createFrameworkEvidenceId(
  edge: FrameworkUnitEdge,
  confidence: EdgeConfidence
): string {
  const range = edge.range;
  return [
    "framework-edge",
    edge.kind,
    edge.sourceId,
    edge.targetId,
    edge.filePath ?? "",
    range?.startLine ?? "",
    range?.startCharacter ?? "",
    confidence
  ].join("::");
}

/** Keeps one deterministic record when malformed input repeats an evidence ID. */
function retainDeterministicInput(
  inputsByEvidenceKey: Map<string, RelationInput>,
  input: RelationInput
): void {
  const key = `${input.source}\u001f${input.edgeId}`;
  const existing = inputsByEvidenceKey.get(key);
  if (!existing || compareText(inputSignature(input), inputSignature(existing)) < 0) {
    inputsByEvidenceKey.set(key, input);
  }
}

/** Complete comparison signature makes duplicate resolution input-order neutral. */
function inputSignature(input: RelationInput): string {
  return [
    input.kind,
    input.sourceModuleId ?? "",
    input.targetModuleId ?? "",
    input.targetIsExternal ? "1" : "0",
    input.filePath ?? "",
    input.range?.startLine ?? "",
    input.range?.startCharacter ?? "",
    input.confidence
  ].join("\u001f");
}

/** Creates a zero-filled internal relation counter for one module. */
function ensureRelationCounts(
  countsByModuleId: Map<string, ProjectModuleRelationCounts>,
  moduleId: string
): ProjectModuleRelationCounts {
  const existing = countsByModuleId.get(moduleId);
  if (existing) {
    return existing;
  }

  const counts = createEmptyRelationCounts();
  countsByModuleId.set(moduleId, counts);
  return counts;
}

/** Publicly shaped zero counter shared by module initialization and self-loops. */
export function createEmptyRelationCounts(): ProjectModuleRelationCounts {
  return {
    calls: 0,
    imports: 0,
    exports: 0,
    routesTo: 0,
    usesModel: 0,
    renders: 0,
    injects: 0,
    configures: 0,
    extends: 0
  };
}

/** Creates a zero-filled confidence counter without collapsing uncertainty. */
function createEmptyConfidenceCounts(): ProjectModuleConfidenceCounts {
  return { exact: 0, resolved: 0, inferred: 0, unresolved: 0 };
}

/** Creates one relation aggregate on first observed evidence. */
function createMutableRelation(
  sourceModuleId: string,
  targetModuleId: string,
  kind: ProjectModuleRelationKind
): MutableRelation {
  return {
    id: `project-module-relation:${encodeURIComponent(createRelationKey(sourceModuleId, targetModuleId, kind))}`,
    sourceModuleId,
    targetModuleId,
    kind,
    evidenceCount: 0,
    confidenceCounts: createEmptyConfidenceCounts(),
    evidence: []
  };
}

/** Complete aggregate identity keeps relation kinds independently toggleable. */
function createRelationKey(
  sourceModuleId: string,
  targetModuleId: string,
  kind: ProjectModuleRelationKind
): string {
  return `${sourceModuleId}\u001f${targetModuleId}\u001f${kind}`;
}

/** Maintains a sorted top-K source sample without retaining every callsite. */
function insertBoundedEvidence(
  evidence: ProjectModuleRelationEvidence[],
  candidate: ProjectModuleRelationEvidence
): void {
  let insertionIndex = 0;
  while (
    insertionIndex < evidence.length
    && compareRelationEvidence(evidence[insertionIndex], candidate) <= 0
  ) {
    insertionIndex += 1;
  }

  if (insertionIndex >= PROJECT_MODULE_RELATION_EVIDENCE_LIMIT) {
    return;
  }
  evidence.splice(insertionIndex, 0, candidate);
  if (evidence.length > PROJECT_MODULE_RELATION_EVIDENCE_LIMIT) {
    evidence.pop();
  }
}

/** Adds the exact omitted count after bounded evidence selection. */
function finalizeRelation(relation: MutableRelation): ProjectModuleRelation {
  return {
    ...relation,
    confidenceCounts: { ...relation.confidenceCounts },
    evidence: [...relation.evidence],
    omittedEvidenceCount: relation.evidenceCount - relation.evidence.length
  };
}

/** Stable ordering for bounded anchors. */
function compareRelationEvidence(
  left: ProjectModuleRelationEvidence,
  right: ProjectModuleRelationEvidence
): number {
  return compareText(left.edgeId, right.edgeId)
    || compareText(left.source, right.source)
    || compareText(left.filePath ?? "", right.filePath ?? "")
    || (left.range?.startLine ?? -1) - (right.range?.startLine ?? -1)
    || (left.range?.startCharacter ?? -1) - (right.range?.startCharacter ?? -1);
}

/** Stable relation ordering is independent of analyzer array order. */
function compareRelations(left: ProjectModuleRelation, right: ProjectModuleRelation): number {
  return compareText(left.sourceModuleId, right.sourceModuleId)
    || compareText(left.targetModuleId, right.targetModuleId)
    || compareText(left.kind, right.kind)
    || compareText(left.id, right.id);
}

/** Locale-independent comparison for reproducible projections. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
