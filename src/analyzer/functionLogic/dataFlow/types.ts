/**
 * Language-neutral Function Logic value-flow contracts. Language collectors
 * emit source facts, while the shared projector maps them onto bounded CFG
 * blocks and computes possible reaching-definition relationships.
 */

import type { SourceRange } from "../../../shared/types";
/** Lexical binding categories shown without guessing runtime types or values. */
export type FunctionLogicValueBindingKind = "parameter" | "local" | "constant";

/** Optional semantic role retained in addition to lexical declaration kind. */
export type FunctionLogicValueRole = "component";

/** Source-backed ways in which one visible block interacts with a binding. */
export type FunctionLogicValueAccessKind = "define" | "read" | "write" | "readwrite";

/**
 * Source-backed meaning of a read. `consume` keeps the value inside the
 * callable's computation, while `sink` passes it beyond the tracked lexical
 * flow through a return, throw, call argument, render, or external storage.
 */
export type FunctionLogicValueUsageKind = "consume" | "sink";

/** Parser-owned binding fact before its source range is mapped to a graph block. */
export type FunctionLogicValueBindingFact = {
  id: string;
  name: string;
  kind: FunctionLogicValueBindingKind;
  declarationRange: SourceRange;
  definitionPlacement: "entry" | "source";
  confidence: "exact" | "inferred";
  valueRole?: FunctionLogicValueRole;
};

/** Parser-owned read/write fact before its source range is mapped to a graph block. */
export type FunctionLogicValueAccessFact = {
  bindingId: string;
  access: Exclude<FunctionLogicValueAccessKind, "define">;
  usage?: FunctionLogicValueUsageKind;
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
  valueRole?: FunctionLogicValueRole;
};

/** One normalized binding access attached to a visible Function Logic block. */
export type FunctionLogicValueAccess = {
  bindingId: string;
  name: string;
  bindingKind: FunctionLogicValueBindingKind;
  access: FunctionLogicValueAccessKind;
  usage?: FunctionLogicValueUsageKind;
  confidence: "exact" | "inferred";
  valueRole?: FunctionLogicValueRole;
};

/** A possible static definition-to-use relation over the function CFG. */
export type FunctionLogicValueFlow = {
  id: string;
  bindingId: string;
  sourceBlockId: string;
  targetBlockId: string;
  targetAccess: "read" | "readwrite";
  targetUsage?: FunctionLogicValueUsageKind;
  confidence: "exact" | "inferred";
};

/** Complete parser facts supplied to the shared CFG data-flow projector. */
export type FunctionLogicValueFacts = {
  bindings: FunctionLogicValueBindingFact[];
  accesses: FunctionLogicValueAccessFact[];
  omittedBindingCount?: number;
  omittedAccessCount?: number;
};
