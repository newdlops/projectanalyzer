/** Portable, bounded descriptions of hypothetical behavior; these are never execution observations. */

/** Model references are relative to supplied snippets and use one-based source line numbers. */
export type FunctionNarrativeSource = { snippetId: string; startLine: number; endLine: number };
export type FunctionNarrativeStep = {
  text: string;
  /** Explains the actual language expression/operator, separately from this input's result. */
  syntax?: string;
  /** Exact supplied source expression, verified before binding to a node; absent in older responses. */
  code?: string;
  /** Optional for cached responses from earlier versions; current prompts request both fields. */
  reason?: string;
  effect?: string;
  source: FunctionNarrativeSource;
  /** Hypothetical JSON values from a model or closed source substitution, never runtime observations. */
  values?: Array<{ name: string; before: string; after: string }>;
};
/** JSON text keeps model inputs portable without evaluating expressions or constructing user objects. */
export type FunctionNarrativeExample = { inputs: Array<{ name: string; json: string }>; result: string };
/** The Host binds the model's ordered descriptions to snapshot-owned opaque graph nodes. */
export type FunctionNarrativeNodeDetail = FunctionNarrativeStep & { nodeId: string; occurrence?: number };
export type FunctionNarrativeScenario = {
  title: string;
  when: string[];
  /** Connected reading paragraph, up to 1800 characters; optional for older cached responses. */
  explanation?: string;
  /** Source/model causal reading; this never asserts observed execution. */
  analysis?: { pathReason: string; stateChange: string; alternative: string };
  steps: FunctionNarrativeStep[];
  outcome: string;
  assumptions: string[];
  example?: FunctionNarrativeExample;
  /** Complete node explanations are retained in page storage; only the selected detail is expanded in UI. */
  nodeDetails?: FunctionNarrativeNodeDetail[];
  graph?: { nodeIds: string[]; edgeIds: string[] };
};
export type FunctionNarrative = {
  summary: string;
  scenarios: FunctionNarrativeScenario[];
  limitations: string[];
};

/** Source excerpts and syntax routes omit workspace paths and analyzer identities. */
export type FunctionNarrativeSnippet = {
  id: string;
  role: "function" | "nearby" | "helper" | "caller";
  startLine: number;
  endLine: number;
  text: string;
  truncated: boolean;
};
export type FunctionNarrativeContext = {
  functionName: string;
  language: string;
  /** Independent call-reading task using the same on-demand provider/process lifecycle. */
  callTask?: import("../functionCallNarratives").FunctionCallNarrativeTask;
  snippets: FunctionNarrativeSnippet[];
  /** Optional bounded syntax routes, not evaluated inputs or observed program execution. */
  sourceFlow?: FunctionNarrativeSourceFlow;
  /** Host-owned compact CFG for complete, lazy scenario enumeration; never sent wholesale to a model. */
  scenarioGraph?: FunctionNarrativeScenarioGraph;
  /** Offset of the source-owned scenarios in this bounded request; fixed frames apply even to partial/inferred paths. */
  scenarioBatch?: { offset: number };
  /** Syntax-backed value operations and complete static checks, never model-derived facts. */
  valueFacts?: FunctionNarrativeValueFact[];
  checkedExamples?: FunctionNarrativeCheckedExample[];
  /** Bounded fact selection is separate from an omitted source excerpt. */
  groundingLimited?: boolean;
  /** Declared names only, not parameter identities or user-entered values. Enables model examples. */
  parameters?: Array<{ name: string; type?: string }>;
  /** Explicit source annotation used only to constrain local JSON example results. */
  returnTypeText?: string;
  /** Host-owned names constrain node value labels to this function. */
  valueNames?: string[];
  /** The current production reading contract; absent on legacy callers/cached responses. */
  detailLevel?: "rich";
  /** Private node preparation never publishes its provisional paragraph/result. */
  nodePreparation?: boolean;
  /** Internal bounded node task; the original scenario/example is held fixed across chunks. */
  nodeTask?: { frame: { when: string[]; outcome: string }; example: FunctionNarrativeExample; targets: FunctionNarrativeFlowStep[];
    /** Previously validated model paragraph and at most eight recent model values, not static facts. */
    reading?: { explanation: string; priorState: Array<{ name: string; value: string }> } };
  /** Internal final synthesis uses completed node values; speculative primary prose is never carried forward. */
  summaryTask?: { inputs: FunctionNarrativeExample["inputs"]; steps: FunctionNarrativeStep[];
    /** Validated purpose from this same source snapshot/locale, never provisional preparation text. */
    knownFunctionSummary?: string;
    /** Host-selected nearby source route and typed inputs; source synthesis independently checks every operation again. */
    sourceAlternative?: { path: FunctionNarrativeFlowPath; inputs: FunctionNarrativeExample["inputs"] };
    resultJson?: string; completed: Array<{ code: string; predicateResult?: string; values: FunctionNarrativeStep["values"] }>;
    omittedValues: number };
  /** True only when source excerpts were omitted or truncated. */
  limited: boolean;
};

