/**
 * Bounded, evidence-backed P0 Risk Radar construction.
 *
 * Scalar counts remain exact, while candidate ranking and published evidence
 * use fixed-size buffers. Large repositories therefore do not materialize or
 * sort every diagnostic, source location, or public candidate record.
 */

import type {
  EdgeConfidence,
  ProjectGraph
} from "../../shared/types";
import type {
  SemanticFlow,
  SemanticFlowCoverageGap,
  SemanticFlowIndex,
  SemanticFlowStep
} from "../semanticFlow";
import {
  PROJECT_RISK_RADAR_ITEM_LIMIT,
  type ProjectAnalysisCoverageRisk,
  type ProjectRiskEvidence,
  type ProjectRiskItem,
  type ProjectRiskLocation,
  type ProjectRiskRadar
} from "./types";
import {
  getBestValue,
  retainFirstLocation,
  retainSmallestNumber,
  retainSmallestString,
  retainTopValue
} from "./boundedRadarBuffer";

type EntrypointRiskSummary = {
  kind: "entrypointCoverage";
  key: string;
  id: string;
  framework: string;
  rootPath: string;
  ambiguousCount: number;
  handlerNotMappedCount: number;
  evidenceCount: number;
  affectedEntrypointCount: number;
  lastAffectedGroupOrdinal: number;
  confidence?: EdgeConfidence;
  location?: ProjectRiskLocation;
};

type UnresolvedRiskSummary = {
  kind: "unresolvedExecution";
  key: string;
  id: string;
  sourceFunctionId?: string;
  sourceFunctionName?: string;
  firstEvidenceKey?: string;
  evidenceCount: number;
  affectedEntrypointCount: number;
  lastAffectedGroupOrdinal: number;
  confidence?: EdgeConfidence;
  location?: ProjectRiskLocation;
};

type RiskCandidate =
  | ProjectAnalysisCoverageRisk
  | EntrypointRiskSummary
  | UnresolvedRiskSummary;

type SelectedRiskEvidence = {
  evidence: ProjectRiskEvidence;
};

type RiskScan = {
  analysis?: ProjectAnalysisCoverageRisk;
  entrypointsByKey: Map<string, EntrypointRiskSummary>;
  unresolvedByKey: Map<string, UnresolvedRiskSummary>;
};

const CONFIDENCE_RANK: Record<EdgeConfidence, number> = {
  exact: 0,
  resolved: 1,
  inferred: 2,
  unresolved: 3
};

/**
 * Creates at most five signals while keeping one winner from every non-empty
 * category and reporting the exact number of candidates considered.
 */
export function createProjectRiskRadar(
  graph: ProjectGraph,
  semanticFlows: SemanticFlowIndex
): ProjectRiskRadar {
  const scan = scanRiskCounts(graph, semanticFlows);
  const selected = selectRiskCandidates(scan, PROJECT_RISK_RADAR_ITEM_LIMIT);
  attachSelectedSourceNames(graph, selected);
  const evidenceByCandidate = collectSelectedEvidence(semanticFlows, selected);
  const items = selected.map((candidate) => finalizeSelectedRisk(candidate, evidenceByCandidate));
  const candidateItemCount = (scan.analysis ? 1 : 0)
    + scan.entrypointsByKey.size
    + scan.unresolvedByKey.size;

  return {
    graphVersion: graph.version,
    items,
    candidateItemCount,
    omittedItemCount: Math.max(0, candidateItemCount - items.length)
  };
}

