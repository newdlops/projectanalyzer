/** Public framework-independent model scheduler contracts, manager and lifecycle validation. */
export { ModelTaskManager, getGlobalModelTaskManager } from "./manager";
export { ModelTaskError } from "./types";
export type { ModelTaskKind, ModelTaskPhase, ModelTaskOutcome, ModelTaskProgress, ModelTaskRecord, ModelTaskSnapshot, ModelTaskRequest, ModelTaskFailure } from "./types";
export { isModelTaskProgress } from "./validation";
