/** Request-local training orchestration. Static labels, learned predictions and checked pairs remain separate. */
import { evaluateFunctionTutorInputs, type FunctionTutorDecisionObservation } from "../functionTutor";
import { createNeuralInputSpace } from "./inputSpace";
import { ScenarioNetwork, createNeuralRandom, type TrainingRow } from "./network";
import { findNeuralBoundary, type MarginHead, type ObservedInput } from "./search";
import type { NeuralScenarioOptions, NeuralScenarioProblem, NeuralScenarioResult } from "./types";

/** Trains a bounded residual MLP on this function, then searches its learned comparison surfaces. */
export async function inferNeuralScenarios(problem: NeuralScenarioProblem, options: NeuralScenarioOptions = {}): Promise<NeuralScenarioResult | undefined> {
  if (!["typescript", "javascript"].includes(problem.declaration.language)) return undefined;
  const space = createNeuralInputSpace(problem);
  if (!space) return undefined;
  const random = createNeuralRandom(options.seed ?? 20260908);
  let evaluations = 0;
  const observe = (x: number[]): ObservedInput | undefined => {
    if (options.signal?.aborted) throw new Error("neural-cancelled");
    if (evaluations >= 1400) return undefined;
    evaluations += 1;
    const inputs = space.decode(x); const observations = new Map<string, FunctionTutorDecisionObservation>();
    evaluateFunctionTutorInputs(problem.declaration, inputs, { maxSteps: 128, maxLoopVisits: 8,
      // A loop's first visit is a stable target. Later visits are not mixed into the same label.
      observeDecision(value) { if (!observations.has(value.blockId)) observations.set(value.blockId, value); } });
    return { inputs, observations };
  };
  const examples = problem.examples.map((tuple) => space.encode(tuple)).filter((x): x is number[] => Boolean(x)).slice(0, 32);
  const samples: Array<{ x: number[]; sample: ObservedInput }> = [];
  const seen = new Set<string>();
  for (let attempt = 0; samples.length < 400 && attempt < 800; attempt += 1) {
    const anchor = examples.length ? examples[attempt % examples.length] : undefined;
    const x = attempt < examples.length ? examples[attempt] : space.dimensions.map((_, i) =>
      anchor && attempt % 3 === 0 ? Math.max(-1, Math.min(1, anchor[i] + (random() * 2 - 1) * 0.1)) : random() * 2 - 1);
    const decoded = space.decode(x); const key = JSON.stringify(decoded);
    if (seen.has(key)) continue; seen.add(key);
    const canonical = space.encode(decoded); if (!canonical) continue;
    const sample = observe(canonical); if (!sample) break;
    samples.push({ x: canonical, sample });
    if (attempt % 16 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  // Split before fitting normalizers or weights. Unique tuples cannot straddle the split.
  const training = samples.filter((_, index) => index % 5 !== 4);
  const validation = samples.filter((_, index) => index % 5 === 4);
  const candidates = [...new Set(training.flatMap(({ sample }) => [...sample.observations.keys()]))].slice(0, 16);
  const heads: MarginHead[] = [];
  for (const blockId of candidates) {
    const margins = training.flatMap(({ sample }) => { const item = sample.observations.get(blockId); return item ? [item.left - item.right] : []; });
    if (margins.length < 16 || validation.filter(({ sample }) => sample.observations.has(blockId)).length < 4) continue;
    const mean = margins.reduce((sum, value) => sum + value, 0) / margins.length;
    const scale = Math.sqrt(margins.reduce((sum, value) => sum + (value - mean) ** 2, 0) / margins.length);
    if (!Number.isFinite(scale) || scale < 1e-8) continue;
    heads.push({ blockId, mean, scale });
  }
  if (!heads.length) return undefined;
  const rows = (data: typeof samples): TrainingRow[] => data.map(({ x, sample }) => ({ x: space.features(x), y: heads.map((head) => {
    const observation = sample.observations.get(head.blockId);
    return observation ? (observation.left - observation.right - head.mean) / head.scale : undefined;
  }) }));
  const trainRows = rows(training); const validationRows = rows(validation);
  const richInputs = space.featureCount > space.dimensions.length;
  const network = new ScenarioNetwork(space.featureCount, heads.length, random, richInputs ? 48 : 24);
  const epochs = Math.max(0, Math.min(400, Math.trunc(options.epochs ?? (richInputs ? 360 : 240))));
  const initialLoss = network.loss(trainRows);
  await network.train(trainRows, epochs, options.signal);
  const errors = heads.map((_, output) => {
    const values = validationRows.flatMap((row) => row.y[output] === undefined ? [] : [Math.abs(network.predict(row.x)[output] - row.y[output]!)]);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  });
  const boundaries: NeuralScenarioResult["boundaries"] = [];
  for (let output = 0; output < heads.length && boundaries.length < 4; output += 1) {
    // Poor approximation is an explicit empty result, not a claimed confident scenario.
    if (errors[output] > 0.25) continue;
    const head = heads[output];
    const ranked = training.filter(({ sample }) => sample.observations.has(head.blockId))
      .sort((a, b) => Math.abs(network.predict(space.features(a.x))[output] + head.mean / head.scale) - Math.abs(network.predict(space.features(b.x))[output] + head.mean / head.scale))
      .slice(0, 4).map((item) => item.x);
    // Anchor early attempts to complete caller/planner tuples for readable nearby inputs.
    const starts = [...examples.slice(0, 2), ...ranked];
    for (const start of starts) {
      const boundary = findNeuralBoundary(network, head, output, start, space, observe);
      if (boundary) { boundaries.push(boundary); break; }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return { boundaries, report: { trainingSamples: training.length, validationSamples: validation.length,
    dimensions: space.dimensions.length, heads: heads.length, parameters: network.weights.length, epochs,
    initialLoss, finalLoss: network.loss(trainRows), validationError: errors.reduce((sum, value) => sum + value, 0) / errors.length, evaluations } };
}