/** Runs scalar aggregation without retaining unbounded public evidence arrays. */
function scanRiskCounts(graph: ProjectGraph, semanticFlows: SemanticFlowIndex): RiskScan {
  const entrypointsByKey = new Map<string, EntrypointRiskSummary>();
  const unresolvedByKey = new Map<string, UnresolvedRiskSummary>();
  // Edge ids are graph identities; fallback keys include their source and site.
  // This exact counting set replaces multiple per-source evidence/edge Sets.
  const exactUnresolvedEvidenceKeys = new Set<string>();

  scanEntrypointGroups(
    semanticFlows,
    (entrypointUnitId, flows, groupOrdinal) => {
      scanEntrypointCoverageGroup(
        entrypointUnitId,
        flows,
        groupOrdinal,
        entrypointsByKey
      );
      scanUnresolvedExecutionGroup(
        entrypointUnitId,
        flows,
        groupOrdinal,
        unresolvedByKey,
        exactUnresolvedEvidenceKeys
      );
    }
  );

  return {
    analysis: createAnalysisCoverageRisk(graph, semanticFlows),
    entrypointsByKey,
    unresolvedByKey
  };
}

/** Aggregates diagnostics and bounded traversal gaps with fixed evidence buffers. */
function createAnalysisCoverageRisk(
  graph: ProjectGraph,
  semanticFlows: SemanticFlowIndex
): ProjectAnalysisCoverageRisk | undefined {
  const evidence = createEmptyEvidence();
  let errorDiagnosticCount = 0;
  let warningDiagnosticCount = 0;
  let traversalLimitGapCount = 0;
  let location: ProjectRiskLocation | undefined;

  for (let index = 0; index < graph.diagnostics.length; index += 1) {
    const diagnostic = graph.diagnostics[index];

    if (diagnostic.severity !== "error" && diagnostic.severity !== "warning") {
      continue;
    }

    if (diagnostic.severity === "error") {
      errorDiagnosticCount += 1;
    } else {
      warningDiagnosticCount += 1;
    }

    retainSmallestNumber(evidence.diagnosticIndexes, index);

    if (diagnostic.filePath) {
      location = retainFirstLocation(location, {
        filePath: diagnostic.filePath,
        range: diagnostic.range
      });
    }
  }

  for (const gap of semanticFlows.coverageGaps) {
    if (!isTraversalLimitGap(gap)) {
      continue;
    }

    traversalLimitGapCount += 1;
    retainSmallestString(evidence.entrypointUnitIds, gap.entrypointUnitId);
    retainOptionalString(evidence.sourceFunctionIds, gap.sourceFunctionId);

    for (const functionId of gap.omittedFunctionIds) {
      retainSmallestString(evidence.omittedFunctionIds, functionId);
    }
  }

  const evidenceCount = errorDiagnosticCount
    + warningDiagnosticCount
    + traversalLimitGapCount;

  if (evidenceCount === 0) {
    return undefined;
  }

  return {
    id: "risk:analysis-coverage",
    kind: "analysisCoverage",
    evidenceCount,
    affectedEntrypointCount: countAffectedTraversalEntrypoints(semanticFlows),
    location,
    evidence,
    errorDiagnosticCount,
    warningDiagnosticCount,
    traversalLimitGapCount
  };
}

/** Counts distinct traversal-affected entrypoints from the canonical index. */
function countAffectedTraversalEntrypoints(semanticFlows: SemanticFlowIndex): number {
  let count = 0;

  for (const gaps of semanticFlows.coverageGapsByEntrypointUnitId.values()) {
    if (gaps.some(isTraversalLimitGap)) {
      count += 1;
    }
  }

  return count;
}

/** Updates scalar mapping coverage for one already-grouped entrypoint identity. */
function scanEntrypointCoverageGroup(
  _entrypointUnitId: string,
  flows: SemanticFlow[],
  groupOrdinal: number,
  summaries: Map<string, EntrypointRiskSummary>
): void {
  for (const flow of flows) {
    let summary: EntrypointRiskSummary | undefined;

    for (const gap of flow.coverageGaps) {
      if (!isEntrypointMappingGap(gap)) {
        continue;
      }

      const key = createEntrypointRiskKey(flow);
      summary ??= summaries.get(key) ?? createEntrypointRiskSummary(flow, key);

      if (gap.reason === "ambiguous") {
        summary.ambiguousCount += 1;
      } else {
        summary.handlerNotMappedCount += 1;
      }

      summary.evidenceCount += 1;
      summary.confidence = getWeakestOptionalConfidence(summary.confidence, flow.confidence);
    }

    if (!summary) {
      continue;
    }

    if (summary.lastAffectedGroupOrdinal !== groupOrdinal) {
      summary.affectedEntrypointCount += 1;
      summary.lastAffectedGroupOrdinal = groupOrdinal;
    }

    const entrypointStep = getEntrypointStep(flow);
    if (entrypointStep?.filePath) {
      summary.location = retainFirstLocation(summary.location, {
        filePath: entrypointStep.filePath,
        range: entrypointStep.range
      });
    }

    summaries.set(summary.key, summary);
  }
}

