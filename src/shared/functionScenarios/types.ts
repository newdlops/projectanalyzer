/** Portable execution-scenario contracts; identities may be source-owned or opaque browser tokens. */
export type FunctionScenarioCertainty = "exact" | "inferred" | "unknown";
/** JSON snapshots are bounded copies, never evaluator environments or mutable input objects. */
export type FunctionScenarioValue = null | boolean | number | string | FunctionScenarioValue[] | { [key: string]: FunctionScenarioValue };

export type FunctionScenarioGapCode = "missing-block" | "disconnected-route" | "deferred-boundary" | "path-limit"
  | "unknown-terminal" | "unresolved-call" | "unsupported-operation" | "unknown-value" | "value-limit" | "analysis-gap";

/** One ordered fact on an individual route, not a bag of all reachable source statements. */
export type FunctionScenarioStep = {
  id: string;
  ordinal: number;
  kind: "entry" | "decision" | "call" | "effect" | "write" | "statement" | "return" | "throw" | "exit";
  blockId: string;
  sourcePreview: string;
  certainty: FunctionScenarioCertainty;
  evidenceTokens: string[];
  targetName?: string;
  effectKind?: string;
  decision?: { edgeId: string; outcome: string; verification: "checked" | "assumed" };
  before?: FunctionScenarioValue;
  after?: FunctionScenarioValue;
};

/** Separates source structure, checked static values, assumptions, and incomplete analysis. */
export type FunctionExecutionScenario = {
  schema: 1;
  id: string;
  seedId: string;
  pathIndex: number;
  basis: "evaluated" | "symbolic";
  status: "complete" | "partial";
  certainty: FunctionScenarioCertainty;
  /** No scenario describes observed program or external-service execution. */
  observation: "static";
  inputs: Array<{ parameterId: string; name: string; typeText?: string; value: FunctionScenarioValue; omitted: boolean; certainty: FunctionScenarioCertainty }>;
  conditions: Array<{ blockId: string; edgeId: string; sourcePreview: string; outcome: string; verification: "checked" | "assumed"; evidenceTokens: string[] }>;
  steps: FunctionScenarioStep[];
  outcome: { kind: "return" | "throw" | "exit" | "unknown"; blockId?: string; sourcePreview?: string; value?: FunctionScenarioValue; evidenceTokens: string[] };
  assumptions: string[];
  gaps: Array<{ code: FunctionScenarioGapCode; blockId?: string; sourcePreview?: string; evidenceTokens: string[] }>;
  graph: { blockIds: string[]; edgeIds: string[] };
  /** Display omissions do not imply that a known terminal failed to complete. */
  omittedCounts: { inputs: number; conditions: number; steps: number; gaps: number };
  analysisLimited: boolean;
};

/** Collection coverage reports checked choices only; source enumeration is never exhaustive. */
export type FunctionExecutionScenarioCatalog = {
  schema: 1;
  scenarios: FunctionExecutionScenario[];
  representativeIds: string[];
  coverage: {
    modeledScenarioCount: number;
    omittedScenarioCount: number;
    sourceDecisionCount: number;
    checkedDecisionCount: number;
    analysisLimited: boolean;
    exhaustive: false;
  };
};

/** Minimal language-neutral facts accepted from a projected Tutor or a pure caller. */
export type FunctionScenarioModelInput = {
  parameters?: readonly { id: string; name: string; typeText?: string }[];
  program?: {
    evaluationMode?: string;
    entryBlockId: string;
    blocks: readonly FunctionScenarioSourceBlock[];
    edges: readonly { edgeId: string; sourceBlockId: string; targetBlockId: string; kind: string; certainty?: string }[];
    bindings?: readonly { bindingId: string; name: string }[];
    gapIds?: readonly string[];
  };
  behaviorSummary?: {
    impacts?: readonly { id?: string; kind: string; sourcePreview: string; certainty?: string; blockIds: readonly string[]; evidenceTokens?: readonly string[] }[];
  };
};

export type FunctionScenarioSourceBlock = {
  blockId: string;
  kind: string;
  label?: string;
  operations?: readonly {
    kind: string;
    bindingId?: string;
    target?: { bindingId: string; path?: readonly string[]; segments?: readonly ({ kind: "static"; key: string } | { kind: "binding"; bindingId: string })[] };
    effectKind?: string;
    summary?: string;
    certainty?: string;
    reason?: string;
    value?: unknown;
  }[];
  terminal?: { kind: string; continuationId?: string };
  embeddedRelation?: string;
  evidenceTokens?: readonly string[];
};

/** A Workspace row retains its navigation identity; model creation performs no evaluation. */
export type FunctionScenarioModelRow = {
  seed: {
    id: string;
    certainty?: string;
    inputs?: readonly { parameterId: string; value: unknown; omitted?: boolean; certainty?: string }[];
    gapIds?: readonly string[];
    quality?: { assumptions?: readonly string[]; checkedEdgeIds?: readonly string[]; status?: string; gapReason?: string };
  };
  pathIndex: number;
  path?: {
    symbolic?: boolean;
    limited?: boolean;
    partial?: boolean;
    certainty?: string;
    blockIds?: readonly string[];
    edgeIds?: readonly string[];
    transitions?: readonly FunctionScenarioTransition[];
    frames?: readonly { blockId: string; transitions?: readonly FunctionScenarioTransition[]; selectedEdgeId?: string }[];
    occurrences?: readonly { blockId: string; transitions?: readonly FunctionScenarioTransition[]; selectedEdgeId?: string }[];
    terminal?: { kind: string; blockId?: string; value?: unknown; reason?: string };
    gaps?: readonly unknown[];
    scenario?: {
      concrete?: boolean;
      decisions?: readonly { blockId: string; edgeId: string; label?: string; outcome: string }[];
      effects?: readonly { blockId: string; kind: string; label: string }[];
    };
  };
};

export type FunctionScenarioTransition = {
  blockId: string;
  kind?: string;
  targetBindingId?: string;
  target?: string;
  targetName?: string;
  before?: unknown;
  after?: unknown;
  certainty?: string;
};

/** Hard bounds protect both command-line callers and emitted Webview code. */
export type FunctionScenarioModelOptions = { maxDepth?: number; maxSteps?: number; maxScenarios?: number; maxRepresentatives?: number };
