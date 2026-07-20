/**
 * Shared bounded Function Logic data-flow projection. It maps language-owned
 * binding/access facts to visible blocks and walks incoming CFG edges with an
 * explicit queue, depth bound, and visited map to find reaching definitions.
 */

import { createContentHash } from "../../../shared/hash";
import type { SourceRange } from "../../../shared/types";
import type {
  FunctionLogicBlock,
  FunctionLogicConfidence,
  FunctionLogicEdge
} from "../types";
import type {
  FunctionLogicValueAccess,
  FunctionLogicValueBinding,
  FunctionLogicValueFacts,
  FunctionLogicValueFlow
} from "./types";

const DEFAULT_MAX_VALUE_FLOWS = 900;
const ALLOWED_MAX_VALUE_FLOWS = 1_500;

/** Enriched visible blocks plus bounded value identities and def-use relations. */
export type FunctionLogicDataFlowProjection = {
  blocks: FunctionLogicBlock[];
  valueBindings: FunctionLogicValueBinding[];
  valueFlows: FunctionLogicValueFlow[];
  omittedFactCount: number;
  omittedFlowCount: number;
};

/**
 * Maps exact parser facts to visible blocks and derives reaching definitions.
 * `maximumDepth` and `maximumFlows` are explicit call-site bounds for large or
 * cyclic graphs; no recursive traversal is used.
 */
export function createFunctionLogicDataFlowProjection(
  blocks: readonly FunctionLogicBlock[],
  edges: readonly FunctionLogicEdge[],
  facts: FunctionLogicValueFacts,
  maximumDepth = blocks.length,
  maximumFlows = DEFAULT_MAX_VALUE_FLOWS
): FunctionLogicDataFlowProjection {
  const entryBlock = blocks.find((block) => block.kind === "entry") ?? blocks[0];
  if (!entryBlock || facts.bindings.length === 0) {
    return {
      blocks: [...blocks],
      valueBindings: [],
      valueFlows: [],
      omittedFactCount: (facts.omittedBindingCount ?? 0) + (facts.omittedAccessCount ?? 0),
      omittedFlowCount: 0
    };
  }

  const bindingFactsById = new Map(facts.bindings.map((binding) => [binding.id, binding]));
  const valueBindings: FunctionLogicValueBinding[] = [];
  const accessesByBlockId = new Map<string, FunctionLogicValueAccess[]>();
  for (const binding of facts.bindings) {
    const definitionBlockId = binding.definitionPlacement === "entry"
      ? entryBlock.id
      : findSmallestContainingBlockId(blocks, binding.declarationRange);
    if (!definitionBlockId) {
      continue;
    }
    valueBindings.push({
      id: binding.id,
      name: binding.name,
      kind: binding.kind,
      definitionBlockId,
      confidence: binding.confidence,
      ...(binding.valueRole ? { valueRole: binding.valueRole } : {})
    });
    appendValueAccess(accessesByBlockId, definitionBlockId, {
      bindingId: binding.id,
      name: binding.name,
      bindingKind: binding.kind,
      access: "define",
      confidence: binding.confidence,
      ...(binding.valueRole ? { valueRole: binding.valueRole } : {})
    });
  }

  const retainedBindingIds = new Set(valueBindings.map((binding) => binding.id));
  for (const fact of facts.accesses) {
    const binding = bindingFactsById.get(fact.bindingId);
    if (!binding || !retainedBindingIds.has(binding.id)) {
      continue;
    }
    const blockId = findSmallestContainingBlockId(blocks, fact.range);
    if (!blockId) {
      continue;
    }
    appendValueAccess(accessesByBlockId, blockId, {
      bindingId: binding.id,
      name: binding.name,
      bindingKind: binding.kind,
      access: fact.access,
      ...(fact.usage ? { usage: fact.usage } : {}),
      confidence: combineConfidence(binding.confidence, fact.confidence),
      ...(binding.valueRole ? { valueRole: binding.valueRole } : {})
    });
  }

  const enrichedBlocks = blocks.map((block) => {
    const valueAccesses = accessesByBlockId.get(block.id);
    return valueAccesses && valueAccesses.length > 0
      ? { ...block, valueAccesses }
      : block;
  });
  const boundedDepth = normalizeBound(maximumDepth, blocks.length, blocks.length);
  const boundedFlows = normalizeBound(
    maximumFlows,
    DEFAULT_MAX_VALUE_FLOWS,
    ALLOWED_MAX_VALUE_FLOWS
  );
  const incomingByTargetId = createIncomingEdgeIndex(blocks, edges);
  const definitionsByBindingId = createDefinitionIndex(accessesByBlockId);
  const valueFlows: FunctionLogicValueFlow[] = [];
  const seenFlowKeys = new Set<string>();
  let omittedFlowCount = 0;

  for (const [targetBlockId, accesses] of accessesByBlockId) {
    for (const access of accesses) {
      if (access.access !== "read" && access.access !== "readwrite") {
        continue;
      }
      const sources = findReachingDefinitionBlocks(
        targetBlockId,
        access.bindingId,
        incomingByTargetId,
        definitionsByBindingId,
        boundedDepth
      );
      for (const sourceBlockId of sources) {
        const key = [
          access.bindingId,
          sourceBlockId,
          targetBlockId,
          access.access,
          access.usage ?? "use"
        ].join("\0");
        if (seenFlowKeys.has(key)) {
          continue;
        }
        seenFlowKeys.add(key);
        if (valueFlows.length >= boundedFlows) {
          omittedFlowCount += 1;
          continue;
        }
        valueFlows.push({
          id: `logic-value-flow:${createContentHash(key).slice(0, 32)}`,
          bindingId: access.bindingId,
          sourceBlockId,
          targetBlockId,
          targetAccess: access.access,
          ...(access.usage ? { targetUsage: access.usage } : {}),
          confidence: combineConfidence(
            access.confidence,
            definitionsByBindingId.get(access.bindingId)?.get(sourceBlockId) ?? "exact"
          )
        });
      }
    }
  }

  return {
    blocks: enrichedBlocks,
    valueBindings,
    valueFlows,
    omittedFactCount: (facts.omittedBindingCount ?? 0) + (facts.omittedAccessCount ?? 0),
    omittedFlowCount
  };
}