/** Creates constant-size scalar state for one framework/root mapping signal. */
function createEntrypointRiskSummary(
  flow: SemanticFlow,
  key: string
): EntrypointRiskSummary {
  return {
    kind: "entrypointCoverage",
    key,
    id: createEntrypointRiskId(flow.framework, flow.rootPath),
    framework: flow.framework,
    rootPath: flow.rootPath,
    ambiguousCount: 0,
    handlerNotMappedCount: 0,
    evidenceCount: 0,
    affectedEntrypointCount: 0,
    lastAffectedGroupOrdinal: -1
  };
}

/**
 * Updates unresolved source counts for one entrypoint group. A global exact-key
 * set is used only for numeric deduplication; public identities are collected
 * later for the at-most-five selected candidates.
 */
function scanUnresolvedExecutionGroup(
  _entrypointUnitId: string,
  flows: SemanticFlow[],
  groupOrdinal: number,
  summaries: Map<string, UnresolvedRiskSummary>,
  exactEvidenceKeys: Set<string>
): void {
  for (const flow of flows) {
    if (!hasMappedHandler(flow)) {
      continue;
    }

    for (const step of flow.steps) {
      if (step.kind !== "call" || step.resolution !== "unresolved") {
        continue;
      }

      const evidenceKey = createUnresolvedEvidenceKey(step);
      const sourceKey = step.parentFunctionId ?? `unknown:${evidenceKey}`;
      const summary = summaries.get(sourceKey) ?? createUnresolvedRiskSummary(
        sourceKey,
        step.parentFunctionId
      );

      if (!exactEvidenceKeys.has(evidenceKey)) {
        exactEvidenceKeys.add(evidenceKey);
        summary.evidenceCount += 1;
        summary.firstEvidenceKey = getFirstText(summary.firstEvidenceKey, evidenceKey);
      }

      if (summary.lastAffectedGroupOrdinal !== groupOrdinal) {
        summary.affectedEntrypointCount += 1;
        summary.lastAffectedGroupOrdinal = groupOrdinal;
      }

      summary.confidence = getWeakestOptionalConfidence(
        summary.confidence,
        step.confidence ?? "unresolved"
      );

      if (step.filePath) {
        summary.location = retainFirstLocation(summary.location, {
          filePath: step.filePath,
          range: step.range
        });
      }

      summaries.set(sourceKey, summary);
    }
  }
}

/** Creates constant-size scalar state for one unresolved source candidate. */
function createUnresolvedRiskSummary(
  key: string,
  sourceFunctionId: string | undefined
): UnresolvedRiskSummary {
  return {
    kind: "unresolvedExecution",
    key,
    id: "",
    sourceFunctionId,
    evidenceCount: 0,
    affectedEntrypointCount: 0,
    lastAffectedGroupOrdinal: -1
  };
}

/**
 * Selects category winners, then fills remaining slots through a fixed top-K
 * buffer. No candidate array proportional to repository size is created.
 */
