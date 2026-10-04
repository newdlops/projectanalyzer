/** Public input-suggestion boundary: bounded context, provider contract, validated proposals. */
export { parseScenarioInputSuggestions, ScenarioInputError } from "./scenarioInputSuggestions";
export { createLocalNeuralScenarioProvider, createNeuralScenarioProblem } from "./localNeuralProvider";
export { createLocalScenarioProvider } from "./localScenarioProvider";
export type { ScenarioInputProvider, ScenarioInputProviderResult, ScenarioInputFailure } from "./scenarioInputSuggestions";