/** Keeps one semantic access row per binding, block, role, and confidence. */
function appendValueAccess(
  accessesByBlockId: Map<string, FunctionLogicValueAccess[]>,
  blockId: string,
  access: FunctionLogicValueAccess
): void {
  const values = accessesByBlockId.get(blockId) ?? [];
  if (!values.some((candidate) =>
    candidate.bindingId === access.bindingId
      && candidate.access === access.access
      && candidate.usage === access.usage
      && candidate.confidence === access.confidence
  )) {
    values.push(access);
    accessesByBlockId.set(blockId, values);
  }
}

/** Maps an access to the most specific visible range, preferring deeper blocks. */
function findSmallestContainingBlockId(
  blocks: readonly FunctionLogicBlock[],
  range: SourceRange
): string | undefined {
  let selected: FunctionLogicBlock | undefined;
  for (const block of blocks) {
    if (block.kind === "entry" || block.kind === "exit" || !containsRange(block.range, range)) {
      continue;
    }
    if (!selected
      || rangeSpan(block.range) < rangeSpan(selected.range)
      || (rangeSpan(block.range) === rangeSpan(selected.range) && block.depth > selected.depth)) {
      selected = block;
    }
  }
  return selected?.id;
}

/** Builds incoming adjacency only for edges whose endpoints remain visible. */
function createIncomingEdgeIndex(
  blocks: readonly FunctionLogicBlock[],
  edges: readonly FunctionLogicEdge[]
): Map<string, string[]> {
  const blockIds = new Set(blocks.map((block) => block.id));
  const incomingByTargetId = new Map<string, string[]>();
  for (const edge of edges) {
    if (!blockIds.has(edge.sourceId) || !blockIds.has(edge.targetId)) {
      continue;
    }
    const incoming = incomingByTargetId.get(edge.targetId) ?? [];
    if (!incoming.includes(edge.sourceId)) {
      incoming.push(edge.sourceId);
      incomingByTargetId.set(edge.targetId, incoming);
    }
  }
  return incomingByTargetId;
}