function selectRiskCandidates(scan: RiskScan, limit: number): RiskCandidate[] {
  const winners: RiskCandidate[] = [];

  for (const summary of scan.unresolvedByKey.values()) {
    finalizeUnresolvedRiskId(summary);
  }

  const bestEntrypoint = getBestValue(scan.entrypointsByKey.values(), compareEntrypointRisks);
  const bestUnresolved = getBestValue(scan.unresolvedByKey.values(), compareUnresolvedRisks);

  if (scan.analysis) {
    winners.push(scan.analysis);
  }

  if (bestEntrypoint) {
    winners.push(bestEntrypoint);
  }

  if (bestUnresolved) {
    winners.push(finalizeUnresolvedRiskId(bestUnresolved));
  }

  const remainingLimit = Math.max(0, limit - winners.length);
  const remaining: RiskCandidate[] = [];

  for (const candidate of scan.entrypointsByKey.values()) {
    if (candidate !== bestEntrypoint) {
      retainTopCandidate(remaining, candidate, remainingLimit);
    }
  }

  for (const value of scan.unresolvedByKey.values()) {
    const candidate = finalizeUnresolvedRiskId(value);
    if (value !== bestUnresolved) {
      retainTopCandidate(remaining, candidate, remainingLimit);
    }
  }

  return [...winners, ...remaining];
}

/** Resolves names only for selected sources, avoiding a graph-sized node Map. */
function attachSelectedSourceNames(graph: ProjectGraph, selected: RiskCandidate[]): void {
  const selectedBySourceId = new Map<string, UnresolvedRiskSummary>();

  for (const candidate of selected) {
    if (candidate.kind === "unresolvedExecution" && candidate.sourceFunctionId) {
      selectedBySourceId.set(candidate.sourceFunctionId, candidate);
    }
  }

  if (selectedBySourceId.size === 0) {
    return;
  }

  for (const node of graph.nodes) {
    const candidate = selectedBySourceId.get(node.id);

    if (candidate) {
      candidate.sourceFunctionName = node.qualifiedName || node.name;
      selectedBySourceId.delete(node.id);

      if (selectedBySourceId.size === 0) {
        break;
      }
    }
  }
}

/** Assigns the stable evidence-derived id after the first key is known. */
function finalizeUnresolvedRiskId(summary: UnresolvedRiskSummary): UnresolvedRiskSummary {
  if (summary.id) {
    return summary;
  }

  summary.id = `risk:unresolved-execution:${encodeURIComponent(
    summary.sourceFunctionId ?? summary.firstEvidenceKey ?? "unknown"
  )}`;
  return summary;
}

/** Inserts a candidate into the sorted fixed-size global ranking buffer. */
function retainTopCandidate(
  values: RiskCandidate[],
  candidate: RiskCandidate,
  limit: number
): void {
  retainTopValue(values, candidate, limit, compareRiskItems);
}

/** Collects bounded evidence only for candidates that survived top-K selection. */
function collectSelectedEvidence(
  semanticFlows: SemanticFlowIndex,
  selected: RiskCandidate[]
): Map<string, SelectedRiskEvidence> {
  const evidenceByCandidate = new Map<string, SelectedRiskEvidence>();

  for (const candidate of selected) {
    if (candidate.kind !== "analysisCoverage") {
      evidenceByCandidate.set(createCandidateIdentity(candidate), {
        evidence: createEmptyEvidence()
      });
    }
  }

  scanEntrypointGroups(semanticFlows, (entrypointUnitId, flows) => {
    collectEntrypointEvidence(entrypointUnitId, flows, evidenceByCandidate);
    collectUnresolvedEvidence(entrypointUnitId, flows, evidenceByCandidate);
  });

  return evidenceByCandidate;
}

/** Retains bounded identities for selected mapping coverage candidates. */
function collectEntrypointEvidence(
  entrypointUnitId: string,
  flows: SemanticFlow[],
  selected: Map<string, SelectedRiskEvidence>
): void {
  for (const flow of flows) {
    const state = selected.get(`entrypointCoverage\u0000${createEntrypointRiskKey(flow)}`);

    if (!state) {
      continue;
    }

    let hasMappingGap = false;
    for (const gap of flow.coverageGaps) {
      if (!isEntrypointMappingGap(gap)) {
        continue;
      }

      hasMappingGap = true;
      for (const functionId of gap.candidateFunctionIds) {
        retainSmallestString(state.evidence.targetFunctionIds, functionId);
      }
      for (const frameworkUnitId of gap.targetFrameworkUnitIds) {
        retainSmallestString(state.evidence.frameworkUnitIds, frameworkUnitId);
      }
    }

    if (hasMappingGap) {
      retainSmallestString(state.evidence.entrypointUnitIds, entrypointUnitId);
    }
  }
}

