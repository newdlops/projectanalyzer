/** Public portable narrative contracts and runtime validation; callers do not depend on internal files. */
export type { FunctionNarrative, FunctionNarrativeScenario, FunctionNarrativeStep, FunctionNarrativeSource, FunctionNarrativeContext, FunctionNarrativeSnippet, FunctionNarrativeSourceFlow, FunctionNarrativeFlowPath, FunctionNarrativeFlowStep, FunctionNarrativeValueFact, FunctionNarrativeCheckedExample, FunctionNarrativeScenarioGraph } from "./types";
export { isFunctionNarrative, createFunctionNarrativeValidator } from "./validation";
export { isFunctionNarrativeExample } from "./exampleValidation";
export type { FunctionNarrativeExample, FunctionNarrativeNodeDetail } from "./types";
export { isFunctionNarrativeLanguage } from "./language";
export type { FunctionNarrativePageStore, FunctionNarrativePageStoreFactory } from "./pageStore";
export { buildFunctionNarrativeSourceAnnotations } from "./sourceAnnotations";
export type { FunctionNarrativeSourcePresentation, FunctionNarrativeSourcePresenter, FunctionNarrativeSourceAnnotation, FunctionNarrativeSourceReference } from "./sourceAnnotations";
