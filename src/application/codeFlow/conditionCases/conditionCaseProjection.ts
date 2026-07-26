/**
 * Iterative short-circuit case projection for one Function Logic condition
 * group. It follows explicit true/false CFG edges and never parses labels,
 * executes source, or recursively walks the graph.
 */

import type {
  FunctionLogicConditionCaseBlock,
  FunctionLogicConditionCaseEdge,
  FunctionLogicConditionCaseProjection,
  FunctionLogicConditionCaseProjectionOptions,
  FunctionLogicConditionCaseRow,
  FunctionLogicConditionCaseValue
} from "./types";

const DEFAULT_MAXIMUM_COLUMNS = 6;
const DEFAULT_MAXIMUM_ROWS = 32;

type BooleanConditionEdge = FunctionLogicConditionCaseEdge & {
  kind: "true" | "false";
};

/**
 * Enumerates complete true/false evaluation paths for one root condition.
 * Returns undefined for simple legacy blocks or groups too large to display
 * honestly inside the bounded Inspector table.
 */
export function createFunctionLogicConditionCaseProjection(
  blocks: readonly FunctionLogicConditionCaseBlock[],
  edges: readonly FunctionLogicConditionCaseEdge[],
  rootBlockId: string,
  options: FunctionLogicConditionCaseProjectionOptions = {}
): FunctionLogicConditionCaseProjection | undefined {
  const root = blocks.find((block) => block.id === rootBlockId);
  const rootCondition = root?.condition;
  if (!root || !rootCondition?.root) {
    return undefined;
  }

  const maximumColumns = normalizeLimit(options.maximumColumns, DEFAULT_MAXIMUM_COLUMNS);
  const maximumRows = normalizeLimit(options.maximumRows, DEFAULT_MAXIMUM_ROWS);
  const members = blocks
    .filter((block) => block.condition?.groupId === rootCondition.groupId)
    .sort((left, right) => {
      const indexDifference = (left.condition?.memberIndex ?? 0) - (right.condition?.memberIndex ?? 0);
      return indexDifference || compareIdentity(left.id, right.id);
    });
  if (members.length === 0 || members.length > maximumColumns || members[0]?.id !== root.id) {
    return undefined;
  }

  const memberIndexByBlockId = new Map(members.map((block, index) => [block.id, index]));
  const outgoingBySourceId = new Map<string, BooleanConditionEdge[]>();
  for (const edge of edges) {
    if (!isBooleanConditionEdge(edge)) {
      continue;
    }
    const outgoing = outgoingBySourceId.get(edge.sourceId) ?? [];
    outgoing.push(edge);
    outgoingBySourceId.set(edge.sourceId, outgoing);
  }
  const completeRows: FunctionLogicConditionCaseRow[] = [];
  const seenRows = new Set<string>();
  const pending = [{
    blockId: root.id,
    values: Array<FunctionLogicConditionCaseValue>(members.length).fill("skipped"),
    choiceEdgeIds: [] as string[],
    depth: 0
  }];
  const maximumDepth = members.length;
  let cursor = 0;
  while (cursor < pending.length) {
    const current = pending[cursor];
    cursor += 1;
    const memberIndex = memberIndexByBlockId.get(current.blockId);
    if (memberIndex === undefined || current.depth >= maximumDepth) {
      continue;
    }
    for (const edge of outgoingBySourceId.get(current.blockId) ?? []) {
      const values = [...current.values];
      values[memberIndex] = edge.kind;
      const choiceEdgeIds = [...current.choiceEdgeIds, edge.id];
      if (memberIndexByBlockId.has(edge.targetId)) {
        pending.push({
          blockId: edge.targetId,
          values,
          choiceEdgeIds,
          depth: current.depth + 1
        });
        continue;
      }
      const row = createCaseRow(values, edge.kind, choiceEdgeIds, edge.targetId);
      const key = `${row.result}\0${row.choiceEdgeIds.join("\0")}\0${row.targetBlockId}`;
      if (!seenRows.has(key)) {
        seenRows.add(key);
        completeRows.push(row);
      }
    }
  }

  if (completeRows.length === 0) {
    return undefined;
  }
  return {
    columns: members.map((block) => ({
      blockId: block.id,
      expression: block.condition?.expression ?? "condition"
    })),
    rows: completeRows.slice(0, maximumRows),
    omittedCaseCount: Math.max(0, completeRows.length - maximumRows)
  };
}

/** Creates one deterministic row identity without exposing presentation order as state. */
function createCaseRow(
  values: FunctionLogicConditionCaseValue[],
  result: "true" | "false",
  choiceEdgeIds: string[],
  targetBlockId: string
): FunctionLogicConditionCaseRow {
  return {
    id: `case:${choiceEdgeIds.join(":")}`,
    values,
    result,
    choiceEdgeIds,
    targetBlockId
  };
}

/** Narrows the CFG vocabulary to concrete boolean decision outcomes. */
function isBooleanConditionEdge(edge: FunctionLogicConditionCaseEdge): edge is BooleanConditionEdge {
  return edge.kind === "true" || edge.kind === "false";
}

/** Restricts untrusted configuration input to a small positive integer bound. */
function normalizeLimit(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(1, Math.floor(value));
}

/** Uses stable code-point ordering only to break duplicate member-index ties. */
function compareIdentity(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
