/** Request-local adaptive learning. Input evidence, learned search and independently checked outcomes stay separate. */
import { evaluateFunctionTutorInputs, type FunctionTutorDecisionObservation } from "../functionTutor";
import { createNeuralInputSpace, type NeuralInputSpace } from "./inputSpace";
import { ScenarioNetwork, createNeuralRandom, type TrainingRow } from "./network";
import { findNeuralBoundary, type MarginHead, type ObservedInput } from "./search";
import type { NeuralScenarioOptions, NeuralScenarioProblem, NeuralScenarioResult } from "./types";
import { preparePythonCurriculum } from "./pythonCurriculum";

type Sample = { x: number[]; sample: ObservedInput; validation: boolean };

/** Learns up to three bounded stages, preserving successful guards while exploring newly reached conditions. */
export async function inferNeuralScenarios(problem: NeuralScenarioProblem, options: NeuralScenarioOptions = {}): Promise<NeuralScenarioResult | undefined> {
  if (!["typescript", "javascript"].includes(problem.declaration.language) && !problem.declaration.program.python) return undefined;
  let evaluations = 0;
  problem = preparePythonCurriculum(problem, (inputs) => {
    if (options.signal?.aborted) throw new Error("neural-cancelled");
    evaluations += 1; return evaluateFunctionTutorInputs(problem.declaration, inputs);
  });
  const space = createNeuralInputSpace(problem); if (!space) return undefined;
  const random = createNeuralRandom(options.seed ?? 20260908);
  const identities = new Map<string, { blockId: string; occurrence?: number }>();
  // A tuple keeps the same split for the whole request. Search cannot later move
  // a held-out tuple into fitting data, and repeated checks use the same result.
  const cache = new Map<string, Sample>(); let evaluationLimit = 1400; let collecting = true; let collectionCount = 0;
  const observe = (x: number[]): ObservedInput | undefined => {
    if (options.signal?.aborted) throw new Error("neural-cancelled");
    const inputs = space.decode(x); const key = JSON.stringify(inputs); const cached = cache.get(key);
    if (cached) return cached.sample;
    if (evaluations >= evaluationLimit) return undefined;
    const canonical = space.encode(inputs); if (!canonical) return undefined;
    evaluations += 1;
    const observations = new Map<string, FunctionTutorDecisionObservation>(); const occurrences = new Map<string, number>();
    evaluateFunctionTutorInputs(problem.declaration, inputs, { maxSteps: 128, maxLoopVisits: problem.declaration.program.python ? 32 : 8,
      observeDecision(value) {
        const occurrence = occurrences.get(value.blockId) ?? 0; occurrences.set(value.blockId, occurrence + 1);
        if (occurrence >= (problem.declaration.program.python ? 3 : 1)) return;
        const headKey = occurrence ? value.blockId + "@" + occurrence : value.blockId;
        identities.set(headKey, { blockId: value.blockId, occurrence: occurrence || undefined }); observations.set(headKey, value);
      } });
    const sample = { inputs, observations };
    // Optimization feedback is fitting data. Only independently drawn corpus
    // samples enter the held-out stream; their membership never changes later.
    cache.set(key, { x: canonical, sample, validation: collecting && collectionCount++ % 5 === 4 }); return sample;
  };
  const examples = problem.examples.map((tuple) => space.encode(tuple)).filter((x): x is number[] => Boolean(x)).slice(0, 32);
  const sourceAnchors = space.dimensions.some((dimension) => dimension.choices) ? Array.from({ length: 8 }, (_, offset) => space.dimensions.map((dimension, index) => {
    const count = dimension.choices?.length ?? 0;
    return count > 1 ? Math.min(count - 1, offset === 0 ? 0 : (offset + index) % 4) * 2 / (count - 1) - 1 : 0;
  })) : [];
  const anchors = [...examples, ...sourceAnchors];
  for (let attempt = 0; cache.size < 400 && attempt < 800; attempt += 1) {
    const anchor = examples.length ? examples[attempt % examples.length] : undefined;
    const x = attempt < anchors.length ? anchors[attempt] : space.dimensions.map((dimension, index) =>
      anchor && attempt % 3 === 0 ? Math.max(-1, Math.min(1, anchor[index] + (random() * 2 - 1) * 0.1))
        : dimension.integer && attempt % 4 === 0 ? Math.max(-1, Math.min(1, Math.floor(random() * 49 - 16) / dimension.scale)) : random() * 2 - 1);
    observe(x);
    if (attempt % 16 === 0) await yieldTraining();
  }
  const boundaries: NeuralScenarioResult["boundaries"] = []; const covered = new Set<string>();
  let report: NeuralScenarioResult["report"] | undefined; let totalEpochs = 0;
  for (let round = 0; round < 3; round += 1) {
    const allSamples = [...cache.values()];
    // Preserve broad initial coverage and make room for the latest reached
    // prefixes; a full cache must not crowd newly discovered conditions out.
    const fitting = allSamples.length <= 800 ? allSamples : [...allSamples.slice(0, 400), ...allSamples.slice(-400)];
    const training = fitting.filter((item) => !item.validation); const validation = fitting.filter((item) => item.validation);
    const candidates = [...new Set(training.flatMap(({ sample }) => [...sample.observations.keys()]))];
    if (problem.declaration.program.python) candidates.sort((a, b) => {
      const priority = (key: string) => problem.declaration.program.blocks.find((block) => block.blockId === identities.get(key)?.blockId)?.kind === "condition" ? 0 : 1;
      return priority(a) - priority(b) || (identities.get(a)?.occurrence ?? 0) - (identities.get(b)?.occurrence ?? 0);
    });
    const heads: MarginHead[] = [];
    for (const key of candidates.slice(0, 16)) {
      const margins = training.flatMap(({ sample }) => { const item = sample.observations.get(key); return item ? [item.left - item.right] : []; });
      if (margins.length < 16 || validation.filter(({ sample }) => sample.observations.has(key)).length < 4) continue;
      const mean = margins.reduce((sum, value) => sum + value, 0) / margins.length;
      const scale = Math.sqrt(margins.reduce((sum, value) => sum + (value - mean) ** 2, 0) / margins.length);
      if (Number.isFinite(scale) && scale >= 1e-8) {
        const reached = training.filter(({ sample }) => sample.observations.has(key));
        // Constants among reached tuples are guard anchors. Moving or rounding
        // them would destroy an already solved outer equality, including 1/3.
        const varyingCoordinates = space.dimensions.flatMap((_, index) => {
          const values = reached.map((item) => item.x[index]);
          return Math.max(...values) - Math.min(...values) > 1e-12 ? [index] : [];
        });
        heads.push({ ...identities.get(key)!, key, mean, scale, varyingCoordinates });
      }
    }
    if (!heads.length) break;
    const rows = (data: Sample[]): TrainingRow[] => data.map(({ x, sample }) => ({ x: space.features(x), y: heads.map((head) => {
      const observation = sample.observations.get(head.key!);
      return observation ? (observation.left - observation.right - head.mean) / head.scale : undefined;
    }) }));
    const trainRows = rows(training); const validationRows = rows(validation);
    const richInputs = space.featureCount > space.dimensions.length;
    const network = new ScenarioNetwork(space.featureCount, heads.length, random, richInputs ? 48 : 24);
    const epochs = Math.max(0, Math.min(400, Math.trunc(options.epochs ?? (richInputs ? 360 : 240))));
    const initialLoss = network.loss(trainRows); await network.train(trainRows, epochs, options.signal); totalEpochs += epochs;
    const errors = heads.map((_, output) => {
      const values = validationRows.flatMap((row) => row.y[output] === undefined ? [] : [Math.abs(network.predict(row.x)[output] - row.y[output]!)]);
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    });
    // Reserve teacher work for another reachability stage instead of spending
    // the whole request repeatedly probing one already-known outer condition.
    evaluationLimit = [950, 1200, 1400][round];
    collecting = false;
    for (let output = 0; output < heads.length && boundaries.length < 4 && evaluations < evaluationLimit; output += 1) {
      const head = heads[output]; if (covered.has(head.key!) || errors[output] > 0.25) continue;
      const ranked = training.filter(({ sample }) => sample.observations.has(head.key!))
        .sort((a, b) => Math.abs(network.predict(space.features(a.x))[output] + head.mean / head.scale) - Math.abs(network.predict(space.features(b.x))[output] + head.mean / head.scale))
        .slice(0, 4).map((item) => item.x);
      const sourceRanked = sourceAnchors.slice().sort((a, b) => Math.abs(network.predict(space.features(a))[output] + head.mean / head.scale)
        - Math.abs(network.predict(space.features(b))[output] + head.mean / head.scale));
      for (const start of [...ranked.slice(0, 2), ...sourceRanked, ...examples.slice(0, 2), ...ranked.slice(2)]) {
        if (evaluations >= evaluationLimit) break;
        const boundary = findNeuralBoundary(network, head, output, start, space, observe);
        if (boundary) { boundaries.push(boundary); covered.add(head.key!); break; }
        await yieldTraining();
      }
    }
    report = { trainingSamples: training.length, validationSamples: validation.length, dimensions: space.dimensions.length,
      heads: heads.length, parameters: network.weights.length, epochs: totalEpochs,
      initialLoss, finalLoss: network.loss(trainRows), validationError: errors.reduce((sum, value) => sum + value, 0) / errors.length, evaluations };
    if (boundaries.length >= 4 || round === 2 || evaluations >= 1400) break;
    const knownHeads = new Set(heads.map((head) => head.key));
    const unseen = [...cache.values()].some(({ sample }) => [...sample.observations.keys()].some((key) => !knownHeads.has(key)));
    if (!unseen && heads.every((head) => covered.has(head.key!))) break;
    evaluationLimit = Math.min(1400, evaluations + 128);
    collecting = true;
    const exploration = pickExplorationAnchors([...cache.values()].filter((item) => !item.validation), heads.filter((head) => !covered.has(head.key!)), knownHeads);
    const previousSize = cache.size;
    for (let attempt = 0; attempt < 256 && evaluations < evaluationLimit && exploration.length; attempt += 1) {
      const anchor = exploration[attempt % exploration.length]; const x = anchor.x.slice();
      const index = Math.floor(attempt / exploration.length) % space.dimensions.length; const dimension = space.dimensions[index];
      const cycle = Math.floor(attempt / (exploration.length * space.dimensions.length));
      if (dimension.choices) {
        const choice = cycle < 8 ? cycle % dimension.choices.length : Math.floor(random() * dimension.choices.length);
        x[index] = dimension.choices.length === 1 ? 0 : choice * 2 / (dimension.choices.length - 1) - 1;
      } else x[index] = randomCoordinate(space, index, random);
      observe(x);
      if (attempt % 16 === 0) await yieldTraining();
    }
    if (cache.size === previousSize) break;
  }
  return report ? { boundaries, report: { ...report, evaluations } } : undefined;
}

