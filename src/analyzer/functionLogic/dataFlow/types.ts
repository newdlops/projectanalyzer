/**
 * Language-neutral Function Logic value-flow contracts. Language collectors
 * emit source facts, while the shared projector maps them onto bounded CFG
 * blocks and computes possible reaching-definition relationships.
 */

import type { SourceRange } from "../../../shared/types";
/** Lexical binding categories shown without guessing runtime types or values. */
export type FunctionLogicValueBindingKind = "parameter" | "local" | "constant";

/** Source-backed ways in which one visible block interacts with a binding. */
export type FunctionLogicValueAccessKind = "define" | "read" | "write" | "readwrite";

/** Parser-owned binding fact before its source range is mapped to a graph block. */
export type FunctionLogicValueBindingFact = {
  id: string;
  name: string;
  kind: FunctionLogicValueBindingKind;
  declarationRange: SourceRange;
  definitionPlacement: "entry" | "source";
  confidence: "exact" | "inferred";
};

/** Parser-owned read/write fact before its source range is mapped to a graph block. */
export type FunctionLogicValueAccessFact = {
  bindingId: string;
  access: Exclude<FunctionLogicValueAccessKind, "define">;
  range: SourceRange;
  confidence: "exact" | "inferred";
};

/** One tracked function-scoped binding with its visible definition block. */
export type FunctionLogicValueBinding = {
  id: string;
  name: string;
  kind: FunctionLogicValueBindingKind;
  definitionBlockId: string;
  confidence: "exact" | "inferred";
};

/** One normalized binding access attached to a visible Function Logic block. */
export type FunctionLogicValueAccess = {
  bindingId: string;
  name: string;
  bindingKind: FunctionLogicValueBindingKind;
  access: FunctionLogicValueAccessKind;
  confidence: "exact" | "inferred";
};

/** A possible static definition-to-use relation over the function CFG. */
export type FunctionLogicValueFlow = {
  id: string;
  bindingId: string;
  sourceBlockId: string;
  targetBlockId: string;
  targetAccess: "read" | "readwrite";
  confidence: "exact" | "inferred";
};

/** Complete parser facts supplied to the shared CFG data-flow projector. */
export type FunctionLogicValueFacts = {
  bindings: FunctionLogicValueBindingFact[];
  accesses: FunctionLogicValueAccessFact[];
  omittedBindingCount?: number;
  omittedAccessCount?: number;
};
