/** Configuration and bounded completion metadata for the native FunctionNarrativeProvider adapter; source and model text never appear in receipts. */
import type { ModelTaskManager } from "../../shared/modelTasks";
import type { NativeNarrativeWorkerOptions, NativeNarrativeWorkerObservation } from "../nativeNarratives";
import type { NativeNarrativeActionSettlement, NativeReadyDuration } from "../nativeNarratives";
import type { FunctionNarrativeHostSettlement } from "../../application/functionNarratives";

/** This is the native action boundary; final Host freshness checks/publication outside withRun are not included in this duration. */
export type NativeFunctionNarrativeRunReceipt = {
  actionWholeHostMs: number;
  outerManagerSettlementObserved: true;
  neuralAuthorshipProven: false;
  worker: Omit<NativeNarrativeWorkerObservation, "closedReceipt">;
};
/** Includes Host tail I/O/disposal and the exact public request Promise settlement; no source, prose, arbitrary error or receipt data. */
export type NativeFunctionNarrativeHostReceipt = {
  action: NativeNarrativeActionSettlement;
  host: FunctionNarrativeHostSettlement;
  duration: NativeReadyDuration;
  publicHostPromiseSettlementObserved: true;
  neuralAuthorshipProven: false;
};
export type NativeFunctionNarrativeProviderOptions = {
  worker: NativeNarrativeWorkerOptions;
  manager?: ModelTaskManager;
  /** Only explicit audit owners receive completion metadata; observer failure cannot change a settled action. */
  onRunComplete?(receipt: NativeFunctionNarrativeRunReceipt): void;
  /** Unlike onRunComplete, this also observes failed/queued/never-ready actions. Missing readiness has no duration. */
  onRunSettled?(receipt: NativeNarrativeActionSettlement): void;
  /** Available only when an actual Host supplies its public-Promise completion capability. */
  onHostRunComplete?(receipt: NativeFunctionNarrativeHostReceipt): void;
};
