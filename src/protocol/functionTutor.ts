/**
 * JSON-only Function Guide contracts. Analyzer ranges and file paths are replaced
 * by existing snapshot-local evidence tokens before reaching the Webview.
 */

import type {
  CodeFlowEvidenceToken,
  FunctionLogicBlockPayloadKind,
  FunctionLogicEdgePayloadKind
} from "./functionLogic";
import type { FunctionTutorFactPresentationKey, FunctionTutorGapPresentationKey, FunctionTutorSemanticPresentationKey, PresentationParams } from "../localization/presentationDescriptors";

import type { FunctionFrameworkBehaviorPayload } from "./frameworkBehavior";

export type FunctionTutorPayloadCertainty = "exact" | "inferred" | "unknown";
export type FunctionTutorStaticValuePayload =
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "null" }
  | { kind: "undefined" }
  | { kind: "array"; items: FunctionTutorStaticValuePayload[]; truncated: boolean }
  | { kind: "object"; entries: Array<{ key: string; value: FunctionTutorStaticValuePayload }>; truncated: boolean }
  | { kind: "enum"; typeName?: string; memberName: string }
  | { kind: "unknown"; reason: string; detail?: string };

export type FunctionTutorExpressionPayload =
  | { kind: "literal"; value: FunctionTutorStaticValuePayload }
  | { kind: "binding"; bindingId: string }
  | { kind: "member"; object: FunctionTutorExpressionPayload; path: string[]; optional: boolean }
  | { kind: "unary"; operator: "not" | "plus" | "minus" | "typeof" | "non-nullish"; operand: FunctionTutorExpressionPayload }
  | { kind: "binary"; operator: string; left: FunctionTutorExpressionPayload; right: FunctionTutorExpressionPayload }
  | { kind: "logical"; operator: "and" | "or" | "nullish"; members: FunctionTutorExpressionPayload[] }
  | { kind: "conditional"; condition: FunctionTutorExpressionPayload; whenTrue: FunctionTutorExpressionPayload; whenFalse: FunctionTutorExpressionPayload }
  | { kind: "array"; items: FunctionTutorExpressionPayload[] }
  | { kind: "object"; entries: Array<{ key: string; value: FunctionTutorExpressionPayload }> }
  | { kind: "await"; operand: FunctionTutorExpressionPayload }
  /** Call target selection is Host-owned; this name is display-only compatibility data. */
  | {
      kind: "direct-call"; calleeName: string; arguments: FunctionTutorExpressionPayload[];
      certainty: FunctionTutorPayloadCertainty; callId?: string; calleeProgramId?: string;
      invocationKind?: "direct" | "method" | "optional-direct" | "optional-method" | "iterator-next";
      receiver?: FunctionTutorExpressionPayload;
      /** Host-proven presence prevents argument evaluation when absent. */
      optionalDisposition?: "present" | "absent" | "unknown";
      requiresAwait?: boolean;
      ownerId?: string;
    }
  | { kind: "construct"; className: string; arguments: FunctionTutorExpressionPayload[]; certainty: FunctionTutorPayloadCertainty; callId?: string }
  | { kind: "unsupported"; reason: string; summary: string };

export type FunctionTutorOperationPayload =
  | { kind: "define"; bindingId: string; value: FunctionTutorExpressionPayload }
  | { kind: "assign"; target: { kind: "binding" | "member"; bindingId: string; path?: string[]; segments?: Array<{ kind: "static"; key: string } | { kind: "binding"; bindingId: string }> }; value: FunctionTutorExpressionPayload; operator: "set" | "add" | "subtract" | "multiply" | "divide" }
  | { kind: "increment"; target: { kind: "binding" | "member"; bindingId: string; path?: string[]; segments?: Array<{ kind: "static"; key: string } | { kind: "binding"; bindingId: string }> }; delta: 1 | -1 }
  | { kind: "delete"; target: { kind: "binding" | "member"; bindingId: string; path?: string[]; segments?: Array<{ kind: "static"; key: string } | { kind: "binding"; bindingId: string }> } }
  | { kind: "effect"; effectKind: "call" | "render" | "event" | "external-write" | "yield"; summary: string; certainty: FunctionTutorPayloadCertainty }
  | { kind: "unsupported"; summary: string; reason: string };

