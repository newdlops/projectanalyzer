/**
 * Pure static-function-tutor contracts. These analyzer-side records retain
 * source identities and never contain Webview tokens or VS Code APIs.
 */

import type { GraphEdge, SourceRange, SymbolNode } from "../../shared/types";
import type {
  FunctionLogicAnalysis,
  FunctionLogicBlockKind,
  FunctionLogicEdgeKind
} from "../functionLogic";
import type { FunctionTutorScenarioCatalog } from "./scenario/types";
import type { PythonScenarioProgram } from "../../shared/pythonScenario";

/** JSON-safe bounded values understood by the Tutor interpreter. */
export type FunctionTutorStaticValue =
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "null" }
  | { kind: "undefined" }
  | { kind: "array"; items: FunctionTutorStaticValue[]; truncated: boolean }
  | { kind: "object"; entries: FunctionTutorObjectEntry[]; truncated: boolean }
  | { kind: "enum"; typeName?: string; memberName: string }
  | { kind: "unknown"; reason: FunctionTutorUnknownReason; detail?: string };

/** One own-property entry. Prototype-sensitive keys are rejected at creation. */
export type FunctionTutorObjectEntry = {
  key: string;
  value: FunctionTutorStaticValue;
};

/** Why static analysis intentionally leaves a value unresolved. */
export type FunctionTutorUnknownReason =
  | "dynamic-call"
  | "unsupported-expression"
  | "unsupported-type"
  | "missing-source"
  | "ambiguous-binding"
  | "alias-budget"
  | "depth-budget"
  | "value-budget"
  | "loop-budget"
  | "path-budget"
  | "external-state"
  | "language-gap"
  | "not-inferred";

/** Syntax proved literal/default facts are separate from conservative guesses. */
export type FunctionTutorCertainty = "exact" | "inferred" | "unknown";

/** Source-backed reason for one candidate, constraint, or gap. */
export type FunctionTutorEvidence = {
  kind:
    | "parameter-type"
    | "parameter-default"
    | "literal-union"
    | "enum-member"
    | "callsite-argument"
    | "branch-constraint"
    | "type-representative"
    | "embedded-code"
    | "source-documentation"
    | "source-owner"
    | "architecture-layer"
    | "semantic-entrypoint"
    | "direct-caller"
    | "direct-callee"
    | "value-change"
    | "effect-boundary"
    | "terminal"
    | "fallback";
  certainty: FunctionTutorCertainty;
  filePath: string;
  range: SourceRange;
  summary: string;
};

/** One bounded source-authored documentation claim attached to a callable. */
export type FunctionTutorDocumentationKind =
  | "jsdoc"
  | "docstring"
  | "javadoc"
  | "xml-doc"
  | "elixir-doc"
  | "comment";

/** A small documentation tag that can clarify an input or outcome without HTML rendering. */
export type FunctionTutorDocumentationTag = {
  kind: "parameter" | "returns" | "throws" | "remarks";
  parameterName?: string;
  text: string;
};

/** Normalized documentation text and exact source evidence retained for Function Guide. */
export type FunctionTutorDocumentationFact = {
  kind: FunctionTutorDocumentationKind;
  summary: string;
  tags: FunctionTutorDocumentationTag[];
  truncated: boolean;
  evidence: FunctionTutorEvidence[];
};

/** Broad type category used for bounded candidate construction. */
export type FunctionTutorParameterTypeKind =
  | "boolean"
  | "number"
  | "string"
  | "null"
  | "undefined"
  | "literal-union"
  | "enum"
  | "array"
  | "tuple"
  | "object"
  | "callable"
  | "unknown";

/** Direct member metadata for a destructured or object-typed parameter. */
export type FunctionTutorMemberFact = {
  path: string[];
  typeKind: FunctionTutorParameterTypeKind;
  optional: boolean;
  literalValues: FunctionTutorStaticValue[];
};

/** One callable input read from declaration syntax. */
export type FunctionTutorParameterFact = {
  id: string;
  bindingId?: string;
  name: string;
  index: number;
  callingMode: "positional" | "positional-only" | "keyword-only" | "rest-positional" | "rest-keyword";
  typeKind: FunctionTutorParameterTypeKind;
  typeText?: string;
  optional: boolean;
  rest: boolean;
  defaultValue?: FunctionTutorStaticValue;
  literalValues: FunctionTutorStaticValue[];
  /** Same-file, bounded declared-shape example; it is never a runtime observation. */
  typeRepresentative?: FunctionTutorStaticValue;
  memberFacts: FunctionTutorMemberFact[];
  declarationEvidence: FunctionTutorEvidence[];
  gaps: FunctionTutorGap[];
};

