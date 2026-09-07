/** Additive, JSON-only framework contracts with Host-issued evidence identities. */
import type { FrameworkBehaviorKind, FrameworkBehaviorPhase, FrameworkBehaviorRole, FunctionFramework } from "../shared/frameworkBehavior";
import type { CodeFlowEvidenceToken } from "./functionLogic";

export type FunctionFrameworkBehaviorPayload = {
  framework: FunctionFramework;
  role: FrameworkBehaviorRole;
  facts: Array<{
    id: string;
    kind: FrameworkBehaviorKind;
    phase: FrameworkBehaviorPhase;
    subject: string;
    confidence: "exact" | "inferred";
    blockId?: string;
    evidenceToken?: CodeFlowEvidenceToken;
  }>;
  omittedCount: number;
  limited: boolean;
};
