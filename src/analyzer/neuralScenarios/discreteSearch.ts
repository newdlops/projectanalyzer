/** Neural-ranked finite alternatives for strings, collections and categorical inputs. */
import type { NeuralInputSpace } from "./inputSpace";
import type { ScenarioNetwork } from "./network";
import type { MarginHead, ObservedInput } from "./search";
import type { NeuralBoundary } from "./types";
import type { FunctionTutorStaticValue as Value } from "../functionTutor";

/** Learned margins rank alternatives before any teacher probes; no prediction alone certifies a pair. */
export function findDiscreteNeuralBoundary(network: ScenarioNetwork, head: MarginHead, output: number, start: number[], space: NeuralInputSpace,
  observe: (vector: number[]) => ObservedInput | undefined): NeuralBoundary | undefined {
  const target = -head.mean / head.scale;
  let best: NeuralBoundary | undefined; let bestScore = [Infinity, Infinity, Infinity];
  for (let index = 0; index < space.dimensions.length; index += 1) {
    const dimension = space.dimensions[index]; if (!dimension.choices || dimension.choices.length < 2) continue;
    const ranked = dimension.choices.map((value, choice) => {
      const x = start.map((original, i) => i === index ? choice * 2 / (dimension.choices!.length - 1) - 1 : original);
      return { x, value, prediction: network.predict(space.features(x))[output] };
    }).sort((a, b) => Math.abs(a.prediction - target) - Math.abs(b.prediction - target));
    // Cover predicted near-boundary and opposite-side examples; keep teacher work finite.
    // Many text variants share a length and crowd out the other side of a length guard.
    // Keep the best neural prediction at each size as a separate diversity lane.
    const bySize = new Map<number, typeof ranked[number]>();
    for (const item of ranked) {
      const size = item.value.kind === "string" ? item.value.value.length : item.value.kind === "array" ? item.value.items.length : undefined;
      if (size !== undefined && !bySize.has(size)) bySize.set(size, item);
    }
    const candidates = [...new Map([...ranked.slice(0, 16), ...[...bySize.values()].slice(0, 12),
      ...ranked.filter((item) => item.prediction < target).slice(0, 8),
      ...ranked.filter((item) => item.prediction >= target).slice(0, 8), ...ranked.slice(-4)]
      .map((item) => [JSON.stringify(item.x), item])).values()];
    const observed: Array<{ sample: ObservedInput; value: Value; cost: number; margin: number }> = [];
    for (const candidate of candidates) {
      const sample = observe(candidate.x); if (!sample?.observations.has(head.blockId)) continue;
      const value = candidate.value;
      const cost = value.kind === "string" ? value.value.length + (value.value.length === 0 ? 2 : 0)
        : value.kind === "array" ? value.items.length : 1;
      const decision = sample.observations.get(head.blockId)!;
      const margin = decision.left - decision.right;
      for (const opposite of observed) {
        if (opposite.sample.observations.get(head.blockId)!.outcome === decision.outcome) continue;
        // Compare lexicographically: boundary proximity, minimal change, then compact text.
        const score = [(Math.abs(margin) + Math.abs(opposite.margin)) / head.scale, changeSize(value, opposite.value), cost + opposite.cost];
        const different = score.findIndex((part, i) => part !== bestScore[i]);
        if (different >= 0 && score[different] < bestScore[different]) {
          bestScore = score;
          best = { blockId: head.blockId, inputs: opposite.sample.inputs, neighbor: sample.inputs };
        }
      }
      observed.push({ sample, value, cost, margin });
    }
  }
  return best;
}

/** Smallest single changed span; avoids changing case/content just to demonstrate one extra character. */
function changeSize(left: Value, right: Value): number {
  if (left.kind === "string" && right.kind === "string") {
    const a = left.value; const b = right.value; let prefix = 0; let suffix = 0;
    while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix += 1;
    while (suffix < Math.min(a.length, b.length) - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix += 1;
    return Math.max(a.length, b.length) - prefix - suffix;
  }
  return left.kind === "array" && right.kind === "array" ? Math.abs(left.items.length - right.items.length) : 1;
}