/** Normalized expression passed to the browser rather than source text. */
export type FunctionTutorExpression =
  | { kind: "literal"; value: FunctionTutorStaticValue }
  | { kind: "binding"; bindingId: string }
  /** Opaque Host-owned class/object receiver; projection never includes its source name. */
  | { kind: "owner-reference"; ownerId: string }
  | { kind: "member"; object: FunctionTutorExpression; path: string[]; optional: boolean }
  | { kind: "unary"; operator: "not" | "plus" | "minus" | "typeof" | "non-nullish"; operand: FunctionTutorExpression }
  | {
      kind: "binary";
      operator: "eq" | "neq" | "strict-eq" | "strict-neq" | "lt" | "lte" | "gt" | "gte"
        | "add" | "subtract" | "multiply" | "divide" | "modulo" | "in";
      left: FunctionTutorExpression;
      right: FunctionTutorExpression;
    }
  | { kind: "logical"; operator: "and" | "or" | "nullish"; members: FunctionTutorExpression[] }
  | { kind: "conditional"; condition: FunctionTutorExpression; whenTrue: FunctionTutorExpression; whenFalse: FunctionTutorExpression }
  | { kind: "array"; items: FunctionTutorExpression[] }
  | { kind: "object"; entries: Array<{ key: string; value: FunctionTutorExpression }> }
  /** Await is explicit: async programs are never entered by a bare call. */
  | { kind: "await"; operand: FunctionTutorExpression }
  /** A parser-range-backed invocation. Resolution and receiver identity are Host work. */
  | {
      kind: "direct-call";
      calleeName: string;
      arguments: FunctionTutorExpression[];
      callRange: SourceRange;
      certainty: FunctionTutorCertainty;
      invocationKind?: "direct" | "method" | "optional-direct" | "optional-method" | "iterator-next";
      receiver?: FunctionTutorExpression;
      optionalDisposition?: "present" | "absent" | "unknown";
      requiresAwait?: boolean;
    }
  | { kind: "construct"; className: string; arguments: FunctionTutorExpression[]; callRange: SourceRange; certainty: FunctionTutorCertainty }
  | { kind: "unsupported"; reason: FunctionTutorUnknownReason; summary: string };

/** Direct predicate on one parameter or its bounded own-member path. */
export type FunctionTutorConstraint = {
  id: string;
  blockId: string;
  parameterId: string;
  memberPath: string[];
  operator: "truthy" | "falsy" | "eq" | "neq" | "lt" | "lte" | "gt" | "gte"
    | "nullish" | "non-nullish" | "length-eq" | "length-lt" | "length-lte" | "length-gt" | "length-gte";
  operand?: FunctionTutorStaticValue;
  certainty: FunctionTutorCertainty;
  evidence: FunctionTutorEvidence[];
};

/** One source-level write target handled by the bounded interpreter. */
export type FunctionTutorAssignmentTarget =
  | { kind: "binding"; bindingId: string }
  | { kind: "member"; bindingId: string; path: string[]; segments?: Array<{ kind: "static"; key: string } | { kind: "binding"; bindingId: string }> };

/** A source-ordered static operation attached to one Function Logic block. */
export type FunctionTutorOperation =
  | { kind: "define"; bindingId: string; value: FunctionTutorExpression }
  | {
      kind: "assign";
      target: FunctionTutorAssignmentTarget;
      value: FunctionTutorExpression;
      operator: "set" | "add" | "subtract" | "multiply" | "divide";
    }
  | { kind: "increment"; target: FunctionTutorAssignmentTarget; delta: 1 | -1 }
  | { kind: "delete"; target: FunctionTutorAssignmentTarget }
  | { kind: "effect"; effectKind: "call" | "render" | "event" | "external-write" | "yield"; summary: string; certainty: FunctionTutorCertainty }
  | { kind: "unsupported"; summary: string; reason: FunctionTutorUnknownReason };

/** An analyzer-visible decision and its already-constructed control edges. */
export type FunctionTutorDecision = {
  expression: FunctionTutorExpression;
  /** Host-only join to a source-proven logical-return continuation. */
  continuationId?: string;
  outcomes: Array<{
    edgeId: string;
    label: string;
    matches: "true" | "false" | "case" | "default" | "exception" | "loop-exit";
  }>;
};