/** Prefer actual newly reached comparisons, then close checked distances; held-out samples never become anchors. */
function pickExplorationAnchors(samples: Sample[], pending: MarginHead[], known: Set<string | undefined>): Sample[] {
  const novelty = (item: Sample) => [...item.sample.observations.keys()].filter((key) => !known.has(key)).length;
  const distance = (item: Sample) => Math.min(Infinity, ...pending.map((head) => {
    const observation = item.sample.observations.get(head.key!); return observation ? Math.abs(observation.left - observation.right) / head.scale : Infinity;
  }));
  const ranked = samples.slice().sort((a, b) => novelty(b) - novelty(a) || b.sample.observations.size - a.sample.observations.size || distance(a) - distance(b));
  const mostNovel = ranked.length ? novelty(ranked[0]) : 0;
  // A single new prefix needs enough independent mutations to fit and validate
  // its head. Filling the anchor set with shallow paths can starve it of labels.
  return (mostNovel ? ranked.filter((item) => novelty(item) === mostNovel) : ranked).slice(0, 8);
}

/** Vary one coordinate while preserving every other parameter of a useful reached prefix. */
function randomCoordinate(space: NeuralInputSpace, index: number, random: () => number): number {
  const dimension = space.dimensions[index];
  return dimension.integer && random() < 0.5 ? Math.max(-1, Math.min(1, Math.floor(random() * 49 - 16) / dimension.scale)) : random() * 2 - 1;
}
const yieldTraining = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
