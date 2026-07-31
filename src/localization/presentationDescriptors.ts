/** Finite browser-copy descriptor contracts shared across application layers. */
export type PresentationParams = Record<string, string | number | boolean>;

/** Runtime inventory used by catalog-parity tests without duplicating string matching. */
export const FUNCTION_LOGIC_GAP_PRESENTATION_KEYS = [
  "logic-gap-statement-limit", "logic-gap-finally", "logic-gap-jsx-limit", "logic-gap-expression-limit", "logic-gap-optional-chaining", "logic-gap-exceptions", "logic-gap-parser-recovered", "logic-gap-runtime-code", "logic-gap-embedded-diagnostic", "logic-gap-embedded-limit", "logic-gap-embedded-region-limit", "logic-gap-constant-write", "logic-gap-value-limit", "logic-gap-java-expression", "logic-gap-java-runtime", "logic-gap-python-expression", "logic-gap-python-runtime", "logic-gap-functional-runtime", "logic-gap-functional-collapsed", "logic-gap-functional-limit", "logic-gap-unavailable-language", "logic-gap-unavailable-source", "logic-gap-unavailable-function"
] as const;

export const FUNCTION_TUTOR_GAP_PRESENTATION_KEYS = [
  "tutor-gap-unsupported-parameter", "tutor-gap-unsupported-expression", "tutor-gap-unresolved-callsite", "tutor-gap-dynamic-argument", "tutor-gap-ambiguous-overload", "tutor-gap-alias-budget", "tutor-gap-condition-budget", "tutor-gap-value-budget", "tutor-gap-scenario-budget", "tutor-gap-path-budget", "tutor-gap-loop-budget", "tutor-gap-context-budget", "tutor-gap-embedded-boundary", "tutor-gap-missing-source", "tutor-gap-language-support"
] as const;

/** Fact labels used by the Tutor guide and catalog-parity contract tests. */
export const FUNCTION_TUTOR_FACT_PRESENTATION_KEYS = [
  "tutor-fact-owner", "tutor-fact-architecture", "tutor-fact-entrypoint", "tutor-fact-caller", "tutor-fact-parameter", "tutor-fact-decision", "tutor-fact-loop", "tutor-fact-value-change", "tutor-fact-call", "tutor-fact-render", "tutor-fact-event", "tutor-fact-effect", "tutor-fact-embedded", "tutor-fact-return", "tutor-fact-throw", "tutor-fact-exit", "tutor-fact-scenario", "tutor-fact-gap"
] as const;

/** Browser-owned semantic labels; source names and documentation remain literal params. */
export const FUNCTION_TUTOR_SEMANTIC_PRESENTATION_KEYS = [
  "tutor-label-documentation", "tutor-label-owner", "tutor-label-owner-file",
  "tutor-label-owner-module", "tutor-label-owner-namespace", "tutor-label-owner-class",
  "tutor-label-architecture", "tutor-label-omitted-parameters", "tutor-label-scenario-count",
  "tutor-seed-callsite", "tutor-seed-default", "tutor-seed-branch", "tutor-seed-type", "tutor-seed-mixed",
  "tutor-terminal-return", "tutor-terminal-throw", "tutor-terminal-break", "tutor-terminal-continue", "tutor-terminal-exit",
  "tutor-overview-internal-shape"
] as const;

/** Finite Function Logic block copy; `source` params retain syntax without translating it. */
export const FUNCTION_LOGIC_BLOCK_PRESENTATION_KEYS = [
  "logic-block-label-entry", "logic-block-label-embedded", "logic-block-label-callable", "logic-block-label-condition", "logic-block-label-loop", "logic-block-label-switch", "logic-block-label-try", "logic-block-label-render", "logic-block-label-event", "logic-block-label-call", "logic-block-label-effect", "logic-block-label-mutation", "logic-block-label-operation", "logic-block-label-return", "logic-block-label-throw", "logic-block-label-break", "logic-block-label-continue", "logic-block-label-exit", "logic-block-label-unknown",
  "logic-block-detail-entry", "logic-block-detail-embedded", "logic-block-detail-callable", "logic-block-detail-condition", "logic-block-detail-loop", "logic-block-detail-switch", "logic-block-detail-try", "logic-block-detail-render", "logic-block-detail-event", "logic-block-detail-call", "logic-block-detail-effect", "logic-block-detail-mutation", "logic-block-detail-operation", "logic-block-detail-return", "logic-block-detail-throw", "logic-block-detail-break", "logic-block-detail-continue", "logic-block-detail-exit", "logic-block-detail-unknown"
] as const;

