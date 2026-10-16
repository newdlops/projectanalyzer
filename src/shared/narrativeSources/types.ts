/** Host-independent contracts for complete, action-owned source acquisition. */
import type { GraphEdge, SourceRange, SymbolNode } from "../types";

/** Whole text from one editor version or one stable disk-file version. */
export type SourceDocumentSnapshot = { filePath: string; text: string; revision: string };

/** I/O adapter must reject oversized files; returning a prefix is forbidden. */
export interface NarrativeSourceReader {
  read(filePath: string, maximumBytes: number, signal: AbortSignal): Promise<SourceDocumentSnapshot | undefined>;
}

/** Lazy graph boundary. One authority belongs to one action and is disposable. */
export interface NarrativeSourceGraph {
  readonly snapshotId: string;
  getNode(id: string): SymbolNode | undefined;
  getOutgoingEdges(id: string, maximumEdges: number): readonly GraphEdge[];
  getFileContentHash(filePath: string): string | undefined;
  assertCurrent(): void;
  dispose(): void;
}

/** Limits reject incomplete resource admission rather than clipping any source. */
export type SourceCaptureLimits = {
  maxDepth: number;
  maxDeclarations: number;
  maxSourceBytes: number;
  maxFileBytes: number;
  maxTotalFileBytes: number;
  maxGraphNodes: number;
  maxEdges: number;
};

/** Exact source body, including original newlines and UTF-16 coordinates. */
export type CapturedSourceDeclaration = {
  /** Original graph extent, selection, parent and metadata stay Host-owned. */
  graphNode: SymbolNode;
  id: string; filePath: string; name: string; kind: SymbolNode["kind"]; language: string;
  range: SourceRange; text: string; depth: number; sourceSha256: string; fileSha256: string;
};

/** Unknown targets and resource depth remain visible beside exact/inferred edges. */
export type SourceCaptureGap = {
  from?: string; targetId: string; edgeId?: string;
  reason: "symbol-unavailable" | "source-unavailable" | "source-unbound" | "declaration-unavailable" | "unresolved" | "depth-limit" | "analysis-limited" | "call-unrepresented";
};

/** Serializable source evidence. Absolute file identities remain Host-owned. */
export type NarrativeSourceCapture = {
  limits: SourceCaptureLimits;
  snapshotId: string; rootIds: string[]; declarations: CapturedSourceDeclaration[];
  edges: GraphEdge[]; gaps: SourceCaptureGap[]; complete: boolean;
  analysisCaveats: Array<{ declarationId: string; code: string; message: string }>;
  fileVersions: Array<{ filePath: string; revision: string; sha256: string }>;
  capturedUtf8Bytes: number; readFileUtf8Bytes: number; maximumVisitedDepth: number;
};

/** Recheck after model I/O and before publishing; dispose at the action boundary. */
export interface NarrativeSourceLease {
  readonly capture: NarrativeSourceCapture;
  readonly captureSha256: string;
  assertCurrent(signal: AbortSignal): Promise<void>;
  dispose(): void;
}
