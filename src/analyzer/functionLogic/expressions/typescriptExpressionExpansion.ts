/**
 * TypeScript/JavaScript expression-fragment CFG integration. Value fragments
 * feed their containing statement; boolean fragments replace a control header
 * while preserving its stable owner identity and loop continuation targets.
 */

import * as ts from "typescript";
import { createFunctionLogicEdge } from "../core/functionLogicSupport";
import type {
  FunctionLogicBlock,
  FunctionLogicEdge,
  FunctionLogicEdgeKind,
  FunctionLogicValueChange
} from "../types";
import type {
  TypeScriptBooleanExpressionFlowFragment,
  TypeScriptExpressionFlowExit,
  TypeScriptExpressionFlowRequest,
  TypeScriptValueExpressionFlowFragment
} from "./types";
import { planTypeScriptExpressionFlow } from "./typescriptExpressionPlanner";

export type TypeScriptExpressionFlowExpansion = {
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  addedBlockCount: number;
  omittedRegionCount: number;
};

/** Splices source-ordered requests into one already-structured statement CFG. */
export function expandTypeScriptExpressionFlows(input: {
  sourceFile: ts.SourceFile;
  filePath: string;
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  requests: readonly TypeScriptExpressionFlowRequest[];
  remainingBlockBudget: number;
}): TypeScriptExpressionFlowExpansion {
  let blocks = [...input.blocks];
  let edges = [...input.edges];
  let remainingBlockBudget = Math.max(0, Math.floor(input.remainingBlockBudget));
  let addedBlockCount = 0;
  let omittedRegionCount = 0;

  for (const request of input.requests) {
    const anchor = blocks.find((block) => block.id === request.anchorBlockId);
    if (!anchor) {
      continue;
    }
    const reusableAnchorCount = request.mode === "boolean" ? 1 : 0;
    const plan = planTypeScriptExpressionFlow({
      sourceFile: input.sourceFile,
      filePath: input.filePath,
      expression: request.expression,
      mode: request.mode,
      maxBlocks: remainingBlockBudget + reusableAnchorCount
    });
    omittedRegionCount += plan.omittedRegionCount;
    if (!plan.fragment) {
      continue;
    }

    if (request.mode === "boolean" && plan.fragment.mode === "boolean") {
      const expansion = replaceBooleanControlAnchor(
        blocks,
        edges,
        anchor,
        plan.fragment
      );
      if (!expansion) {
        continue;
      }
      blocks = expansion.blocks;
      edges = expansion.edges;
      remainingBlockBudget -= expansion.addedBlockCount;
      addedBlockCount += expansion.addedBlockCount;
      continue;
    }
    if (request.mode === "value" && plan.fragment.mode === "value") {
      const expansion = insertValueFragment(blocks, edges, anchor, plan.fragment);
      blocks = expansion.blocks;
      edges = expansion.edges;
      remainingBlockBudget -= expansion.addedBlockCount;
      addedBlockCount += expansion.addedBlockCount;
    }
  }

  return {
    blocks,
    edges: deduplicateEdges(edges),
    addedBlockCount,
    omittedRegionCount
  };
}

/** Inserts a value-selection fragment immediately before its consuming block. */
function insertValueFragment(
  blocks: FunctionLogicBlock[],
  edges: FunctionLogicEdge[],
  anchor: FunctionLogicBlock,
  fragment: TypeScriptValueExpressionFlowFragment
): {
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  addedBlockCount: number;
} {
  const fragmentBlocks = fragment.blocks.map((block) => ({
    ...block,
    depth: anchor.depth,
    parentBlockId: anchor.parentBlockId,
    branchLabel: anchor.branchLabel
  }));
  const completion = specializeValueCompletionAnchor(anchor, fragmentBlocks);
  const rewired = edges.map((edge) => edge.targetId === anchor.id
    ? createFunctionLogicEdge(
        edge.sourceId,
        fragment.entryBlockId,
        edge.kind,
        edge.label,
        edge.confidence
      )
    : edge
  );
  const exitEdges = fragment.exits.map((exit) => createFunctionLogicEdge(
    exit.sourceId,
    anchor.id,
    exit.kind,
    exit.label ?? "use selected value",
    "exact"
  ));
  return {
    blocks: blocks.flatMap((block) => block.id === anchor.id
      ? [...fragmentBlocks, completion]
      : [block]
    ),
    edges: [...rewired, ...fragment.edges, ...exitEdges],
    addedBlockCount: fragmentBlocks.length
  };
}

/**
 * Replaces a condition/loop header with the fragment entry, then routes every
 * truthy/falsy leaf to the original structural targets.
 */
function replaceBooleanControlAnchor(
  blocks: FunctionLogicBlock[],
  edges: FunctionLogicEdge[],
  anchor: FunctionLogicBlock,
  fragment: TypeScriptBooleanExpressionFlowFragment
): {
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  addedBlockCount: number;
} | undefined {
  const outgoing = edges.filter((edge) => edge.sourceId === anchor.id);
  const truthyTargets = outgoing.filter((edge) => isTruthyStructuralEdge(edge.kind));
  const falsyTargets = outgoing.filter((edge) => isFalsyStructuralEdge(edge.kind));
  if (truthyTargets.length === 0 || falsyTargets.length === 0) {
    return undefined;
  }
  const renamed = renameBooleanFragmentEntry(fragment, anchor.id);
  const replacementBlocks = decorateBooleanFragmentBlocks(renamed.blocks, anchor);
  const replacedOutgoingIds = new Set([
    ...truthyTargets.map((edge) => edge.id),
    ...falsyTargets.map((edge) => edge.id)
  ]);
  const retainedEdges = edges.filter((edge) => !replacedOutgoingIds.has(edge.id));
  const finalEdges = [
    ...connectStructuralExits(renamed.truthyExits, truthyTargets),
    ...connectStructuralExits(renamed.falsyExits, falsyTargets)
  ];
  return {
    blocks: blocks.flatMap((block) => block.id === anchor.id
      ? replacementBlocks
      : [block]
    ),
    edges: [...retainedEdges, ...renamed.edges, ...finalEdges],
    addedBlockCount: Math.max(0, replacementBlocks.length - 1)
  };
}

