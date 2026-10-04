/** Real source, caller tuples and supported-prefix tests for the fast local scenario model. */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFunctionTutorInputs } from "../../analyzer/functionTutor";
import { inferFastScenarios } from "../../analyzer/fastScenarios";
import { createNeuralScenarioProblem } from "../../application/scenarioInputs";
import { buildInputModel } from "./helpers/neuralScenarioFixtures";

test("fast inference solves a calculated equality without CPU training", async () => {
  const model = await buildInputModel('export function inspect(x: number, y: number) {\n let score = x * 3;\n score += y;\n if (score === 137) return "rare";\n return "ordinary";\n}');
  const result = await inferFastScenarios(createNeuralScenarioProblem(model));
  assert.ok(result?.boundaries.length);
  assert.ok(result.report.evaluations <= 192);
  assert.ok(result.boundaries.some((pair) => [pair.inputs, pair.neighbor].some((inputs) => {
    const value = evaluateFunctionTutorInputs(model.declaration, inputs).terminal?.value;
    return value?.kind === "string" && value.value === "rare";
  })));
  for (const pair of result.boundaries) {
    const outcomes = [pair.inputs, pair.neighbor].map((inputs) => evaluateFunctionTutorInputs(model.declaration, inputs).decisions.find((item) => item.blockId === pair.blockId)?.outcome);
    assert.ok(outcomes[0] && outcomes[1]); assert.notEqual(outcomes[0], outcomes[1]);
  }
});

test("pure internal function code supplies calculated operands to the fast model", async () => {
  const model = await buildInputModel('function adjusted(value: number) {\n const score = value * 7;\n return score - 11;\n}\nexport function inspect(x: number) {\n const score = adjusted(x);\n if (score === 150) return "rare";\n return "ordinary";\n}');
  const evaluated = evaluateFunctionTutorInputs(model.declaration, [{ parameterId: model.declaration.parameters[0].id, value: { kind: "number", value: 23 } }]);
  assert.equal(evaluated.status, "verified");
  assert.deepEqual(evaluated.terminal?.value, { kind: "string", value: "rare" });
  const result = await inferFastScenarios(createNeuralScenarioProblem(model));
  assert.ok(result?.boundaries.some((pair) => [pair.inputs, pair.neighbor].some((inputs) => inputs[0].value.kind === "number" && inputs[0].value.value === 23)));
});

test("boundary mutations preserve unrelated fields and start from a complete caller tuple", async () => {
  const model = await buildInputModel('export function inspect(input: { amount: number; offset: number; label: string }) {\n const adjusted = input.amount * 4 + input.offset;\n if (adjusted === 61) return 1;\n return 0;\n}');
  const problem = createNeuralScenarioProblem(model);
  problem.examples = [[{ parameterId: model.declaration.parameters[0].id, value: { kind: "object", truncated: false,
    entries: [{ key: "amount", value: { kind: "number", value: 7 } }, { key: "offset", value: { kind: "number", value: 1 } }, { key: "label", value: { kind: "string", value: "actual-caller" } }] } }]];
  const result = await inferFastScenarios(problem); assert.ok(result?.boundaries.length);
  const value = result.boundaries[0].inputs[0].value; assert.equal(value.kind, "object");
  if (value.kind === "object") assert.deepEqual(value.entries.find((item) => item.key === "label")?.value, { kind: "string", value: "actual-caller" });
});

test("repeated inference reuses bounded results and cannot expose mutable cached tuples", async () => {
  const model = await buildInputModel('export function inspect(x: number) {\n if (x * 3 === 137) return 1;\n return 0;\n}');
  const problem = createNeuralScenarioProblem(model);
  const first = await inferFastScenarios(problem); assert.ok(first?.boundaries.length);
  const original = structuredClone(first.boundaries);
  first.boundaries[0].inputs[0].value = { kind: "number", value: -999 };
  const second = await inferFastScenarios(problem); assert.ok(second);
  assert.deepEqual(second.boundaries, original); assert.equal(second.report.cacheHit, true); assert.equal(second.report.evaluations, 0);
  const changed = await buildInputModel('export function inspect(x: number) {\n if (x * 3 === 141) return 1;\n return 0;\n}');
  assert.equal((await inferFastScenarios(createNeuralScenarioProblem(changed)))?.report.cacheHit, false);
});

test("unreachable predicates, recursive helpers and external effects produce no fabricated witnesses", async () => {
  for (const source of [
    'export function inspect(x: number) {\n const score = external(x);\n if (score > 17) return 1;\n return 0;\n}',
    'function recur(x: number): number {\n return recur(x);\n}\nexport function inspect(x: number) {\n const score = recur(x);\n if (score > 17) return 1;\n return 0;\n}'
  ]) {
    const model = await buildInputModel(source);
    assert.equal((await inferFastScenarios(createNeuralScenarioProblem(model)))?.boundaries.length ?? 0, 0);
    assert.equal(evaluateFunctionTutorInputs(model.declaration, [{ parameterId: model.declaration.parameters[0].id, value: { kind: "number", value: 20 } }]).status, "partial");
  }
  const model = await buildInputModel('export function inspect(x: number) {\n if (x > 10) {\n if (x < 5) return "impossible";\n }\n return "ordinary";\n}');
  const result = await inferFastScenarios(createNeuralScenarioProblem(model)); assert.ok(result);
  for (const pair of result.boundaries) for (const inputs of [pair.inputs, pair.neighbor]) assert.notDeepEqual(evaluateFunctionTutorInputs(model.declaration, inputs).terminal?.value, { kind: "string", value: "impossible" });
});

test("fast requests honor cancellation even on a cache hit and enforce a probe budget", async () => {
  const model = await buildInputModel('export function inspect(x: number) {\n if (x * 7 === 173) return 1;\n return 0;\n}');
  const problem = createNeuralScenarioProblem(model);
  await inferFastScenarios(problem);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inferFastScenarios(problem, { signal: controller.signal }), /cancelled/u);
  const tiny = await inferFastScenarios(problem, { maxEvaluations: 2 });
  assert.ok(tiny && tiny.report.evaluations <= 2);
});
