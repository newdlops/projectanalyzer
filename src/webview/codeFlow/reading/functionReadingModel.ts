/** Pure, bounded projection of delivered source order into an inspectable outline. */
import type { FunctionReadingBlock, FunctionReadingOutline } from "./types";

/**
 * Retains source emission order within each attached function. Layout rank is
 * intentionally not execution order: it can interleave opposite branch bodies.
 * A visible-ID set and visited set exclude stale layout references and duplicates.
 */
export function createFunctionReadingOutline(
  logic: { blocks: readonly FunctionReadingBlock[]; layout: { nodes: readonly { blockId: string }[] } },
  maxItems = 400
): FunctionReadingOutline {
  const visibleIds = new Set(logic.layout.nodes.map((node) => node.blockId));
  const visited = new Set<string>();
  const limit = Math.max(1, Math.min(400, Math.floor(maxItems) || 400));
  const result: FunctionReadingOutline = {
    rows: [], counts: { all: 0, decisions: 0, calls: 0, exits: 0 }, omittedCount: 0
  };
  for (const block of logic.blocks) {
    if (!visibleIds.has(block.id) || visited.has(block.id)) continue;
    visited.add(block.id);
    if (result.rows.length >= limit) { result.omittedCount += 1; continue; }
    const row: FunctionReadingOutline["rows"][number] = {
      block, ordinal: result.rows.length + 1, categories: ["all"]
    };
    if (["condition", "loop", "switch", "try"].includes(block.kind)) row.categories.push("decisions");
    if (["call", "effect", "render", "event"].includes(block.kind) || block.drillTargets?.length) row.categories.push("calls");
    if (["return", "throw", "exit"].includes(block.kind)) row.categories.push("exits");
    for (const category of row.categories) result.counts[category] += 1;
    result.rows.push(row);
  }
  return result;
}

/** Serializes the same tested projection for the nonce-protected browser program. */
export function getFunctionReadingModelBrowserSource(): string {
  return createFunctionReadingOutline.toString();
}
