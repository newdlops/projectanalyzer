/** Correlated model suggestions use only Host-issued flow identities, never browser source text. */
import type { CodeFlowId } from "./codeFlow";
import type { FunctionTutorScenarioSeedPayload } from "./functionTutor";

export type ScenarioInputsRequest = { graphVersion: string; flowId: CodeFlowId; requestId: number };
export type ScenarioInputsResponse = ScenarioInputsRequest & {
  status: "ready" | "empty" | "unavailable" | "cancelled" | "denied" | "timeout" | "invalid-response" | "failed" | "stale";
  modelName?: string;
  seeds?: FunctionTutorScenarioSeedPayload[];
  rejected?: number;
  /** Numeric training diagnostics only; weights, labels and source identities stay in the Host. */
  training?: {
    trainingSamples: number; validationSamples: number; dimensions: number; heads: number; parameters: number;
    epochs: number; initialLoss: number; finalLoss: number; validationError: number; evaluations: number;
  };
};
