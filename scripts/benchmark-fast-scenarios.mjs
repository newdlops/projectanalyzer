/** Diagnostic inference latency corpus. Source preparation, cold inference and cache reuse are measured separately. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildInputModel } = require("../out/test/unit/helpers/neuralScenarioFixtures");
const { createNeuralScenarioProblem } = require("../out/application/scenarioInputs");
const { inferFastScenarios } = require("../out/analyzer/fastScenarios");
const { inferNeuralScenarios } = require("../out/analyzer/neuralScenarios");
const { evaluateFunctionTutorInputs } = require("../out/analyzer/functionTutor");

const corpus = [
  ["derived-equality", 'export function inspect(x: number, y: number) {\n let score = x * 3;\n score += y;\n if (score === 137) return "rare";\n return "ordinary";\n}'],
  ["internal-helper", 'function adjust(x: number) {\n return x * 7 - 11;\n}\nexport function inspect(x: number) {\n const score = adjust(x);\n if (score === 150) return "rare";\n return "ordinary";\n}'],
  ["nested-guard", 'export function inspect(x: number, y: number) {\n if (x * 7 + 11 === 270) {\n if (y * 3 + 5 === 98) return "rare";\n }\n return "ordinary";\n}'],
  ["object-shape", 'export function inspect(input: { amount: number; offset: number; label: string }) {\n if (input.amount * 4 + input.offset === 61) return "rare";\n return "ordinary";\n}'],
  ["text-length", 'export function inspect(name: string) {\n if (name.length * 4 + 3 === 39) return "rare";\n return "ordinary";\n}'],
  ["external-gap", 'export function inspect(x: number) {\n const score = external(x);\n if (score === 173) return "rare";\n return "ordinary";\n}']
];
const records = [];
const coldTimes = []; const warmTimes = [];
for (const [name, source] of corpus) {
  let lastProblem; let lastResult;
  const preparation = []; const cold = []; const warm = [];
  for (let run = 0; run < 10; run += 1) {
    const started = performance.now();
    const model = await buildInputModel(source + `\n// snapshot ${run}`);
    preparation.push(performance.now() - started);
    const problem = createNeuralScenarioProblem(model);
    const inferenceStarted = performance.now(); const result = await inferFastScenarios(problem);
    cold.push(performance.now() - inferenceStarted);
    if (result) {
      const reusedStarted = performance.now(); const reused = await inferFastScenarios(problem);
      warm.push(performance.now() - reusedStarted);
      if (!reused?.report.cacheHit || reused.report.evaluations !== 0) throw new Error("cache did not reuse the snapshot");
      if (result.report.evaluations > 192) throw new Error("evaluation budget exceeded");
    }
    lastProblem = problem; lastResult = result;
  }
  const rare = (inputs) => {
    const result = evaluateFunctionTutorInputs(lastProblem.declaration, inputs);
    return result.status === "verified" && result.terminal?.value?.kind === "string" && result.terminal.value.value === "rare";
  };
  const neuralStarted = performance.now(); const neural = name === "derived-equality" ? await inferNeuralScenarios(lastProblem) : undefined;
  const neuralMs = name === "derived-equality" ? performance.now() - neuralStarted : undefined;
  const valid = (result) => (result?.boundaries ?? []).some((pair) => [pair.inputs, pair.neighbor].some(rare));
  coldTimes.push(...cold); warmTimes.push(...warm);
  records.push({ name, preparationMedianMs: quantile(preparation, .5), coldMedianMs: quantile(cold, .5), coldP95Ms: quantile(cold, .95),
    warmMedianMs: quantile(warm, .5), evaluations: lastResult?.report.evaluations ?? null, boundaries: lastResult?.boundaries.length ?? 0,
    foundRare: valid(lastResult), ...(neuralMs === undefined ? {} : { neuralMs: rounded(neuralMs), neuralEvaluations: neural?.report.evaluations, neuralFoundRare: valid(neural) }) });
}
console.log(JSON.stringify({ diagnosticOnly: true, sourceSnapshots: 60,
  coldMedianMs: quantile(coldTimes, .5), coldP95Ms: quantile(coldTimes, .95), warmMedianMs: quantile(warmTimes, .5), records }, null, 2));

function rounded(value) { return Number(value.toFixed(3)); }
function quantile(values, proportion) { const sorted = values.slice().sort((a, b) => a - b); return sorted.length ? rounded(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * proportion))]) : null; }
