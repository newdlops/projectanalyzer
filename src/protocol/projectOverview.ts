/**
 * Compact Project Overview payload rendered before the expandable explorer.
 *
 * The protocol carries three factual brief lines and a bounded set of analysis
 * signals. Rich graph indexes stay in the Extension Host and only source-backed
 * identities required for later navigation cross the Webview boundary.
 */

import type { EdgeConfidence, SourceRange } from "../shared/types";

/** Stable facts shown in the first-read Project Brief. */
export type ProjectOverviewFactId = "scopeStack" | "executionSurface" | "analysisCoverage";

/** One concise, evidence-derived project fact. */
export type ProjectOverviewFact = {
  id: ProjectOverviewFactId;
  label: string;
  value: string;
  detail: string;
};

/** Analysis signals supported by the first Risk Radar iteration. */
export type ProjectOverviewSignalKind =
  | "analysisCoverage"
  | "entrypointCoverage"
  | "unresolvedExecution";

/** Bounded evidence identities retained behind one visible signal. */
export type ProjectOverviewSignalEvidence = {
  diagnosticIndexes: number[];
  entrypointUnitIds: string[];
  frameworkUnitIds: string[];
  functionIds: string[];
  edgeIds: string[];
  omittedIdentityCount: number;
};

/** One measured analysis limitation; it does not claim a runtime defect. */
export type ProjectOverviewSignal = {
  id: string;
  kind: ProjectOverviewSignalKind;
  label: string;
  detail: string;
  evidenceCount: number;
  affectedEntrypointCount: number;
  confidence?: EdgeConfidence;
  functionId?: string;
  filePath?: string;
  range?: SourceRange;
  evidence: ProjectOverviewSignalEvidence;
};

/** Small, JSON-only payload sent independently from the full project graph. */
export type ProjectOverviewPayload = {
  graphVersion: string;
  facts: ProjectOverviewFact[];
  signals: ProjectOverviewSignal[];
  candidateSignalCount: number;
  omittedSignalCount: number;
};