/** Renames only the fragment entry so loop-body repeat edges remain valid. */
function renameBooleanFragmentEntry(
  fragment: TypeScriptBooleanExpressionFlowFragment,
  anchorId: string
): TypeScriptBooleanExpressionFlowFragment {
  const oldEntryId = fragment.entryBlockId;
  const rename = (value: string): string => value === oldEntryId ? anchorId : value;
  return {
    ...fragment,
    entryBlockId: anchorId,
    blocks: fragment.blocks.map((block) => block.id === oldEntryId
      ? { ...block, id: anchorId }
      : block
    ),
    edges: fragment.edges.map((edge) => createFunctionLogicEdge(
      rename(edge.sourceId),
      rename(edge.targetId),
      edge.kind,
      edge.label,
      edge.confidence
    )),
    truthyExits: fragment.truthyExits.map((exit) => ({
      ...exit,
      sourceId: rename(exit.sourceId)
    })),
    falsyExits: fragment.falsyExits.map((exit) => ({
      ...exit,
      sourceId: rename(exit.sourceId)
    }))
  };
}

/** Gives expression decisions structural depth without changing body ownership. */
function decorateBooleanFragmentBlocks(
  blocks: FunctionLogicBlock[],
  anchor: FunctionLogicBlock
): FunctionLogicBlock[] {
  return blocks.map((block) => {
    if (block.id === anchor.id) {
      return {
        ...block,
        kind: anchor.kind,
        // The stable owner retains the complete source condition for evidence
        // while naming which operand its outgoing short-circuit edges evaluate.
        label: `${anchor.label} · first step: ${block.label}`,
        detail: anchor.kind === "loop"
          ? "Evaluates this short-circuit step before entering or repeating the loop body."
          : "Preserves the complete condition while evaluating this first short-circuit operand.",
        depth: anchor.depth,
        parentBlockId: anchor.parentBlockId,
        branchLabel: anchor.branchLabel,
        valueChanges: anchor.valueChanges,
        confidence: anchor.confidence,
        filePath: anchor.filePath,
        range: anchor.range
      };
    }
    return {
      ...block,
      depth: anchor.depth + 1,
      parentBlockId: anchor.id,
      branchLabel: anchor.branchLabel
    };
  });
}

/** Routes pending expression outcomes to an original if/loop destination. */
function connectStructuralExits(
  exits: readonly TypeScriptExpressionFlowExit[],
  targets: readonly FunctionLogicEdge[]
): FunctionLogicEdge[] {
  return exits.flatMap((exit) => targets.map((target) => createFunctionLogicEdge(
    exit.sourceId,
    target.targetId,
    target.kind,
    createStructuralOutcomeLabel(exit.label, target),
    target.confidence
  )));
}

/** Preserves loop entry/exit meaning while avoiding redundant true/false text. */
function createStructuralOutcomeLabel(
  outcome: string | undefined,
  target: FunctionLogicEdge
): string | undefined {
  if (!outcome) {
    return target.label;
  }
  if (target.kind === "iterate") {
    return `${outcome} · iterate`;
  }
  if (target.kind === "exit") {
    return `${outcome} · exit loop`;
  }
  return outcome;
}

/** Identifies the positive side of an existing structured control header. */
function isTruthyStructuralEdge(kind: FunctionLogicEdgeKind): boolean {
  return kind === "true" || kind === "iterate";
}

/** Identifies the negative side of an existing structured control header. */
function isFalsyStructuralEdge(kind: FunctionLogicEdgeKind): boolean {
  return kind === "false" || kind === "exit";
}

/** Direct logical expression statements end at an explicit, non-call merge. */
function specializeValueCompletionAnchor(
  anchor: FunctionLogicBlock,
  fragmentBlocks: readonly FunctionLogicBlock[]
): FunctionLogicBlock {
  const branchChangeKeys = new Set(fragmentBlocks.flatMap((block) =>
    block.valueChanges?.map(createValueChangeKey) ?? []
  ));
  const retainedChanges = anchor.valueChanges?.filter((change) =>
    !branchChangeKeys.has(createValueChangeKey(change))
  );
  const completion = {
    ...anchor,
    valueChanges: retainedChanges && retainedChanges.length > 0
      ? retainedChanges
      : undefined
  };
  if (anchor.kind !== "call" && anchor.kind !== "effect" && anchor.kind !== "operation") {
    return completion;
  }
  return {
    ...completion,
    kind: "operation",
    label: "complete selected expression",
    detail: "Completes the containing expression after one selected path supplies its value.",
    confidence: "exact"
  };
}

/** Matches language-adapter de-duplication for changes moved into branch leaves. */
function createValueChangeKey(change: FunctionLogicValueChange): string {
  return [
    change.target,
    change.targetKind,
    change.operation,
    change.operator,
    change.value ?? "",
    change.confidence
  ].join("\0");
}

/** Keeps stable edge identities unique after multiple sequential rewrites. */
function deduplicateEdges(edges: FunctionLogicEdge[]): FunctionLogicEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (seen.has(edge.id)) {
      return false;
    }
    seen.add(edge.id);
    return true;
  });
}
