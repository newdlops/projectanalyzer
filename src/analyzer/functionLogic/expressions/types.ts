/**
 * Public contracts for TypeScript/JavaScript expression-level Function Logic.
 * The planner owns syntax fragments while the expander alone mutates a CFG.
 */

import type * as ts from "typescript";
import type {
  FunctionLogicBlock,
  FunctionLogicEdge,
  FunctionLogicEdgeKind
} from "../types";

/** Evaluation role requested by the containing statement or control header. */
export type TypeScriptExpressionFlowMode = "boolean" | "value";

/** One statement block whose outer expression can be expanded safely. */
export type TypeScriptExpressionFlowRequest = {
  anchorBlockId: string;
  expression: ts.Expression;
  mode: TypeScriptExpressionFlowMode;
};

/** An unresolved fragment exit connected by the containing CFG expander. */
export type TypeScriptExpressionFlowExit = {
  sourceId: string;
  kind: Extract<FunctionLogicEdgeKind, "next" | "true" | "false">;
  label?: string;
};

/** A value expression has one or more normal/selected-result exits. */
export type TypeScriptValueExpressionFlowFragment = {
  mode: "value";
  entryBlockId: string;
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  exits: TypeScriptExpressionFlowExit[];
};

/** A boolean expression retains separate truthy and falsy short-circuit exits. */
export type TypeScriptBooleanExpressionFlowFragment = {
  mode: "boolean";
  entryBlockId: string;
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  truthyExits: TypeScriptExpressionFlowExit[];
  falsyExits: TypeScriptExpressionFlowExit[];
};

/** Planner result reports bounded omissions without emitting partial semantics. */
export type TypeScriptExpressionFlowPlan = {
  fragment?: TypeScriptValueExpressionFlowFragment
    | TypeScriptBooleanExpressionFlowFragment;
  omittedRegionCount: number;
};