/** One visible statement on a syntax route, with the choice made at its source predicate. */
export type FunctionNarrativeFlowStep = {
  kind: string;
  code: string;
  source: FunctionNarrativeSource;
  confidence: "exact" | "inferred";
  /** Opaque browser identity; removed before sending any model prompt. */
  graphNodeId?: string;
  /** Position distinguishes repeated visits to a loop node; stripped with the graph identity. */
  graphOccurrence?: number;
  /** Analyzer-lowered predicate for source syntax such as Kotlin Elvis, never a model-authored expression. */
  loweredPredicate?: string;
  /** Exact local variable writes from analyzer annotations, excluding inferred receiver/property effects. */
  writeTargets?: string[];
  /** Choice describes this route only; feasibility for concrete inputs is not proved. */
  branch?: { outcome: string; confidence: "exact" | "inferred";
    /** A parser-proven direct required Boolean input can name the matching input value. */
    inputCondition?: string };
};

/** Source-terminal means the route ends at source return/throw/exit, never runtime verification. */
export type FunctionNarrativeFlowPath = {
  status: "source-terminal" | "partial";
  /** Aggregate syntax confidence, including ordinary control-transfer edges. */
  confidence: "exact" | "inferred";
  steps: FunctionNarrativeFlowStep[];
  reason?: "cycle" | "depth-limit" | "missing-source" | "missing-block" | "control-gap";
  /** Host-only route identities are never model-authored. */
  graph?: { nodeIds: string[]; edgeIds: string[] };
};

/** Small model-readable route projection; limits and uncertain syntax remain explicit. */
export type FunctionNarrativeSourceFlow = {
  basis: "source-control-flow";
  paths: FunctionNarrativeFlowPath[];
  limited: boolean;
};

/** Index-based snapshot adjacency avoids leaking analyzer identities or copying every path at registration. */
export type FunctionNarrativeScenarioGraph = {
  entry: number;
  nodes: Array<{
    kind: string;
    graphNodeId?: string;
    step?: FunctionNarrativeFlowStep;
    confidence: "exact" | "inferred";
    next: Array<{ target: number; outcome: string; confidence: "exact" | "inferred"; graphEdgeId?: string; inputCondition?: string }>;
  }>;
  limited: boolean;
};

/** Small named IR facts help distinguish fixed literals from invented business formulas. */
export type FunctionNarrativeValueFact = {
  target: string;
  operation: "conditional" | "add" | "subtract" | "multiply" | "divide" | "modulo";
  operands: string[];
  source: FunctionNarrativeSource;
};

/** Only complete primitive input/terminal checks are shared, without parameter/block identities. */
export type FunctionNarrativeCheckedExample = {
  basis: "static-evaluation";
  inputs: Array<{ name: string; value: string; omitted: boolean }>;
  decisions: Array<{ expression: string; outcome: string; source: FunctionNarrativeSource }>;
  sources: FunctionNarrativeSource[];
  terminal: { kind: string; value: string; source: FunctionNarrativeSource };
};
