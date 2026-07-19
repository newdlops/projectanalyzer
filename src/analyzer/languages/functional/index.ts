/** Public surface for pipe-forward functional-language graph analysis. */

export { FunctionalLanguageAnalyzer } from "./functionalLanguageAnalyzer";
export {
  FUNCTIONAL_PIPELINE_EXTENSIONS,
  FUNCTIONAL_PIPELINE_LANGUAGE_IDS,
  isFunctionalPipelineLanguage,
  resolveFunctionalLanguageProfile
} from "./functionalLanguageProfiles";
export { collectFunctionalPipelineChains } from "./functionalPipelineSyntax";
export { parseFunctionalSource } from "./functionalSyntax";
export type {
  FunctionalCallableSyntax,
  FunctionalLanguageProfile,
  FunctionalPipeInsertion,
  FunctionalPipelineChain,
  FunctionalPipelineLanguage,
  FunctionalPipelineStage,
  FunctionalSourceSnapshot
} from "./types";
