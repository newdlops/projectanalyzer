/** Configuration and bounded completion metadata for the native FunctionNarrativeProvider adapter; source and model text never appear in receipts. */
import type { ModelTaskManager } from "../../shared/modelTasks";
import type { NativeNarrativeWorkerOptions, NativeNarrativeWorkerObservation } from "../nativeNarratives";

/** This is the native action boundary; final Host freshness checks/publication outside withRun are not included in this duration. */
export type NativeFunctionNarrativeRunReceipt = {
  actionWholeHostMs: number;
  outerManagerSettlementObserved: true;
  neuralAuthorshipProven: false;
  worker: Omit<NativeNarrativeWorkerObservation, "closedReceipt">;
};
export type NativeFunctionNarrativeProviderOptions = {
  worker: NativeNarrativeWorkerOptions;
  manager?: ModelTaskManager;
  /** Only explicit audit owners receive completion metadata; observer failure cannot change a settled action. */
  onRunComplete?(receipt: NativeFunctionNarrativeRunReceipt): void;
};