/** Indexes every definition or write because each kills earlier definitions. */
function createDefinitionIndex(
  accessesByBlockId: ReadonlyMap<string, readonly FunctionLogicValueAccess[]>
): Map<string, Map<string, FunctionLogicConfidence>> {
  const result = new Map<string, Map<string, FunctionLogicConfidence>>();
  for (const [blockId, accesses] of accessesByBlockId) {
    for (const access of accesses) {
      if (access.access !== "define" && access.access !== "write"
        && access.access !== "readwrite") {
        continue;
      }
      const definitions = result.get(access.bindingId) ?? new Map();
      const previous = definitions.get(blockId);
      definitions.set(
        blockId,
        previous === "inferred" ? "inferred" : access.confidence
      );
      result.set(access.bindingId, definitions);
    }
  }
  return result;
}

/**
 * Walks predecessors until each path reaches its nearest definition. A block
 * may reappear only at a shallower depth, which terminates cycles while still
 * retaining loop-carried definitions.
 */
function findReachingDefinitionBlocks(
  targetBlockId: string,
  bindingId: string,
  incomingByTargetId: ReadonlyMap<string, readonly string[]>,
  definitionsByBindingId: ReadonlyMap<string, ReadonlyMap<string, FunctionLogicConfidence>>,
  maximumDepth: number
): string[] {
  const definitions = definitionsByBindingId.get(bindingId);
  if (!definitions || maximumDepth <= 0) {
    return [];
  }
  const pending = (incomingByTargetId.get(targetBlockId) ?? []).map((blockId) => ({
    blockId,
    depth: 1
  }));
  const bestDepthByBlockId = new Map<string, number>();
  const reaching = new Set<string>();
  let cursor = 0;
  while (cursor < pending.length) {
    const { blockId, depth } = pending[cursor];
    cursor += 1;
    const bestDepth = bestDepthByBlockId.get(blockId);
    if (bestDepth !== undefined && bestDepth <= depth) {
      continue;
    }
    bestDepthByBlockId.set(blockId, depth);
    if (definitions.has(blockId)) {
      reaching.add(blockId);
      continue;
    }
    if (depth >= maximumDepth) {
      continue;
    }
    for (const predecessorId of incomingByTargetId.get(blockId) ?? []) {
      pending.push({ blockId: predecessorId, depth: depth + 1 });
    }
  }
  return [...reaching].sort();
}

/** Source positions are compared lexicographically without converting files. */
function containsRange(container: SourceRange, candidate: SourceRange): boolean {
  return comparePosition(container.startLine, container.startCharacter,
    candidate.startLine, candidate.startCharacter) <= 0
    && comparePosition(container.endLine, container.endCharacter,
      candidate.endLine, candidate.endCharacter) >= 0;
}

/** Provides a stable approximate range size for specificity comparisons. */
function rangeSpan(range: SourceRange): number {
  return Math.max(
    0,
    (range.endLine - range.startLine) * 1_000_000
      + range.endCharacter - range.startCharacter
  );
}

/** Compares two zero-based line/character positions. */
function comparePosition(
  leftLine: number,
  leftCharacter: number,
  rightLine: number,
  rightCharacter: number
): number {
  return leftLine - rightLine || leftCharacter - rightCharacter;
}

/** A single inferred input keeps the resulting static relation inferred. */
function combineConfidence(
  left: FunctionLogicConfidence,
  right: FunctionLogicConfidence
): FunctionLogicConfidence {
  return left === "inferred" || right === "inferred" ? "inferred" : "exact";
}

/** Bounds caller-provided traversal and payload limits. */
function normalizeBound(value: number, fallback: number, maximum: number): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(0, Math.floor(value)))
    : fallback;
}
