/**
 * Pure, host-independent contracts for enumerating one boolean condition's
 * short-circuit evaluation cases from the existing Function Logic CFG.
 */

/** One source predicate participating in a grouped boolean decision. */
export type FunctionLogicConditionCaseBlock = {
  id: string;
  kind: string;
  condition?: {
    groupId: string;
    expression: string;
    /** Full source expression, retained only by the group root. */
    groupExpression?: string;
    memberIndex: number;
    root: boolean;
  };
};

/** Minimal control transfer needed to enumerate truthy/falsy evaluation paths. */
export type FunctionLogicConditionCaseEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
};

/** One table column, ordered by parser-proven short-circuit evaluation order. */
export type FunctionLogicConditionCaseColumn = {
  blockId: string;
  expression: string;
};

/** Possible display state for one predicate in one complete evaluation path. */
export type FunctionLogicConditionCaseValue = "true" | "false" | "skipped";

/** One finite short-circuit path ending outside the selected condition group. */
export type FunctionLogicConditionCaseRow = {
  id: string;
  values: FunctionLogicConditionCaseValue[];
  result: "true" | "false";
  /** Decision edges to select together when the user applies this case. */
  choiceEdgeIds: string[];
  /** First non-group CFG target reached by the selected evaluation path. */
  targetBlockId: string;
};

/** Bounded case matrix for one root condition, independent from DOM or protocol code. */
export type FunctionLogicConditionCaseProjection = {
  columns: FunctionLogicConditionCaseColumn[];
  rows: FunctionLogicConditionCaseRow[];
  /** Number of complete cases hidden after the configured visible-row bound. */
  omittedCaseCount: number;
};

/** Explicit bounds prevent a deep or malformed CFG from becoming a truth-table explosion. */
export type FunctionLogicConditionCaseProjectionOptions = {
  maximumColumns?: number;
  maximumRows?: number;
};
