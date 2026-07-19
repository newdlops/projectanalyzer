/** Public application surface for bounded CodeFlow protocol projections. */

export {
  CODE_FLOW_CATALOG_DEFAULT_LIMIT,
  CODE_FLOW_CATALOG_MAX_LIMIT,
  createCodeFlowCatalogPayload
} from "./codeFlowCatalog";
export { createCodeFlowIdentity } from "./codeFlowIdentity";
export {
  createFunctionLogicCodeFlowDetail,
  type CodeFlowEvidenceTokenFactory
} from "./codeFlowFunctionLogicProjection";
export { createFunctionLogicGraphLayout } from "./functionLogicGraphLayout";
export {
  FUNCTION_LOGIC_DEFAULT_CALLEE_LIMIT,
  createFunctionLogicDrillTargets,
  type FunctionLogicDrillProjection,
  type FunctionLogicSourceTokenFactory
} from "./functionLogicDrillTargets";
export {
  CodeFlowInsightCache,
  type CodeFlowInsightSnapshot
} from "./codeFlowInsightCache";
export {
  createEntrypointCodeFlowDetail,
  createSymbolCodeFlowDetail,
  type SymbolCodeFlowProjectionOptions
} from "./codeFlowProjection";
