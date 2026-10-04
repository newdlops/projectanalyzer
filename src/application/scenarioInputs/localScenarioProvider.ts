/** Fast default inference with an explicit optional neural search; creation allocates no per-function model. */
import { inferFastScenarios } from "../../analyzer/fastScenarios";
import { createBoundaryScenarioProposals, createLocalNeuralScenarioProvider, createNeuralScenarioProblem } from "./localNeuralProvider";
import { ScenarioInputError, type ScenarioInputProvider } from "./scenarioInputSuggestions";

/** Snapshot-owned caches are weak; panel disposal and source replacement release the model naturally. */
export function createLocalScenarioProvider(): ScenarioInputProvider {
  return { async suggest(model, language, signal, mode = "fast") {
    if (signal.aborted) throw new ScenarioInputError("cancelled");
    if (mode === "neural") return createLocalNeuralScenarioProvider().suggest(model, language, signal);
    // Generated rows do not perturb the reusable caller/type model on retries.
    const problem = createNeuralScenarioProblem({ ...model, seeds: model.seeds.filter((seed) => seed.source !== "model") });
    let result;
    try { result = await inferFastScenarios(problem, { signal }); }
    catch (error) { if (signal.aborted) throw new ScenarioInputError("cancelled"); throw error; }
    if (!result) throw new ScenarioInputError("unavailable");
    return { modelName: "Local linear · v1", text: JSON.stringify({ scenarios: createBoundaryScenarioProposals(model, result.boundaries, language, "fast") }),
      boundaries: result.boundaries, generation: result.report };
  } };
}
