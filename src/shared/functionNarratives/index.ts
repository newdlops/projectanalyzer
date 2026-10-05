/** Public portable narrative contracts and runtime validation; callers do not depend on internal files. */
export type { FunctionNarrative, FunctionNarrativeScenario, FunctionNarrativeStep, FunctionNarrativeSource, FunctionNarrativeContext, FunctionNarrativeSnippet, FunctionNarrativeSourceFlow, FunctionNarrativeFlowPath, FunctionNarrativeFlowStep, FunctionNarrativeValueFact, FunctionNarrativeCheckedExample } from "./types";
export { isFunctionNarrative } from "./validation";
export { isFunctionNarrativeLanguage } from "./language";
export { buildFunctionNarrativeSourceAnnotations } from "./sourceAnnotations";
export type { FunctionNarrativeSourcePresentation, FunctionNarrativeSourcePresenter, FunctionNarrativeSourceAnnotation, FunctionNarrativeSourceReference } from "./sourceAnnotations";
