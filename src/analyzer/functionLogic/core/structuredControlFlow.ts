/**
 * Language-neutral structured control-flow builder. Language adapters classify
 * statements and describe child containers; this module owns iterative CFG
 * continuation, loop control, finally routing, and deterministic edge identity.
 */

import type {
  FunctionLogicBlock,
  FunctionLogicConfidence,
  FunctionLogicEdge,
  FunctionLogicEdgeKind
} from "../types";
import { createFunctionLogicEdge } from "./functionLogicSupport";

/** Structural role of a statement container owned by a control block. */
export type ContainerRole =
  | "root"
  | "then"
  | "else"
  | "loopBody"
  | "case"
  | "tryBody"
  | "catch"
  | "finally";

/** One ordered statement region used while constructing structured flow. */
export type LogicContainer = {
  id: string;
  role: ContainerRole;
  ownerBlockId?: string;
  parentContainerId?: string;
  label?: string;
};

/** Domain block augmented with its private structural container identity. */
export type InternalBlock = FunctionLogicBlock & {
  containerId: string;
};

/** One outgoing structured branch owned by a control block. */
export type ControlBranch = {
  containerId: string;
  edgeKind: FunctionLogicEdgeKind;
  label?: string;
};

/** Branch metadata retained until all statement blocks have been scheduled. */
export type ControlRecord = {
  kind: "condition" | "loop" | "switch" | "try";
  branches: ControlBranch[];
  /** Optional uncertainty inherited by structural choice/repeat/exit edges. */
  confidence?: FunctionLogicConfidence;
  hasDefaultBranch?: boolean;
  finallyContainerId?: string;
};

/** Inputs retained while direct statement order becomes control-flow edges. */
export type ControlFlowBuildInput = {
  entryBlock: FunctionLogicBlock;
  exitBlock: FunctionLogicBlock;
  visibleBlocks: InternalBlock[];
  blocksById: Map<string, InternalBlock>;
  containers: Map<string, LogicContainer>;
  controlsByBlockId: Map<string, ControlRecord>;
  directBlockIdsByContainer: Map<string, string[]>;
  rootContainerId: string;
};

/** Converts direct-container order and control metadata into a bounded CFG. */
export function createStructuredControlEdges(
  input: ControlFlowBuildInput
): FunctionLogicEdge[] {
  const edges: FunctionLogicEdge[] = [];
  const edgeKeys = new Set<string>();
  const firstRoot = input.directBlockIdsByContainer.get(input.rootContainerId)?.[0];
  addEdge(
    edges,
    edgeKeys,
    input.entryBlock.id,
    firstRoot ?? input.exitBlock.id,
    "next",
    undefined,
    "exact"
  );

  for (const block of input.visibleBlocks) {
    const control = input.controlsByBlockId.get(block.id);
    if (control) {
      appendControlEdges(block, control, input, edges, edgeKeys);
      continue;
    }

    if (block.kind === "return" || block.kind === "throw") {
      addEdge(edges, edgeKeys, block.id, input.exitBlock.id, block.kind, block.kind, "exact");
      continue;
    }
    if (block.kind === "break" || block.kind === "continue") {
      const target = findLoopControlTarget(block, block.kind, input);
      addEdge(
        edges,
        edgeKeys,
        block.id,
        target ?? input.exitBlock.id,
        block.kind,
        block.kind,
        target ? "exact" : "inferred"
      );
      continue;
    }

    const transfer = findContinuation(block.id, input);
    addEdge(
      edges,
      edgeKeys,
      block.id,
      transfer.targetId,
      transfer.kind,
      transfer.kind === "repeat" ? "repeat" : undefined,
      transfer.confidence
    );
  }

  return edges;
}

/** Appends one direct statement identity to its structural container. */
export function appendDirectBlock(
  byContainer: Map<string, string[]>,
  containerId: string,
  blockId: string
): void {
  const values = byContainer.get(containerId) ?? [];
  values.push(blockId);
  byContainer.set(containerId, values);
}