/** Finite browser-owned Function Logic labels; syntax and source identity remain literal. */
export const FUNCTION_LOGIC_BROWSER_PRESENTATION_KEYS = [
  "logic-entry", "logic-exit", "logic-condition", "logic-loop", "logic-switch", "logic-try", "logic-call", "logic-effect", "logic-operation", "logic-return", "logic-throw", "logic-break", "logic-continue", "logic-embedded", "logic-callable", "logic-render", "logic-event", "logic-mutation", "logic-unknown",
  "logic-child-count", "logic-node-aria", "logic-aria-none", "logic-aria-child-available", "logic-aria-outer-available", "logic-target-transfer", "logic-compound-body", "value-token-fallback", "value-token-unknown", "logic-confidence-exact", "logic-confidence-resolved", "logic-confidence-inferred", "logic-confidence-unresolved", "logic-confidence-unknown", "logic-value-operation-initialize", "logic-value-operation-assign", "logic-value-operation-update", "logic-value-operation-delete", "logic-value-operation-iterate", "logic-value-operation-mutate", "logic-value-operation-read", "logic-value-operation-write", "logic-value-operation-readwrite", "logic-value-operation-consume", "logic-value-operation-sink", "logic-value-operation-unknown", "value-preview-binding-title", "value-preview-calculation", "value-preview-flow", "legend-value-changed", "legend-declaration-use", "legend-solid-immediate-call", "legend-dashed-deferred", "legend-defined-not-invoked", "legend-mutation", "legend-return-throw", "legend-dashed-inferred", "legend-curved-hops", "access-count", "accesses-count", "functions-in-one-graph"
] as const;

/** Finite Function Logic edge copy; edge labels remain compatibility data only. */
export const FUNCTION_LOGIC_EDGE_PRESENTATION_KEYS = [
  "logic-edge-next", "logic-edge-defines", "logic-edge-deferred", "logic-edge-true",
  "logic-edge-false", "logic-edge-iterate", "logic-edge-repeat", "logic-edge-exit",
  "logic-edge-case", "logic-edge-exception", "logic-edge-finally", "logic-edge-return",
  "logic-edge-throw", "logic-edge-break", "logic-edge-continue", "logic-edge-else-if",
  "logic-edge-default", "logic-edge-try", "logic-edge-catch", "logic-edge-elif",
  "logic-edge-loop-completed", "logic-edge-except", "logic-edge-with",
  "logic-edge-synchronized", "logic-edge-nested", "logic-edge-truthy", "logic-edge-falsy",
  "logic-edge-present", "logic-edge-nullish", "logic-edge-each"
] as const;

/** Scenario evaluator failure descriptors; parameters preserve source identifiers verbatim. */
export const FUNCTION_LOGIC_SCENARIO_PRESENTATION_KEYS = [
  "scenario-state-unset", "scenario-state-unknown", "scenario-reason-legacy", "scenario-reason-static-unsupported",
  "scenario-reason-value-unknown", "scenario-reason-value-unassigned", "scenario-reason-input-unset",
  "scenario-reason-parameter-unset", "scenario-reason-custom-unset", "scenario-reason-definition-unreached",
  "scenario-reason-calls-static", "scenario-reason-multiple-values", "scenario-reason-prototype-write",
  "scenario-reason-field-unassigned", "scenario-reason-member-unavailable",
  "scenario-reason-unresolved-identifier", "scenario-reason-unsupported-operator"
  ,"scenario-reason-invalid-input", "scenario-reason-expression-missing", "scenario-reason-expression-limit", "scenario-reason-token-limit", "scenario-reason-invalid-string", "scenario-reason-invalid-number", "scenario-reason-incomplete-expression", "scenario-reason-unsupported-expression", "scenario-reason-empty-group", "scenario-reason-optional-access", "scenario-reason-unsupported-token", "scenario-reason-expression-operator-end", "scenario-reason-incomplete-ternary", "scenario-reason-unmatched-closing-paren", "scenario-reason-unmatched-opening-paren", "scenario-reason-ternary-separator", "scenario-reason-unary-failed", "scenario-reason-binary-failed", "scenario-reason-member-path", "scenario-reason-member-container", "scenario-reason-binding-empty", "scenario-reason-object-path-limit", "scenario-reason-object-key", "scenario-reason-object-prototype", "scenario-reason-object-container", "scenario-reason-object-accessor", "scenario-reason-object-clone", "scenario-reason-object-write", "scenario-reason-object-delete", "scenario-reason-object-configurable", "scenario-reason-inferred-mutation", "scenario-reason-value-deleted", "scenario-trace-selection", "scenario-trace-input", "scenario-trace-input-unset", "scenario-trace-source", "scenario-trace-current", "scenario-trace-steps", "scenario-trace-omitted"
] as const;

