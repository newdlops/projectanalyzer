/** Conservative prose-grounding facts; these describe source syntax, never observed execution. */
export type NarrativeQualityFacts = {
  /** True only for the complete, supported primitive statement/expression subset. */
  closed: boolean;
  identityCalls: Array<{ name: string; parameter: string; argumentIndex: number }>;
  identityInvocations: Array<{ statement: string; helper: string; argument: string; argumentJson?: string; binding: string;
    /** Same-block next if; its decision occurs after this call. */
    followingCondition?: string }>;
  returns: Array<{ expression: string; literal?: string; literalJson?: string; conditions: string[] }>;
  /** Present only after parsing the selected declaration; comments cannot invent an else arm. */
  hasElse?: boolean;
  /** Entire body: literal identity bindings, one Boolean early return, then its literal fall-through return. */
  simpleBooleanReturn?: { parameter: string; trueStatement: string; falseStatement: string };
};
