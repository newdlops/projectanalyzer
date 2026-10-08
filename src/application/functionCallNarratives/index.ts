/** Source-owned call interpretation facade; model execution remains the existing provider adapter's responsibility. */
export { buildFunctionCallNarrativePrompt, parseFunctionCallNarrative } from "./prompt";
export { buildFunctionCallNarrativePlan, type FunctionCallNarrativePlan } from "./plan";
export { buildFunctionCallNarrativeContext, resolveFunctionCallDeclarationRange } from "./context";
export { buildSourceFunctionCallNarrativeResponse } from "./sourceReading";
