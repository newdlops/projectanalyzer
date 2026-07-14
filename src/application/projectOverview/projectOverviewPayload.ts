/**
 * Presentation adapter for the first-read Project Brief and Risk Radar.
 *
 * Domain results remain evidence-rich while this boundary emits exactly three
 * facts and at most three signals, preventing the overview itself from becoming
 * another large-repository information dump.
 */

import type {
  ProjectOverview,
  ProjectRiskEvidence,
  ProjectRiskItem
} from "../../insights/projectOverview";
import type {
  ProjectOverviewFact,
  ProjectOverviewPayload,
  ProjectOverviewSignal,
  ProjectOverviewSignalEvidence
} from "../../protocol/projectOverview";

/** Number of signals visible before users move into detailed explorer rows. */
const VISIBLE_SIGNAL_LIMIT = 3;

/** Identity cap per evidence category crossing into the Webview. */
const EVIDENCE_IDENTITY_LIMIT = 3;

/** Converts domain facts into a small, deterministic Webview payload. */
export function createProjectOverviewPayload(overview: ProjectOverview): ProjectOverviewPayload {
  const visibleItems = overview.radar.items.slice(0, VISIBLE_SIGNAL_LIMIT);

  return {
    graphVersion: overview.graphVersion,
    facts: createOverviewFacts(overview),
    signals: visibleItems.map(createOverviewSignal),
    candidateSignalCount: overview.radar.candidateItemCount,
    omittedSignalCount:
      overview.radar.omittedItemCount
      + Math.max(0, overview.radar.items.length - visibleItems.length)
  };
}

/** Creates the three factual lines that answer scope, execution, and confidence. */
function createOverviewFacts(overview: ProjectOverview): ProjectOverviewFact[] {
  const brief = overview.brief;
  const scope = brief.scope;
  const execution = brief.executionSurface;
  const coverage = brief.analysisCoverage;
  const languageLabel = formatBoundedNames(
    brief.stack.languages.map((language) => language.language),
    2,
    "no supported languages"
  );
  const frameworkLabel = formatBoundedNames(
    brief.stack.frameworkRoots.map((root) => root.name),
    2,
    "no detected frameworks"
  );
  const recordedGapCount =
    coverage.errorDiagnosticCount
    + coverage.warningDiagnosticCount
    + coverage.unresolvedCallEdgeCount
    + coverage.inferredCallEdgeCount
    + coverage.ambiguousEntrypointCount
    + coverage.handlerNotMappedCount
    + coverage.traversalLimitGapCount;

  return [
    {
      id: "scopeStack",
      label: "Scope & Stack",
      value: `${scope.analyzedFileCount} files · ${languageLabel}`,
      detail:
        `${scope.callableCount} callables · ${brief.stack.frameworkRoots.length} roots · `
        + frameworkLabel
    },
    {
      id: "executionSurface",
      label: "Execution Surface",
      value: `${execution.entrypointCount} entrypoints · ${execution.mappedCount} mapped`,
      detail:
        `${execution.routeCount} HTTP routes · ${execution.operationCount} GraphQL operations · `
        + `${execution.mappingGapCount} mapping gaps`
    },
    {
      id: "analysisCoverage",
      label: "Analysis Coverage",
      value: recordedGapCount === 0 ? "No recorded analysis gaps" : `${recordedGapCount} recorded gap signals`,
      detail:
        `${coverage.errorDiagnosticCount} errors · ${coverage.unresolvedCallEdgeCount} unresolved calls · `
        + `${coverage.inferredCallEdgeCount} inferred calls · ${coverage.traversalLimitGapCount} bounded paths`
    }
  ];
}

