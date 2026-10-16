/** Source-owned call ranges for joining parser evidence to native graph edges. */
import type { SourceRange } from "../../shared/types";

/** A whole call owns its callee and opening-parenthesis evidence independently. */
export type SourceCallEvidence = { range: SourceRange; evidenceRanges: SourceRange[] };
export type SourceSyntaxLimits = { maxNodes: number; maxDepth: number };
export type SourceCallEvidenceResult = { calls: SourceCallEvidence[]; limited: boolean };
