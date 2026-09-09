/** Learned input-gradient search, followed by bounded checks of a one-variable boundary pair. */
import type { FunctionTutorDecisionObservation, FunctionTutorInputAssignment } from "../functionTutor";
import type { NeuralInputSpace } from "./inputSpace";
import type { ScenarioNetwork } from "./network";
import type { NeuralBoundary } from "./types";
import { findDiscreteNeuralBoundary } from "./discreteSearch";

export type ObservedInput = { inputs: FunctionTutorInputAssignment[]; observations: Map<string, FunctionTutorDecisionObservation> };
export type MarginHead = { blockId: string; mean: number; scale: number };

/** Predictions choose the search point and coordinate; only the teacher can confirm an outcome. */
export function findNeuralBoundary(
  network: ScenarioNetwork, head: MarginHead, output: number, start: number[], space: NeuralInputSpace,
  observe: (x: number[]) => ObservedInput | undefined
): NeuralBoundary | undefined {
  let x = start.slice();
  if (space.dimensions.some((dimension) => dimension.choices)) {
    const discrete = findDiscreteNeuralBoundary(network, head, output, x, space, observe);
    if (discrete) return discrete;
  }
  const target = -head.mean / head.scale;
  for (let step = 0; step < 80; step += 1) {
    const residual = network.predict(space.features(x))[output] - target;
    const gradient = network.inputGradient(space.features(x), output).slice(0, x.length);
    const norm = gradient.reduce((sum, value, index) => sum + (space.dimensions[index].choices ? 0 : value * value), 1e-9);
    x = x.map((value, index) => space.dimensions[index].choices ? value : Math.max(-1, Math.min(1, value - Math.max(-0.2, Math.min(0.2, residual * gradient[index] / norm)))));
    if (Math.abs(residual) < 1e-5) break;
  }
  // Keep the explanatory pair simple: one numeric leaf changes, other numeric leaves are integral.
  x = x.map((value, index) => space.dimensions[index].choices ? value : Math.round(value * space.dimensions[index].scale) / space.dimensions[index].scale);
  const gradient = network.inputGradient(space.features(x), output).slice(0, x.length);
  const coordinates = gradient.map((value, index) => ({ index, value: space.dimensions[index].choices ? 0 : Math.abs(value) }))
    .filter((item) => item.value >= 1e-8).sort((a, b) => b.value - a.value).slice(0, 3);
  let best: NeuralBoundary | undefined;
  for (const coordinate of coordinates) {
    const boundary = refineCoordinate(x, coordinate.index, head, space, observe);
    // Shapes are identical; shorter value serialization favors integer pairs over optimizer fractions.
    if (boundary && (!best || JSON.stringify([boundary.inputs, boundary.neighbor]).length < JSON.stringify([best.inputs, best.neighbor]).length)) best = boundary;
  }
  return best;
}

/** A few learned coordinates allow a readable exact input when one coordinate only gives a repeating fraction. */
function refineCoordinate(x: number[], index: number, head: MarginHead, space: NeuralInputSpace,
  observe: (x: number[]) => ObservedInput | undefined): NeuralBoundary | undefined {
  const scale = space.dimensions[index].scale;
  const probe = (value: number) => observe(x.map((original, i) => i === index ? Math.max(-1, Math.min(1, value)) : original));
  const margin = (sample: ObservedInput | undefined) => { const observation = sample?.observations.get(head.blockId); return observation ? observation.left - observation.right : undefined; };
  let low = 0; let high = 0; let lowMargin: number | undefined; let highMargin: number | undefined;
  for (const radius of [Math.max(2 / scale, 0.002), 0.02, 0.2]) {
    low = Math.max(-1, x[index] - radius); high = Math.min(1, x[index] + radius);
    lowMargin = margin(probe(low)); highMargin = margin(probe(high));
    if (lowMargin !== undefined && highMargin !== undefined && lowMargin * highMargin <= 0) break;
    lowMargin = undefined;
  }
  if (lowMargin === undefined || highMargin === undefined) return undefined;
  let exactRoot: number | undefined;
  // Secant calibration can preserve representable affine equalities such as (1 / 3) * 3 === 1.
  if (highMargin !== lowMargin) {
    const calibrated = low - lowMargin * (high - low) / (highMargin - lowMargin);
    if (calibrated >= low && calibrated <= high && margin(probe(calibrated)) === 0) exactRoot = calibrated;
  }
  // Binary64 equalities can require more than 32 refinements to reach a representable root.
  for (let iteration = 0; iteration < 56; iteration += 1) {
    const middle = (low + high) / 2; const middleMargin = margin(probe(middle));
    if (middleMargin === undefined) return undefined;
    if (middleMargin === 0) { low = middle; high = middle; exactRoot = middle; break; }
    if (middleMargin * lowMargin <= 0) high = middle;
    else { low = middle; lowMargin = middleMargin; }
  }
  const root = (exactRoot ?? (low + high) / 2) * scale;
  // Prefer exact/small-decimal and integer neighbors; never present raw optimizer noise.
  const values = [...new Set([Number(root.toFixed(6)), Math.round(root), Math.floor(root), Math.ceil(root), Math.floor(root) - 1, Math.ceil(root) + 1, ...(exactRoot === undefined ? [] : [root])])];
  const samples = values.map((value) => probe(value / scale)).filter((sample): sample is ObservedInput => Boolean(sample?.observations.has(head.blockId)));
  for (let a = 0; a < samples.length; a += 1) {
    for (let b = a + 1; b < samples.length; b += 1) {
      if (samples[a].observations.get(head.blockId)!.outcome !== samples[b].observations.get(head.blockId)!.outcome) {
        return { blockId: head.blockId, inputs: samples[a].inputs, neighbor: samples[b].inputs };
      }
    }
  }
  return undefined;
}
