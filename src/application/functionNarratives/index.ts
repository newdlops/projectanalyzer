/** Public source-reading API; internal helpers never depend on VS Code or Webview state. */
export { buildFunctionNarrativeContext } from "./sourceContext";
export { buildFunctionNarrativeSourceFlow, type FunctionNarrativeFlowOptions } from "./sourceFlow";
export { buildFunctionNarrativeScenarioGraph } from "./scenarioGraph";
export { createFunctionNarrativeScenarioIterator } from "./scenarioIterator";
export { FunctionNarrativeScenarioRun } from "./scenarioRun";
export { buildFunctionNarrativeFlowGuidance } from "./flowGuidance";
export { addFunctionNarrativeValueGrounding } from "./valueGrounding";
export { buildFunctionNarrativeScenarioFrames, type FunctionNarrativeScenarioFrame } from "./scenarioFrames";
export { parseFunctionNarrative, buildFunctionNarrativePrompt } from "./structuredResponse";
export { buildFunctionNarrativeExplanationGuidance, numberFunctionNarrativeContext } from "./explanationGuidance";
export { FunctionNarrativeError, type FunctionNarrativeProvider } from "./provider";