export type FunctionTutorPayload = {
  /** v3 adds invocation semantics; v2 readers remain valid because fields are optional. */
  version: 2 | 3;
  fingerprint: string;
  /** Existing opaque Function Logic flow identity, never a raw graph node ID. */
  functionId: string;
  executionKind: "sync" | "async" | "generator" | "async-generator";
  availability: "ready" | "partial" | "unavailable";
  context: FunctionTutorCodebaseContextPayload;
  guide: FunctionTutorGuidePlanPayload;
  frameworkBehavior?: FunctionFrameworkBehaviorPayload;
  parameters: FunctionTutorParameterPayload[];
  seeds: FunctionTutorScenarioSeedPayload[];
  program: FunctionTutorProgramPayload;
  /** Optional bounded call interpretation input; absence preserves legacy intra-function evaluation. */
  programBundle?: FunctionTutorScenarioProgramBundlePayload;
  evidence: FunctionTutorEvidencePayload[];
  gaps: FunctionTutorGapPayload[];
  summary: {
    inferredScenarioCount: number;
    exactCallsiteTupleCount: number;
    plannedCoverageCount: number;
    totalObjectiveCount: number;
    limited: boolean;
  };
};

/** Codebase evidence projected without source paths or analyzer identities. */
export type FunctionTutorCodebaseContextPayload = {
  documentation?: {
    kind: string;
    summary: string;
    tags: Array<{ kind: "parameter" | "returns" | "throws" | "remarks"; parameterName?: string; text: string }>;
    truncated: boolean;
    evidenceTokens: CodeFlowEvidenceToken[];
  };
  owners: Array<{
    id: string;
    kind: "file" | "module" | "namespace" | "class";
    name: string;
    certainty: FunctionTutorPayloadCertainty;
    evidenceTokens: CodeFlowEvidenceToken[];
  }>;
  architecture?: {
    layer: string;
    confidence: "high" | "medium" | "low" | "unknown";
    businessLogic: "domainRuleCandidate" | "applicationWorkflowCandidate" | "notBusinessLogic" | "unknown";
    conflicted: boolean;
    alternatives: string[];
    evidence: Array<{ summary: string; certainty: FunctionTutorPayloadCertainty; evidenceTokens: CodeFlowEvidenceToken[] }>;
  };
  entrypoints: FunctionTutorEntrypointPayload[];
  callers: FunctionTutorCallerPayload[];
  callees: FunctionTutorCalleePayload[];
  counts: {
    totalEntrypointCount: number;
    omittedEntrypointCount: number;
    totalCallerCount: number;
    omittedCallerCount: number;
    totalLocalCalleeCount: number;
    totalExternalCalleeCount: number;
    totalUnresolvedCalleeCount: number;
    omittedCalleeCount: number;
  };
};

export type FunctionTutorEntrypointPayload = {
  id: string;
  kind: "httpRoute" | "graphqlOperation";
  label: string;
  framework: string;
  certainty: FunctionTutorPayloadCertainty;
  steps: Array<{
    name: string;
    role: string;
    resolution: "concrete" | "external" | "unresolved";
    certainty: FunctionTutorPayloadCertainty;
    evidenceTokens: CodeFlowEvidenceToken[];
  }>;
  evidenceTokens: CodeFlowEvidenceToken[];
};

export type FunctionTutorCallerPayload = {
  id: string;
  name: string;
  qualifiedName: string;
  kind: "function" | "method" | "constructor";
  callCount: number;
  certainty: FunctionTutorPayloadCertainty;
  evidenceTokens: CodeFlowEvidenceToken[];
};

export type FunctionTutorCalleePayload = {
  id: string;
  name: string;
  kind: "local" | "external" | "unresolved";
  relation: "call" | "render" | "event";
  callCount: number;
  certainty: FunctionTutorPayloadCertainty;
  sourceBlockId?: string;
  evidenceTokens: CodeFlowEvidenceToken[];
};

/** Five fixed questions rendered by the Guide without parsing display prose. */
export type FunctionTutorGuidePlanPayload = {
  initialChapterId: string;
  chapters: FunctionTutorGuideChapterPayload[];
  summary: { readyChapterCount: number; partialChapterCount: number; unavailableChapterCount: number };
};

export type FunctionTutorGuideChapterPayload = {
  id: string;
  ordinal: 1 | 2 | 3 | 4 | 5;
  kind: "place" | "inputs" | "decisions" | "work" | "outcomes";
  question: string;
  /** Fixed question identity; browser formats it without matching English text. */
  questionKey?: "place" | "inputs" | "decisions" | "work" | "outcomes";
  status: "ready" | "partial" | "unavailable";
  answer: { text: string; counts: Record<string, number> };
  /** Fixed answer shape. Source-backed fact text remains separate. */
  answerKey?: "place" | "inputs" | "decisions" | "work" | "outcomes";
  facts: FunctionTutorGuideFactPayload[];
  preferredLens: "flow" | "values" | "calls" | "effects";
  primaryBlockId?: string;
  attentionBlockIds: string[];
  attentionEdgeIds: string[];
  gapIds: string[];
};

