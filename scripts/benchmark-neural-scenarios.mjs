/** Reproducible diagnostic corpus, held separate from the learning-unit fixtures. Run after compile. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildInputModel } = require("../out/test/unit/helpers/neuralScenarioFixtures");
const { createNeuralScenarioProblem } = require("../out/application/scenarioInputs");
const { inferNeuralScenarios } = require("../out/analyzer/neuralScenarios");
const { evaluateFunctionTutorInputs } = require("../out/analyzer/functionTutor");
const { createNeuralInputSpace } = require("../out/analyzer/neuralScenarios/inputSpace");
const { createNeuralRandom } = require("../out/analyzer/neuralScenarios/network");

const corpus = [
  ["affine", "x: number", "const score = x * 7 - 11;", "score === 150"],
  ["coupled", "x: number, y: number", "const score = x * 5 + y * 2;", "score === 211"],
  ["updates", "x: number", "let score = x;\n score += 13;\n score *= 6;", "score === 174"],
  ["required-object", "input: { count: number; offset: number; name: string }", "const score = input.count * 9 + input.offset;", "score === 173"],
  ["quadratic", "x: number", "const score = x * x;", "score === 169"],
  ["preceding-guard", "x: number", "if (x < 0) return \"rejected\";\n const score = x * 8 + 3;", "score === 179"],
  ["modulo", "x: number", "const score = x % 17;", "score === 6"],
  ["external-gap", "x: number", "const score = external(x);", "score === 173"]
];
const records = [];
for (const [name, parameters, body, condition] of corpus) {
  const model = await buildInputModel(`export function inspect(${parameters}) {\n ${body}\n if (${condition}) return "rare";\n return "ordinary";\n}`);
  const problem = createNeuralScenarioProblem(model);
  const rare = (inputs) => { const evaluation = evaluateFunctionTutorInputs(model.declaration, inputs); return evaluation.status === "verified" && evaluation.terminal?.value?.value === "rare"; };
  const started = performance.now(); const trained = await inferNeuralScenarios(problem);
  const untrained = await inferNeuralScenarios(problem, { epochs: 0 });
  const space = createNeuralInputSpace(problem); const random = createNeuralRandom(20260908);
  let randomHit = false;
  // Same maximum teacher budget (1400), not equal wall time. Random draws never use learned weights.
  if (space) for (let index = 0; index < 1400; index += 1) randomHit = rare(space.decode(space.dimensions.map(() => random() * 2 - 1))) || randomHit;
  records.push({ name, plannerRare: model.seeds.some((seed) => rare(seed.inputs)), randomRare: randomHit,
    neuralRare: trained?.boundaries.some((pair) => rare(pair.inputs) || rare(pair.neighbor)) ?? false,
    pairs: trained?.boundaries.length ?? 0, evaluations: trained?.report.evaluations,
    trainedError: trained?.report.validationError, untrainedError: untrained?.report.validationError,
    untrainedPairs: untrained?.boundaries.length ?? 0, milliseconds: Math.round(performance.now() - started) });
}
console.log(JSON.stringify({ seed: 20260908, maximumTeacherEvaluations: 1400,
  note: "Small diagnostic corpus, not a generalization or speed claim. Untrained pipeline retains the same quality gate; error is the weight-learning ablation.", records }, null, 2));
