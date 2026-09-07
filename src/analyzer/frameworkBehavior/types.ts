/** Host-independent source facts; raw ranges stop at application projection. */
import type { DetectedFramework, FrameworkUnit, SourceRange, SymbolNode } from "../../shared/types";
import type { FrameworkBehaviorKind, FrameworkBehaviorPhase, FrameworkBehaviorRole, FunctionFramework } from "../../shared/frameworkBehavior";

export type FrameworkBehaviorFact = {
  kind: FrameworkBehaviorKind;
  phase: FrameworkBehaviorPhase;
  subject: string;
  confidence: "exact" | "inferred";
  range: SourceRange;
};

export type FunctionFrameworkBehavior = {
  framework: FunctionFramework;
  role: FrameworkBehaviorRole;
  facts: FrameworkBehaviorFact[];
  omittedCount: number;
  limited: boolean;
};

export type FrameworkBehaviorInput = {
  functionNode: SymbolNode;
  sourceText?: string;
  frameworks?: readonly DetectedFramework[];
  units?: readonly FrameworkUnit[];
  maxFacts?: number;
  maxDepth?: number;
};