/** Retains bounded identities for selected unresolved source candidates. */
function collectUnresolvedEvidence(
  entrypointUnitId: string,
  flows: SemanticFlow[],
  selected: Map<string, SelectedRiskEvidence>
): void {
  for (const flow of flows) {
    if (!hasMappedHandler(flow)) {
      continue;
    }

    for (const step of flow.steps) {
      if (step.kind !== "call" || step.resolution !== "unresolved") {
        continue;
      }

      const evidenceKey = createUnresolvedEvidenceKey(step);
      const sourceKey = step.parentFunctionId ?? `unknown:${evidenceKey}`;
      const state = selected.get(`unresolvedExecution\u0000${sourceKey}`);

      if (!state) {
        continue;
      }

      retainSmallestString(state.evidence.entrypointUnitIds, entrypointUnitId);
      retainOptionalString(state.evidence.targetFunctionIds, step.functionId);
      retainOptionalString(state.evidence.edgeIds, step.callEdgeId);
    }
  }
}

/** Converts one selected scalar candidate into its public evidence record. */
function finalizeSelectedRisk(
  candidate: RiskCandidate,
  evidenceByCandidate: Map<string, SelectedRiskEvidence>
): ProjectRiskItem {
  if (candidate.kind === "analysisCoverage") {
    return candidate;
  }

  const state = evidenceByCandidate.get(createCandidateIdentity(candidate));
  const evidence = state?.evidence ?? createEmptyEvidence();

  if (candidate.kind === "entrypointCoverage") {
    return {
      id: candidate.id,
      kind: candidate.kind,
      evidenceCount: candidate.evidenceCount,
      affectedEntrypointCount: candidate.affectedEntrypointCount,
      confidence: candidate.confidence,
      location: candidate.location,
      evidence,
      framework: candidate.framework,
      rootPath: candidate.rootPath,
      ambiguousCount: candidate.ambiguousCount,
      handlerNotMappedCount: candidate.handlerNotMappedCount
    };
  }

  evidence.sourceFunctionIds = candidate.sourceFunctionId
    ? [candidate.sourceFunctionId]
    : [];

  return {
    id: candidate.id,
    kind: candidate.kind,
    evidenceCount: candidate.evidenceCount,
    affectedEntrypointCount: candidate.affectedEntrypointCount,
    confidence: candidate.confidence,
    location: candidate.location,
    evidence,
    sourceFunctionId: candidate.sourceFunctionId,
    sourceFunctionName: candidate.sourceFunctionName,
    unresolvedCallCount: candidate.evidenceCount
  };
}

/** Iterates canonical flow groups so distinct entrypoints need no global Set. */
function scanEntrypointGroups(
  semanticFlows: SemanticFlowIndex,
  visit: (entrypointUnitId: string, flows: SemanticFlow[], groupOrdinal: number) => void
): void {
  let groupOrdinal = 0;

  for (const [entrypointUnitId, flows] of semanticFlows.flowsByEntrypointUnitId) {
    visit(entrypointUnitId, flows, groupOrdinal);
    groupOrdinal += 1;
  }
}

/** Creates an evidence object whose arrays are always JSON-safe and bounded. */
function createEmptyEvidence(): ProjectRiskEvidence {
  return {
    diagnosticIndexes: [],
    entrypointUnitIds: [],
    frameworkUnitIds: [],
    sourceFunctionIds: [],
    targetFunctionIds: [],
    omittedFunctionIds: [],
    edgeIds: []
  };
}

/** Adds an optional identity to the bounded evidence buffer. */
function retainOptionalString(values: string[], value: string | undefined): void {
  if (value) {
    retainSmallestString(values, value);
  }
}

/** Returns true only for bounds reached during downstream flow traversal. */
function isTraversalLimitGap(gap: SemanticFlowCoverageGap): boolean {
  return gap.reason === "depthLimit" || gap.reason === "stepLimit";
}

