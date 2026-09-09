/** Input-search regressions use real adapters, learned weights and independent condition/value checks. */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFunctionTutorInputs } from "../../analyzer/functionTutor";
import { inferNeuralScenarios } from "../../analyzer/neuralScenarios";
import { createNeuralInputSpace } from "../../analyzer/neuralScenarios/inputSpace";
import { createNeuralScenarioProblem } from "../../application/scenarioInputs";
import { buildInputModel } from "./helpers/neuralScenarioFixtures";

test("Python signatures share a bounded feature budget without dropping later text parameters", async () => {
  const names = Array.from({ length: 16 }, (_, index) => "arg" + index);
  const source = "def inspect(" + names.map((name) => name + ": str").join(", ") + "):\n    if arg0 == arg15:\n        return 1\n    return 0\n";
  const space = createNeuralInputSpace(createNeuralScenarioProblem(await buildInputModel(source, "python"))); assert.ok(space);
  assert.equal(space.dimensions.length, 16); assert.ok(space.featureCount <= 192);
  const base = space.dimensions.map(() => -1); const changed = base.slice(); changed[15] = 1;
  assert.equal(space.features(base).length, space.featureCount);
  assert.notDeepEqual(space.features(base), space.features(changed));
  assert.notDeepEqual(space.decode(base)[15].value, space.decode(changed)[15].value);
});

test("Python integer domains include bytecode constants and never train on fractional int parameters", async () => {
  const model = await buildInputModel('def inspect(count: int):\n    score = count * 11 + 7\n    if score >= 11007:\n        return "reached"\n    return "ordinary"\n', "python");
  const space = createNeuralInputSpace(createNeuralScenarioProblem(model)); assert.ok(space);
  assert.ok(space.dimensions[0].scale >= 1000);
  for (const coordinate of [-1, -0.23451, 0, 0.13847, 1]) {
    const decoded = space.decode([coordinate]); const value = decoded[0].value;
    assert.ok(value.kind === "number" && Number.isInteger(value.value));
    assert.deepEqual(space.decode(space.encode(decoded)!), decoded);
  }
});

test("helper and composed-string evidence keeps comparison inputs and excludes return-only labels", async () => {
  const model = await buildInputModel('def qualify(value: str):\n    return "role/" + value\ndef inspect(role: str, zone: str):\n    label = qualify(role)\n    if label == "role/operator" and zone == "west":\n        return "do-not-use-output"\n    return "nor-this-result"\n', "python");
  const space = createNeuralInputSpace(createNeuralScenarioProblem(model)); assert.ok(space);
  const choices = space.dimensions.map((dimension) => dimension.choices?.flatMap((value) => value.kind === "string" ? [value.value] : []) ?? []);
  assert.ok(choices[0].includes("operator")); assert.ok(choices[1].includes("west"));
  assert.ok(!choices.flat().some((value) => value.includes("do-not-use-output") || value.includes("nor-this-result")));
});

test("numeric normalization preserves integer equality inputs without rounding fractional guards", async () => {
  const model = await buildInputModel('export function inspect(x: number) {\n if (x === 215) return 1;\n return 0;\n}');
  const space = createNeuralInputSpace(createNeuralScenarioProblem(model)); assert.ok(space);
  assert.equal(space.dimensions[0].scale, 512);
  for (const number of [31, -116, 1 / 3]) {
    const tuple = [{ parameterId: model.declaration.parameters[0].id, value: { kind: "number" as const, value: number }, omitted: false }];
    const encoded = space.encode(tuple); assert.ok(encoded, String(number));
    assert.deepEqual(space.decode(encoded), tuple);
  }
});

const regressions = [
  { name: "large Python integer", language: "python" as const, source: 'def inspect(count: int):\n    score = count * 11 + 7\n    if score >= 11007:\n        return "reached"\n    return "ordinary"\n' },
  { name: "Python integer loop", language: "python" as const, source: 'def inspect(count: int):\n    total = 0\n    for i in range(count):\n        total += i\n    if total >= 66:\n        return "reached"\n    return "ordinary"\n' },
  { name: "two Python text parameters", language: "python" as const, source: 'def inspect(scheme: str, token: str):\n    if scheme == "Token" and token == "access.key":\n        return "reached"\n    return "ordinary"\n' },
  { name: "derived Python text", language: "python" as const, source: 'def inspect(role: str):\n    value = "scope/" + role\n    if value == "scope/operator":\n        return "reached"\n    return "ordinary"\n' },
  { name: "composed TypeScript text", language: "typescript" as const, source: 'export function inspect(team: string, status: string) {\n const value = team + "-" + status;\n if (value === "core-enabled") return "reached";\n return "ordinary";\n}' },
  { name: "three nested derived equalities", language: "typescript" as const, source: 'export function inspect(x: number, y: number, z: number) {\n if (x * 5 + 3 === 188) {\n  if (y * 7 - 2 === 215) {\n   if (z * 3 + 4 === 55) return "reached";\n  }\n }\n return "ordinary";\n}' },
  { name: "fractional outer equality", language: "typescript" as const, source: 'export function inspect(x: number, y: number) {\n if (x * 3 === 1) {\n  if (y * 3 + 4 === 64) return "reached";\n }\n return "ordinary";\n}' }
];
for (const fixture of regressions) test("learned parameter search reaches " + fixture.name, async () => {
  const model = await buildInputModel(fixture.source, fixture.language);
  const result = await inferNeuralScenarios(createNeuralScenarioProblem(model)); assert.ok(result, fixture.name);
  assert.ok(result.report.evaluations <= 1400); assert.ok(result.report.trainingSamples + result.report.validationSamples <= 800);
  assert.ok(result.report.finalLoss < result.report.initialLoss * 0.1);
  const reached = result.boundaries.flatMap((pair) => [pair.inputs, pair.neighbor]).map((inputs) => evaluateFunctionTutorInputs(model.declaration, inputs));
  assert.ok(reached.some((evaluation) => evaluation.status === "verified" && evaluation.terminal?.value?.kind === "string" && evaluation.terminal.value.value === "reached"), JSON.stringify(result));
  for (const pair of result.boundaries) {
    const outcomes = [pair.inputs, pair.neighbor].map((inputs) => evaluateFunctionTutorInputs(model.declaration, inputs).decisions.filter((decision) => decision.blockId === pair.blockId)[pair.occurrence ?? 0]?.outcome);
    assert.ok(outcomes[0] && outcomes[1]); assert.notEqual(outcomes[0], outcomes[1]);
  }
  if (fixture.name === "three nested derived equalities") {
    assert.equal(result.boundaries.length, 3);
    assert.ok(result.report.epochs > 240, "newly reached guards must be learned in a later stage");
  }
});
