/** Fits small local input/condition relations and checks every proposed boundary against source IR. */
import { compileFunctionTutorInputDeclaration, evaluateFunctionTutorInputs, type FunctionTutorDecisionObservation, type FunctionTutorInputAssignment } from "../functionTutor";
import { createNeuralInputSpace } from "../neuralScenarios";
import type { FastScenarioBoundary, FastScenarioOptions, FastScenarioProblem, FastScenarioResult } from "./types";

type Probe = { vector: number[]; inputs: FunctionTutorInputAssignment[]; observations: Map<string, FunctionTutorDecisionObservation> };
const cache = new WeakMap<FastScenarioProblem["declaration"], Map<string, FastScenarioResult>>();

/** Starts from whole caller tuples, changes one coordinate and never executes project code. */
export async function inferFastScenarios(problem: FastScenarioProblem, options: FastScenarioOptions = {}): Promise<FastScenarioResult | undefined> {
  const started = performance.now();
  const cancelled = () => { if (options.signal?.aborted) throw new Error("fast-scenario-cancelled"); };
  cancelled();
  const declaration = problem.declaration;
  if (declaration.program.evaluationMode === "symbolic-only" || !["typescript", "javascript", "python"].includes(declaration.language)) return;
  const budget = Number.isFinite(options.maxEvaluations) ? Math.max(1, Math.min(192, Math.floor(options.maxEvaluations!))) : 192;
  // Snapshots own at most four cached requests. Caller/domain changes and search
  // budgets are part of the key; new source gets a different WeakMap owner.
  const key = JSON.stringify([budget, problem.examples.slice(0, 20), problem.domains]);
  const cacheable = key.length <= 96 * 1024;
  const previous = cacheable ? cache.get(declaration)?.get(key) : undefined;
  if (previous) return { boundaries: structuredClone(previous.boundaries), report: { ...previous.report, evaluations: 0, elapsedMs: performance.now() - started, cacheHit: true } };
  const space = createNeuralInputSpace({ ...problem, declaration: compileFunctionTutorInputDeclaration(declaration) }, { includeFeatures: false });
  if (!space) return;
  const probes = new Map<string, Probe>();
  const witnesses = new Map<string, Probe[]>();
  const pairs = new Map<string, { boundary: FastScenarioBoundary; distance: number }>();
  const pending: number[][] = [];
  const scheduled = new Set<string>();
  let evaluations = 0;
  const schedule = (vector: number[]) => {
    const identity = JSON.stringify(vector);
    if (pending.length < 16 && !scheduled.has(identity)) { scheduled.add(identity); pending.push(vector); }
  };
  for (const tuple of problem.examples.slice(0, 12)) { const vector = space.encode(tuple); if (vector) schedule(vector); }
  if (!pending.length) schedule(space.dimensions.map(() => 0));

  const evaluate = async (vector: number[]): Promise<Probe | undefined> => {
    cancelled();
    const inputs = space.decode(vector); const identity = JSON.stringify(inputs);
    if (probes.has(identity)) return probes.get(identity);
    if (evaluations >= budget) return;
    if (evaluations && evaluations % 32 === 0) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); cancelled(); }
    const observations = new Map<string, FunctionTutorDecisionObservation>(); const occurrences = new Map<string, number>();
    evaluateFunctionTutorInputs(declaration, inputs, { maxSteps: 128, maxLoopVisits: 8, observeDecision(observation) {
      const occurrence = occurrences.get(observation.blockId) ?? 0; occurrences.set(observation.blockId, occurrence + 1);
      if (occurrence < 3 && observations.size < 32) observations.set(observation.blockId + ":" + occurrence, observation);
    } });
    evaluations += 1;
    const probe = { vector, inputs, observations }; probes.set(identity, probe);
    let addsOutcome = false;
    for (const [id, observation] of observations) {
      if (!witnesses.has(id) && witnesses.size >= 32) continue;
      const records = witnesses.get(id) ?? [];
      if (!records.some((record) => record.observations.get(id)?.outcome === observation.outcome)) addsOutcome = true;
      for (const other of records) {
        if (other.observations.get(id)?.outcome === observation.outcome) continue;
        const changed = vector.map((value, index) => Math.abs(value - other.vector[index])).filter((value) => value > 0);
        if (changed.length !== 1) continue;
        const existing = pairs.get(id);
        if (existing && existing.distance <= changed[0]) continue;
        const occurrence = Number(id.slice(id.lastIndexOf(":") + 1));
        pairs.set(id, { distance: changed[0], boundary: { blockId: observation.blockId, occurrence, inputs: other.inputs, neighbor: inputs } });
      }
      // Keep both outcomes and recent near-boundary candidates, without an
      // unbounded corpus or one whole-function training loop per predicate.
      if (records.length >= 12) records.splice(2, 1);
      records.push(probe); witnesses.set(id, records);
    }
    if (addsOutcome) schedule(vector);
    return probe;
  };

  for (let cursor = 0; cursor < pending.length && evaluations < budget; cursor += 1) {
    const vector = pending[cursor]; const base = await evaluate(vector); if (!base) break;
    for (let index = 0; index < space.dimensions.length && evaluations < budget; index += 1) {
      const dimension = space.dimensions[index];
      const at = (coordinate: number) => vector.map((value, position) => position === index ? Math.max(-1, Math.min(1, coordinate)) : value);
      if (dimension.choices) {
        const count = dimension.choices.length;
        for (let choice = 0; choice < Math.min(count, 64) && evaluations < budget; choice += 1) await evaluate(at(count === 1 ? 0 : choice * 2 / (count - 1) - 1));
        continue;
      }
      const step = 1 / dimension.scale;
      const coordinate = vector[index];
      const offset = coordinate + step <= 1 ? step : -step;
      const nearby = await evaluate(at(coordinate + offset));
      if (nearby) for (const [id, observation] of base.observations) {
        const other = nearby.observations.get(id);
        if (!other || observation.metric || other.metric || observation.operator !== other.operator) continue;
        const margin = observation.left - observation.right;
        const slope = ((other.left - other.right) - margin) / offset;
        if (!Number.isFinite(slope) || Math.abs(slope) < 1e-12) continue;
        const estimate = coordinate - margin / slope;
        if (!Number.isFinite(estimate) || Math.abs(estimate) > 1) continue;
        // A fitted relation proposes values only. The source interpreter must
        // reach this same predicate with opposing outcomes to retain a pair.
        const candidates = [estimate, estimate - step, estimate + step, Math.floor(estimate * dimension.scale) / dimension.scale, Math.ceil(estimate * dimension.scale) / dimension.scale];
        for (const candidate of candidates) if (evaluations < budget) await evaluate(at(candidate));
      }
      for (const coordinate of [-1, 1, 0]) if (evaluations < budget) await evaluate(at(coordinate));
    }
  }
  cancelled();
  if (!witnesses.size) return;
  const result: FastScenarioResult = { boundaries: [...pairs.values()].slice(0, 4).map((item) => item.boundary),
    report: { evaluations, elapsedMs: performance.now() - started, cacheHit: false, limitReached: evaluations >= budget } };
  if (cacheable && JSON.stringify(result).length <= 96 * 1024) {
    const owned = cache.get(declaration) ?? new Map<string, FastScenarioResult>();
    owned.set(key, structuredClone(result)); while (owned.size > 4) owned.delete(owned.keys().next().value!); cache.set(declaration, owned);
  }
  return result;
}