/** Finite Code Flow prose emitted by Host projections; source syntax remains params. */
export const CODE_FLOW_PRESENTATION_KEYS = [
  "code-flow-unnamed-entrypoint", "code-flow-unknown-framework", "code-flow-anonymous-callable",
  "code-flow-unnamed-step", "code-flow-unresolved-target", "code-flow-entrypoint-http",
  "code-flow-entrypoint-graphql", "code-flow-function-context", "code-flow-function-context-source",
  "code-flow-entrypoint-http-unknown-framework", "code-flow-entrypoint-graphql-unknown-framework",
  "code-flow-unresolved-callsite", "code-flow-unresolved-callsite-source",
  "code-flow-evidence-selected-definition", "code-flow-evidence-framework-boundary",
  "code-flow-evidence-handler-exact", "code-flow-evidence-handler-resolved",
  "code-flow-evidence-handler-inferred", "code-flow-evidence-handler-unresolved",
  "code-flow-evidence-call-exact-concrete", "code-flow-evidence-call-exact-external", "code-flow-evidence-call-exact-unresolved",
  "code-flow-evidence-call-resolved-concrete", "code-flow-evidence-call-resolved-external", "code-flow-evidence-call-resolved-unresolved",
  "code-flow-evidence-call-inferred-concrete", "code-flow-evidence-call-inferred-external", "code-flow-evidence-call-inferred-unresolved",
  "code-flow-evidence-call-unresolved-concrete", "code-flow-evidence-call-unresolved-external", "code-flow-evidence-call-unresolved-unresolved",
  "code-flow-gap-ambiguous-detail", "code-flow-gap-handler-not-mapped-detail",
  "code-flow-gap-depth-limit-detail", "code-flow-gap-step-limit-detail",
  "code-flow-gap-entrypoint-not-found-detail", "code-flow-gap-cycle-or-duplicate-detail",
  "code-flow-gap-ambiguous", "code-flow-gap-handler-not-mapped", "code-flow-gap-depth-limit",
  "code-flow-gap-step-limit", "code-flow-gap-entrypoint-not-found", "code-flow-gap-cycle-or-duplicate"
] as const;

export type FunctionLogicGapPresentationKey = typeof FUNCTION_LOGIC_GAP_PRESENTATION_KEYS[number];
export type FunctionTutorGapPresentationKey = typeof FUNCTION_TUTOR_GAP_PRESENTATION_KEYS[number];
export type FunctionTutorFactPresentationKey = typeof FUNCTION_TUTOR_FACT_PRESENTATION_KEYS[number];
export type FunctionTutorSemanticPresentationKey = typeof FUNCTION_TUTOR_SEMANTIC_PRESENTATION_KEYS[number];
export type FunctionLogicBlockPresentationKey = typeof FUNCTION_LOGIC_BLOCK_PRESENTATION_KEYS[number];
export type FunctionLogicEdgePresentationKey = typeof FUNCTION_LOGIC_EDGE_PRESENTATION_KEYS[number];
export type FunctionLogicScenarioPresentationKey = typeof FUNCTION_LOGIC_SCENARIO_PRESENTATION_KEYS[number];
export type CodeFlowPresentationKey = typeof CODE_FLOW_PRESENTATION_KEYS[number];

/** Finite Function Search copy; source-derived callable names remain literal. */
export const FUNCTION_SEARCH_PRESENTATION_KEYS = [
  "function-search-external-callable", "function-search-unresolved-call",
  "function-search-anonymous-callable", "function-search-failure-graph-unavailable",
  "function-search-failure-projection-failed", "function-search-matching-count"
] as const;
export type FunctionSearchPresentationKey = typeof FUNCTION_SEARCH_PRESENTATION_KEYS[number];

/** Finite Module Flow application-copy contracts; names, paths, and frameworks are params. */
export const MODULE_FLOW_PRESENTATION_KEYS = [
  "module-basis-workspacePackage", "module-basis-frameworkRoot", "module-basis-sourceArea", "module-basis-workspaceRoot", "module-basis-externalBoundary",
  "module-evidence-manifest", "module-evidence-explicitRoot", "module-evidence-framework", "module-evidence-frameworkUnit", "module-evidence-sourceArea", "module-evidence-workspace", "module-evidence-external",
  "module-fallback-unnamed", "module-fallback-source", "module-fallback-evidence", "module-fallback-anonymous", "module-function-detail",
  "module-basis-badge-workspacePackage", "module-basis-badge-frameworkRoot", "module-basis-badge-sourceArea", "module-basis-badge-workspaceRoot", "module-basis-badge-externalBoundary",
  "module-confidence-exact", "module-confidence-resolved", "module-confidence-inferred", "module-confidence-unresolved", "module-confidence-unknown", "module-confidence-static",
  "module-value-flow-metrics", "module-direct-metrics", "module-tree-metrics", "module-evidence-metrics", "module-entry-metrics",
  "module-cycle-self", "module-cycle-group", "module-crossed-line-bridge",
  "module-failure-staleGraph", "module-failure-moduleNotFound", "module-failure-functionNotFound", "module-failure-edgeNotFound", "module-failure-sourceNotFound", "module-failure-evidenceNotFound", "module-failure-projectionFailed"
] as const;
export type ModuleFlowPresentationKey = typeof MODULE_FLOW_PRESENTATION_KEYS[number];
