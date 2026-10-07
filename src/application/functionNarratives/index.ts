/** Public source-reading API; internal helpers never depend on VS Code or Webview state. */
export { buildFunctionNarrativeContext } from "./sourceContext";
export { buildFunctionNarrativeSourceFlow, type FunctionNarrativeFlowOptions } from "./sourceFlow";
export { buildFunctionNarrativeScenarioGraph } from "./scenarioGraph";
export { bindFunctionNarrativeGraph, initializeFunctionNarrativeNodes, createFunctionNarrativeNodeTask, createFunctionNarrativeSummaryTask, appendFunctionNarrativeNodes, finalizeFunctionNarrativeNodes } from "./nodeInterpretation";
export { createFunctionNarrativeScenarioIterator } from "./scenarioIterator";
export { FunctionNarrativeScenarioRun } from "./scenarioRun";
export { buildFunctionNarrativeFlowGuidance } from "./flowGuidance";
export { addFunctionNarrativeValueGrounding } from "./valueGrounding";
export { buildPrimitiveWorksheetResponse, hasCompletePrimitiveWorksheet, getPrimitiveWorksheetAnalysis } from "./primitiveWorksheet";
export { selectPrimitiveNarrativeAlternative, buildPrimitiveNarrativeSynthesis } from "./primitiveWorksheet/narrative";
export { buildFunctionNarrativeScenarioFrames, getFunctionNarrativeExampleConstraints, type FunctionNarrativeScenarioFrame } from "./scenarioFrames";
export { parseFunctionNarrative, buildFunctionNarrativePrompt } from "./structuredResponse";
export { buildFunctionNarrativeExplanationGuidance, buildFunctionNarrativeRichGuidance, buildFunctionNarrativeEmptyRouteGuidance, numberFunctionNarrativeContext } from "./explanationGuidance";
export { FunctionNarrativeError, type FunctionNarrativeProvider } from "./provider";
export type { FunctionNarrativeModelResponse, FunctionNarrativeGenerationOptions, FunctionNarrativeOperationOptions } from "./provider";
export { scheduleFunctionNarrativePreparation, scheduleFunctionNarrativeRequest, MODEL_INFERENCE_TIMEOUT_MS } from "./queuedProvider";
export { requestFunctionNarrative } from "./request";
