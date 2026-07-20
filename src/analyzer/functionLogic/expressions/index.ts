/** Public surface for TypeScript/JavaScript expression-level Function Logic. */

export {
  expandTypeScriptExpressionFlows,
  type TypeScriptExpressionFlowExpansion
} from "./typescriptExpressionExpansion";
export { planTypeScriptExpressionFlow } from "./typescriptExpressionPlanner";
export {
  hasTypeScriptExpressionFlowRoot,
  isShortCircuitBinary,
  readTypeScriptExpressionBodyFlowTarget,
  readTypeScriptStatementExpressionFlowTarget,
  type TypeScriptExpressionFlowTarget
} from "./typescriptExpressionTargets";
export type {
  TypeScriptBooleanExpressionFlowFragment,
  TypeScriptExpressionFlowExit,
  TypeScriptExpressionFlowMode,
  TypeScriptExpressionFlowPlan,
  TypeScriptExpressionFlowRequest,
  TypeScriptValueExpressionFlowFragment
} from "./types";

