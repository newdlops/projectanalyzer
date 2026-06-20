/**
 * Identity helpers for graph nodes and edges. The implementation is intentionally
 * deterministic so persisted graph data can be diffed across analysis runs.
 */

/** Separator used inside generated graph IDs and kept rare in file paths. */
const ID_SEPARATOR = "::";

/**
 * Builds a stable graph node ID from semantic parts.
 */
export function createNodeId(parts: readonly string[]): string {
  return parts.map(normalizeIdPart).join(ID_SEPARATOR);
}

/**
 * Builds a stable graph edge ID from kind and endpoints.
 */
export function createEdgeId(kind: string, sourceId: string, targetId: string): string {
  return createNodeId(["edge", kind, sourceId, targetId]);
}

/**
 * Normalizes a graph identity part while preserving enough human-readable text
 * for debugging serialized graph payloads.
 */
function normalizeIdPart(part: string): string {
  return part.trim().replace(/\s+/g, " ");
}
