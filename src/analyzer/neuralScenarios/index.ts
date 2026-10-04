/** Public local neural inference API. Network weights, codecs and search mechanics stay internal. */
export { inferNeuralScenarios } from "./infer";
/** Shared bounded codec; creating it performs no neural training. */
export { createNeuralInputSpace } from "./inputSpace";
export type { NeuralBoundary, NeuralScenarioOptions, NeuralScenarioProblem, NeuralScenarioResult, NeuralTrainingReport } from "./types";