/** Returns true only for handler or resolver selection gaps. */
function isEntrypointMappingGap(gap: SemanticFlowCoverageGap): boolean {
  return gap.reason === "ambiguous" || gap.reason === "handlerNotMapped";
}

/** Returns the route or operation stage that anchors source navigation. */
function getEntrypointStep(flow: SemanticFlow): SemanticFlowStep | undefined {
  return flow.steps.find((step) => step.kind === "route" || step.kind === "operation");
}

/** Requires a concrete handler before unresolved downstream evidence is surfaced. */
function hasMappedHandler(flow: SemanticFlow): boolean {
  return flow.steps.some((step) =>
    step.kind === "handler"
      && step.resolution === "concrete"
      && step.functionId !== undefined
  );
}

/** Creates an edge-first identity when available, otherwise uses call-site facts. */
function createUnresolvedEvidenceKey(step: SemanticFlowStep): string {
  if (step.callEdgeId) {
    return `edge:${step.callEdgeId}`;
  }

  const range = step.range
    ? `${step.range.startLine}:${step.range.startCharacter}:${step.range.endLine}:${step.range.endCharacter}`
    : "unknown";
  return `call:${step.parentFunctionId ?? "unknown"}:${step.functionId ?? step.name}:${step.filePath}:${range}`;
}

/** Creates the private framework/root identity used across both scan passes. */
function createEntrypointRiskKey(flow: SemanticFlow): string {
  return `${flow.framework}\u0000${flow.rootPath}`;
}

/** Creates the stable public id for one framework/root mapping candidate. */
function createEntrypointRiskId(framework: string, rootPath: string): string {
  return `risk:entrypoint-coverage:${encodeURIComponent(framework)}:${encodeURIComponent(rootPath)}`;
}

/** Creates the private candidate identity used to attach bounded evidence. */
function createCandidateIdentity(
  candidate: EntrypointRiskSummary | UnresolvedRiskSummary
): string {
  return `${candidate.kind}\u0000${candidate.key}`;
}

/** Preserves the least certain confidence among combined evidence. */
function getWeakestOptionalConfidence(
  current: EdgeConfidence | undefined,
  candidate: EdgeConfidence | undefined
): EdgeConfidence | undefined {
  if (!current) {
    return candidate;
  }

  if (!candidate) {
    return current;
  }

  return CONFIDENCE_RANK[candidate] > CONFIDENCE_RANK[current] ? candidate : current;
}

/** Keeps the lexicographically first optional identity. */
function getFirstText(current: string | undefined, candidate: string): string {
  return current === undefined || compareText(candidate, current) < 0 ? candidate : current;
}

/** Ranks mapping gaps by affected entrypoints and stable framework scope. */
function compareEntrypointRisks(
  left: EntrypointRiskSummary,
  right: EntrypointRiskSummary
): number {
  return right.affectedEntrypointCount - left.affectedEntrypointCount
    || right.evidenceCount - left.evidenceCount
    || compareText(left.framework, right.framework)
    || compareText(left.rootPath, right.rootPath)
    || compareText(left.id, right.id);
}

/** Ranks unresolved sources by affected execution surface and evidence count. */
function compareUnresolvedRisks(
  left: UnresolvedRiskSummary,
  right: UnresolvedRiskSummary
): number {
  return right.affectedEntrypointCount - left.affectedEntrypointCount
    || right.evidenceCount - left.evidenceCount
    || compareText(left.sourceFunctionId ?? "", right.sourceFunctionId ?? "")
    || compareText(left.id, right.id);
}

/** Fills remaining Radar slots by measured reach, evidence count, and identity. */
function compareRiskItems(left: RiskCandidate, right: RiskCandidate): number {
  return right.affectedEntrypointCount - left.affectedEntrypointCount
    || right.evidenceCount - left.evidenceCount
    || compareText(left.kind, right.kind)
    || compareText(left.id, right.id);
}

/** Locale-independent comparison used for persisted ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
