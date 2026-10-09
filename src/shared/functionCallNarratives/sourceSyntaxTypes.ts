/** Portable, parser-owned return syntax is evidence for model interpretation, never evaluated results or runtime reachability. */
import type { SourceRange } from "../types";

/** Exact authored callsite use; normal completion and actual returned values remain unobserved. */
export type FunctionCallResultUse = { kind: "return" | "binding" | "discard"; name?: string; awaited?: true };

/** Lexical region of a return statement; labels/expressions stay exactly source-authored. */
export type FunctionCallReturnRegion = {
  kind: "try" | "catch" | "finally" | "then" | "else" | "loop" | "case" | "control";
  expression?: string;
  label?: string;
};

/** Each source occurrence remains separate even when its return text equals another occurrence. */
export type FunctionCallReturnSite = {
  code: string;
  expression?: string;
  /** Zero-based editor source range, not an opaque graph identity or file path. */
  range: SourceRange;
  regions: FunctionCallReturnRegion[];
};

/** Partial evidence cannot establish a final result; even complete syntax does not prove execution, finally completion or side-call behavior. */
export type FunctionCallReturnSyntax = {
  sites: FunctionCallReturnSite[];
  limited: boolean;
  syntaxOnly: true;
};

/** Explicit source writes/calls in lexical order; not execution order, successful I/O or actual state/effect proof. */
export type FunctionCallEffectSite = {
  kind: "write" | "call"; code: string; range: SourceRange; regions: FunctionCallReturnRegion[];
};
export type FunctionCallEffectSyntax = { sites: FunctionCallEffectSite[]; limited: boolean; syntaxOnly: true };
