/** Correlated model suggestions use only Host-issued flow identities, never browser source text. */
import type { CodeFlowId } from "./codeFlow";
import type { FunctionTutorScenarioSeedPayload } from "./functionTutor";

export type ScenarioInputsRequest = { graphVersion: string; flowId: CodeFlowId; requestId: number };
export type ScenarioInputsResponse = ScenarioInputsRequest & {
  status: "ready" | "empty" | "unavailable" | "cancelled" | "denied" | "timeout" | "invalid-response" | "failed" | "stale";
  modelName?: string;
  seeds?: FunctionTutorScenarioSeedPayload[];
  rejected?: number;
};