/** Adds outgoing transfers for a condition, loop, switch, or try statement. */
function appendControlEdges(
  block: InternalBlock,
  control: ControlRecord,
  input: ControlFlowBuildInput,
  edges: FunctionLogicEdge[],
  edgeKeys: Set<string>
): void {
  const continuation = findContinuation(block.id, input).targetId;
  const controlConfidence = control.confidence ?? "exact";
  const finallyEntry = control.finallyContainerId
    ? input.directBlockIdsByContainer.get(control.finallyContainerId)?.[0]
    : undefined;

  for (const branch of control.branches) {
    // finally is a continuation of try/catch paths, not a sibling choice made
    // when entering the try statement.
    if (branch.containerId === control.finallyContainerId) {
      continue;
    }
    const first = input.directBlockIdsByContainer.get(branch.containerId)?.[0];
    if (first) {
      addEdge(
        edges,
        edgeKeys,
        block.id,
        first,
        branch.edgeKind,
        branch.label,
        branch.edgeKind === "exception" ? "inferred" : controlConfidence
      );
    } else if (branch.edgeKind !== "exception") {
      const emptyBranchContinuation = control.kind === "try"
        ? finallyEntry ?? continuation
        : continuation;
      addEdge(
        edges,
        edgeKeys,
        block.id,
        emptyBranchContinuation,
        branch.edgeKind,
        branch.label,
        controlConfidence
      );
    }
  }

  if (control.kind === "condition"
    && !control.branches.some((branch) => branch.edgeKind === "false")) {
    addEdge(edges, edgeKeys, block.id, continuation, "false", "false", controlConfidence);
  }
  if (control.kind === "loop"
    && !control.branches.some((branch) => branch.edgeKind === "exit")) {
    addEdge(edges, edgeKeys, block.id, continuation, "exit", "exit loop", controlConfidence);
  }
  if (control.kind === "switch" && !control.hasDefaultBranch) {
    addEdge(
      edges,
      edgeKeys,
      block.id,
      continuation,
      "exit",
      "no case matched",
      controlConfidence
    );
  }
}

/** Finds the next source block, climbing structured containers iteratively. */
function findContinuation(
  blockId: string,
  input: ControlFlowBuildInput
): {
  targetId: string;
  kind: "next" | "repeat";
  confidence: FunctionLogicConfidence;
} {
  let currentBlock = input.blocksById.get(blockId);

  while (currentBlock) {
    const siblings = input.directBlockIdsByContainer.get(currentBlock.containerId) ?? [];
    const index = siblings.indexOf(currentBlock.id);
    if (index >= 0 && index + 1 < siblings.length) {
      return { targetId: siblings[index + 1], kind: "next", confidence: "exact" };
    }

    const container = input.containers.get(currentBlock.containerId);
    if (!container?.ownerBlockId) {
      return { targetId: input.exitBlock.id, kind: "next", confidence: "exact" };
    }
    const owner = input.blocksById.get(container.ownerBlockId);
    if (!owner) {
      return { targetId: input.exitBlock.id, kind: "next", confidence: "exact" };
    }
    const ownerControl = input.controlsByBlockId.get(owner.id);
    if (container.role === "loopBody") {
      return {
        targetId: owner.id,
        kind: "repeat",
        confidence: ownerControl?.confidence ?? "exact"
      };
    }
    if (ownerControl?.kind === "try"
      && container.role !== "finally"
      && ownerControl.finallyContainerId) {
      const firstFinally = input.directBlockIdsByContainer
        .get(ownerControl.finallyContainerId)?.[0];
      if (firstFinally) {
        return { targetId: firstFinally, kind: "next", confidence: "exact" };
      }
    }
    currentBlock = owner;
  }

  return { targetId: input.exitBlock.id, kind: "next", confidence: "exact" };
}

/** Resolves break/continue to the nearest loop or switch without recursion. */
function findLoopControlTarget(
  block: InternalBlock,
  kind: "break" | "continue",
  input: ControlFlowBuildInput
): string | undefined {
  let container = input.containers.get(block.containerId);

  while (container?.ownerBlockId) {
    const owner = input.blocksById.get(container.ownerBlockId);
    const control = owner ? input.controlsByBlockId.get(owner.id) : undefined;
    if (owner && control?.kind === "loop") {
      return kind === "continue" ? owner.id : findContinuation(owner.id, input).targetId;
    }
    if (owner && kind === "break" && control?.kind === "switch") {
      return findContinuation(owner.id, input).targetId;
    }
    container = owner ? input.containers.get(owner.containerId) : undefined;
  }
  return undefined;
}

/** Creates one control edge with deterministic de-duplication. */
function addEdge(
  edges: FunctionLogicEdge[],
  keys: Set<string>,
  sourceId: string,
  targetId: string,
  kind: FunctionLogicEdgeKind,
  label: string | undefined,
  confidence: FunctionLogicConfidence
): void {
  const key = `${sourceId}\0${targetId}\0${kind}\0${label ?? ""}`;
  if (keys.has(key)) {
    return;
  }
  keys.add(key);
  edges.push(createFunctionLogicEdge(sourceId, targetId, kind, label, confidence));
}