/** Terminal source statement attached to a static block. */
export type FunctionTutorTerminal =
  | { kind: "return"; value?: FunctionTutorExpression; continuationId?: string }
  | { kind: "throw"; value?: FunctionTutorExpression }
  | { kind: "break" }
  | { kind: "continue" }
  | { kind: "exit" };

/** Browser-independent program assembled from one Function Logic analysis. */
export type FunctionTutorProgram = {
  python?: PythonScenarioProgram;
  entryBlockId: string;
  blocks: FunctionTutorProgramBlock[];
  edges: FunctionTutorProgramEdge[];
  bindings: FunctionTutorProgramBinding[];
  gaps: FunctionTutorGap[];
  /** Ordered sync-generator suspension values, retained without source text. */
  generatorYields?: FunctionTutorExpression[];
  generatorReturn?: FunctionTutorExpression;
  /** A bounded select/supply hand-off for a top-level logical return. */
  continuations?: FunctionTutorLogicalReturnContinuation[];
};

export type FunctionTutorLogicalReturnContinuation = {
  id: string;
  predicate: "truthy" | "non-nullish";
  select: FunctionTutorExpression;
  supply: FunctionTutorExpression;
  decisionBlockId: string;
  supplyBlockId: string;
  returnBlockId: string;
};

export type FunctionTutorProgramBlock = {
  blockId: string;
  kind: FunctionLogicBlockKind;
  label: string;
  operations: FunctionTutorOperation[];
  decision?: FunctionTutorDecision;
  terminal?: FunctionTutorTerminal;
  /** The right operand is evaluated only if this existing CFG block is reached. */
  continuationSupplyId?: string;
  embeddedRelation?: "immediate" | "defines" | "deferred";
  evidence: FunctionTutorEvidence[];
};

export type FunctionTutorProgramEdge = {
  edgeId: string;
  sourceBlockId: string;
  targetBlockId: string;
  kind: FunctionLogicEdgeKind;
  label?: string;
  certainty: FunctionTutorCertainty;
};

export type FunctionTutorProgramBinding = {
  bindingId: string;
  parameterId?: string;
  name: string;
  kind: "parameter" | "local" | "constant";
  certainty: FunctionTutorCertainty;
};

/** A limitation intentionally delivered alongside useful partial analysis. */
export type FunctionTutorGap = {
  kind:
    | "unsupported-parameter"
    | "unsupported-expression"
    | "unresolved-callsite"
    | "dynamic-argument"
    | "ambiguous-overload"
    | "alias-budget"
    | "condition-budget"
    | "value-budget"
    | "scenario-budget"
    | "path-budget"
    | "loop-budget"
    | "context-budget"
    | "embedded-boundary"
    | "missing-source"
    | "language-support";
  summary: string;
  parameterId?: string;
  blockId?: string;
  evidence?: FunctionTutorEvidence[];
};

/** Static declaration result. Callsite and scenario planning remain application work. */
export type FunctionTutorDeclarationAnalysis = {
  functionNode: SymbolNode;
  language: string;
  executionKind: "sync" | "async" | "generator" | "async-generator";
  parameters: FunctionTutorParameterFact[];
  constraints: FunctionTutorConstraint[];
  program: FunctionTutorProgram;
  gaps: FunctionTutorGap[];
  documentation?: FunctionTutorDocumentationFact;
  /** Host-only exact lexical callable catalog; it is never protocol-projected. */
  scenarioCatalog?: FunctionTutorScenarioCatalog;
};

/** Host-provided caller context passed to one language-specific extractor. */
export type FunctionTutorCallsiteInput = {
  targetFunction: SymbolNode;
  callerFilePath: string;
  callerSourceText: string;
  callEdge: GraphEdge;
  parameters: FunctionTutorParameterFact[];
};

/** One complete argument tuple. Inputs from different calls never mix. */
export type FunctionTutorCallsiteTuple = {
  id: string;
  arguments: Array<{
    parameterId: string;
    value: FunctionTutorStaticValue;
    omitted: boolean;
    certainty: FunctionTutorCertainty;
    evidence: FunctionTutorEvidence[];
  }>;
  certainty: FunctionTutorCertainty;
  evidence: FunctionTutorEvidence[];
};

/** Public input for the pure declaration analyzer. */
export type FunctionTutorDeclarationInput = {
  functionNode: SymbolNode;
  sourceText?: string;
  functionLogic: FunctionLogicAnalysis;
};