export type FunctionTutorGuideFactPayload = {
  id: string;
  kind: string;
  label: string;
  labelPresentationKey?: FunctionTutorSemanticPresentationKey;
  labelPresentationParams?: PresentationParams;
  detail: string;
  /** Owned fact explanation key; source documentation and evidence remain literals. */
  presentationKey?: FunctionTutorFactPresentationKey;
  certainty: FunctionTutorPayloadCertainty;
  blockIds: string[];
  edgeIds: string[];
  evidenceTokens: CodeFlowEvidenceToken[];
};

export type FunctionTutorParameterPayload = {
  id: string;
  bindingId?: string;
  name: string;
  index: number;
  typeKind: string;
  typeText?: string;
  optional: boolean;
  rest: boolean;
};

export type FunctionTutorScenarioSeedPayload = {
  id: string;
  ordinal: number;
  title: string;
  source: "callsite" | "default" | "branch" | "type" | "mixed";
  certainty: FunctionTutorPayloadCertainty;
  inputs: Array<{
    parameterId: string;
    value: FunctionTutorStaticValuePayload;
    omitted: boolean;
    certainty: FunctionTutorPayloadCertainty;
    evidenceTokens: CodeFlowEvidenceToken[];
  }>;
  objectiveIds: string[];
  evidenceTokens: CodeFlowEvidenceToken[];
  gapIds: string[];
};

export type FunctionTutorProgramPayload = {
  entryBlockId: string;
  blocks: Array<{
    blockId: string;
    kind: FunctionLogicBlockPayloadKind;
    label: string;
    operations: FunctionTutorOperationPayload[];
    decision?: {
      expression: FunctionTutorExpressionPayload;
      continuationId?: string;
      outcomes: Array<{ edgeId: string; label: string; matches: "true" | "false" | "case" | "default" | "exception" | "loop-exit" }>;
    };
    terminal?: { kind: "return" | "throw" | "break" | "continue" | "exit"; value?: FunctionTutorExpressionPayload; continuationId?: string };
    continuationSupplyId?: string;
    embeddedRelation?: "immediate" | "defines" | "deferred";
    evidenceTokens: CodeFlowEvidenceToken[];
  }>;
  edges: Array<{
    edgeId: string;
    sourceBlockId: string;
    targetBlockId: string;
    kind: FunctionLogicEdgePayloadKind;
    label?: string;
    certainty: FunctionTutorPayloadCertainty;
  }>;
  bindings: Array<{ bindingId: string; parameterId?: string; parameterIndex?: number; name: string; kind: "parameter" | "local" | "constant"; certainty: FunctionTutorPayloadCertainty }>;
  generatorYields?: FunctionTutorExpressionPayload[];
  generatorReturn?: FunctionTutorExpressionPayload;
  continuations?: Array<{ id: string; predicate: "truthy" | "non-nullish"; select: FunctionTutorExpressionPayload; supply: FunctionTutorExpressionPayload }>;
  ownerId?: string;
  thisBindingId?: string;
  invocationRole?: "function" | "method" | "constructor" | "object-method" | "static-method";
  /** Safe own fields installed before a projected constructor body runs. */
  fieldInitializers?: Array<{ key: string; value: FunctionTutorExpressionPayload }>;
};

/**
 * Snapshot-local Scenario programs. Program IDs and callee links are opaque;
 * the browser receives no source range, path, graph node, or name resolver.
 */
export type FunctionTutorScenarioProgramBundlePayload = {
  rootProgramId: string;
  programs: Array<FunctionTutorProgramPayload & {
    id: string;
    executionKind: "sync" | "async" | "generator" | "async-generator";
    confidence: FunctionTutorPayloadCertainty;
  }>;
  links?: Array<{ callerProgramId: string; calleeProgramId?: string; callId: string }>;
  omittedLinks: Array<{ callerProgramId: string; callId?: string; reason: "unresolved" | "ambiguous" | "cycle" | "depth-budget" | "program-budget" | "block-budget" | "payload-budget" | "unsupported" }>;
};

export type FunctionTutorEvidencePayload = {
  token: CodeFlowEvidenceToken;
  kind: string;
  certainty: FunctionTutorPayloadCertainty;
  summary: string;
};

export type FunctionTutorGapPayload = {
  id: string;
  kind: string;
  summary: string;
  presentationKey?: FunctionTutorGapPresentationKey;
  presentationParams?: PresentationParams;
  parameterId?: string;
  blockId?: string;
  evidenceTokens: CodeFlowEvidenceToken[];
};
