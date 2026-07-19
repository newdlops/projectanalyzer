/**
 * Shared internal contracts for the TypeScript/JavaScript function-logic
 * analyzer. These types connect syntax classification to CFG construction
 * without exposing compiler-specific details through the feature public API.
 */

import * as ts from "typescript";
import type {
  FunctionLogicBlock,
  FunctionLogicEdgeKind
} from "./types";

/** Callable syntax node whose executable body is present in the source file. */
export type FunctionLikeWithBody = ts.FunctionLikeDeclaration & { body: ts.ConciseBody };

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

/** Iterative traversal work item for one visible function-body statement. */
export type PendingStatement = {
  node: ts.Statement;
  containerId: string;
  depth: number;
  branchLabel?: string;
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
  hasDefaultBranch?: boolean;
  finallyContainerId?: string;
};
