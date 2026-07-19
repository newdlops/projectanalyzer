/**
 * Shared internal contracts for the TypeScript/JavaScript function-logic
 * analyzer. These types connect syntax classification to CFG construction
 * without exposing compiler-specific details through the feature public API.
 */

import * as ts from "typescript";

/** Callable syntax node whose executable body is present in the source file. */
export type FunctionLikeWithBody = ts.FunctionLikeDeclaration & { body: ts.ConciseBody };

/** Iterative traversal work item for one visible function-body statement. */
export type PendingStatement = {
  node: ts.Statement;
  containerId: string;
  depth: number;
  branchLabel?: string;
};
