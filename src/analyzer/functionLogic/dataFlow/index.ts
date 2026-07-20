/**
 * Public surface for Function Logic value-flow facts, language collectors, and
 * the shared bounded CFG projector. Internal helpers stay private per module.
 */

export {
  createFunctionLogicDataFlowProjection,
  type FunctionLogicDataFlowProjection
} from "./functionLogicDataFlow";
export { collectTypeScriptFunctionValueFacts } from "./typescriptFunctionDataFlow";
export {
  collectJavaFunctionValueFacts,
  collectPythonFunctionValueFacts
} from "./lezerFunctionDataFlow";
export type {
  FunctionLogicValueAccess,
  FunctionLogicValueAccessFact,
  FunctionLogicValueAccessKind,
  FunctionLogicValueBinding,
  FunctionLogicValueBindingFact,
  FunctionLogicValueBindingKind,
  FunctionLogicValueFacts,
  FunctionLogicValueFlow,
  FunctionLogicValueUsageKind
} from "./types";
