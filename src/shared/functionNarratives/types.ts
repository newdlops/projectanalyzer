/** Portable, bounded descriptions of hypothetical behavior; these are never execution observations. */

/** Model references are relative to supplied snippets and use one-based source line numbers. */
export type FunctionNarrativeSource = { snippetId: string; startLine: number; endLine: number };
export type FunctionNarrativeStep = {
  text: string;
  /** Optional for cached responses from earlier versions; current prompts request both fields. */
  reason?: string;
  effect?: string;
  source: FunctionNarrativeSource;
};
export type FunctionNarrativeScenario = {
  title: string;
  when: string[];
  /** Connected reading paragraph, up to 1800 characters; optional for older cached responses. */
  explanation?: string;
  steps: FunctionNarrativeStep[];
  outcome: string;
  assumptions: string[];
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
  snippets: FunctionNarrativeSnippet[];
  /** Optional bounded syntax routes, not evaluated inputs or observed program execution. */
  sourceFlow?: FunctionNarrativeSourceFlow;
  /** Syntax-backed value operations and complete static checks, never model-derived facts. */
  valueFacts?: FunctionNarrativeValueFact[];
  checkedExamples?: FunctionNarrativeCheckedExample[];
  /** Bounded fact selection is separate from an omitted source excerpt. */
  groundingLimited?: boolean;
  /** True only when source excerpts were omitted or truncated. */
  limited: boolean;
};

/** One visible statement on a syntax route, with the choice made at its source predicate. */
export type FunctionNarrativeFlowStep = {
  kind: string;
  code: string;
  source: FunctionNarrativeSource;
  confidence: "exact" | "inferred";
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
};

/** Small model-readable route projection; limits and uncertain syntax remain explicit. */
export type FunctionNarrativeSourceFlow = {
  basis: "source-control-flow";
  paths: FunctionNarrativeFlowPath[];
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