/** Formats one domain signal without strengthening its confidence or severity. */
function createOverviewSignal(item: ProjectRiskItem): ProjectOverviewSignal {
  const base = {
    id: item.id,
    kind: item.kind,
    evidenceCount: item.evidenceCount,
    affectedEntrypointCount: item.affectedEntrypointCount,
    confidence: item.confidence,
    filePath: item.location?.filePath,
    range: item.location?.range,
    evidence: createSignalEvidence(item.evidence)
  };

  if (item.kind === "analysisCoverage") {
    return {
      ...base,
      label: "Analysis blind spots",
      detail:
        `${item.errorDiagnosticCount} errors · ${item.warningDiagnosticCount} warnings · `
        + `${item.traversalLimitGapCount} bounded paths`
    };
  }

  if (item.kind === "entrypointCoverage") {
    return {
      ...base,
      label: `${item.framework} entrypoint mapping`,
      detail:
        `${item.handlerNotMappedCount} unmapped · ${item.ambiguousCount} ambiguous · `
        + formatRootPath(item.rootPath)
    };
  }

  return {
    ...base,
    label: `${item.sourceFunctionName ?? "Mapped flow"} has unresolved calls`,
    detail:
      `${item.unresolvedCallCount} unresolved · `
      + `${item.affectedEntrypointCount} affected entrypoints`,
    functionId: item.sourceFunctionId
  };
}

/** Retains a few source identities and explicitly counts those left host-side. */
function createSignalEvidence(evidence: ProjectRiskEvidence): ProjectOverviewSignalEvidence {
  const functionIds = uniqueSortedStrings([
    ...evidence.sourceFunctionIds,
    ...evidence.targetFunctionIds
  ]);
  const diagnosticIndexes = uniqueSortedNumbers(evidence.diagnosticIndexes);
  const entrypointUnitIds = uniqueSortedStrings(evidence.entrypointUnitIds);
  const frameworkUnitIds = uniqueSortedStrings(evidence.frameworkUnitIds);
  const edgeIds = uniqueSortedStrings(evidence.edgeIds);
  const retainedDiagnosticIndexes = diagnosticIndexes.slice(0, EVIDENCE_IDENTITY_LIMIT);
  const retainedEntrypointUnitIds = entrypointUnitIds.slice(0, EVIDENCE_IDENTITY_LIMIT);
  const retainedFrameworkUnitIds = frameworkUnitIds.slice(0, EVIDENCE_IDENTITY_LIMIT);
  const retainedFunctionIds = functionIds.slice(0, EVIDENCE_IDENTITY_LIMIT);
  const retainedEdgeIds = edgeIds.slice(0, EVIDENCE_IDENTITY_LIMIT);

  return {
    diagnosticIndexes: retainedDiagnosticIndexes,
    entrypointUnitIds: retainedEntrypointUnitIds,
    frameworkUnitIds: retainedFrameworkUnitIds,
    functionIds: retainedFunctionIds,
    edgeIds: retainedEdgeIds,
    omittedIdentityCount:
      diagnosticIndexes.length - retainedDiagnosticIndexes.length
      + entrypointUnitIds.length - retainedEntrypointUnitIds.length
      + frameworkUnitIds.length - retainedFrameworkUnitIds.length
      + functionIds.length - retainedFunctionIds.length
      + edgeIds.length - retainedEdgeIds.length
      + evidence.omittedFunctionIds.length
  };
}

/** Produces a compact distinct-name list with an explicit omission count. */
function formatBoundedNames(values: string[], limit: number, emptyLabel: string): string {
  const unique = uniqueSortedStrings(values);

  if (unique.length === 0) {
    return emptyLabel;
  }

  const visible = unique.slice(0, limit).join("/");
  const omitted = unique.length - limit;
  return omitted > 0 ? `${visible} +${omitted}` : visible;
}

/** Keeps a framework root readable without sending a long absolute display path. */
function formatRootPath(rootPath: string): string {
  const normalized = rootPath.trim().replace(/\\/gu, "/");

  if (!normalized || normalized === ".") {
    return "workspace root";
  }

  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-3).join("/") || "workspace root";
}

/** Returns stable distinct string identities. */
function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

/** Returns stable distinct numeric identities. */
function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

/** Locale-independent comparison for persisted payload ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
