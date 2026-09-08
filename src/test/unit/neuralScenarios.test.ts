/** Real learning, differentiation, typed input and static-boundary tests; no external model mocks. */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFunctionTutorInputs } from "../../analyzer/functionTutor";
import { inferNeuralScenarios } from "../../analyzer/neuralScenarios";
import { ScenarioNetwork, createNeuralRandom } from "../../analyzer/neuralScenarios/network";
import { createNeuralInputSpace } from "../../analyzer/neuralScenarios/inputSpace";
import { createLocalNeuralScenarioProvider, createNeuralScenarioProblem, parseScenarioInputSuggestions } from "../../application/scenarioInputs";
import { buildInputModel } from "./helpers/neuralScenarioFixtures";

test("our network updates weights, generalizes a held-out value relation and exposes correct input gradients", async () => {
  const network = new ScenarioNetwork(2, 2, createNeuralRandom(9));
  const random = createNeuralRandom(11);
  const relation = (x: number[]) => 0.7 * x[0] - 1.3 * x[1] + 0.2;
  const rows = Array.from({ length: 96 }, () => { const x = [random() * 2 - 1, random() * 2 - 1]; return { x, y: [relation(x), undefined] }; });
  const before = network.weights.slice(); const initial = network.loss(rows);
  await network.train(rows, 240);
  assert.ok(network.loss(rows) < initial * 0.01);
  assert.notDeepEqual(network.weights, before);
  const unseen = [0.375, -0.817];
  assert.ok(Math.abs(network.predict(unseen)[0] - relation(unseen)) < 0.03);
  const gradient = network.inputGradient(unseen, 0);
  for (let index = 0; index < 2; index += 1) {
    const left = unseen.slice(); const right = unseen.slice(); left[index] -= 1e-5; right[index] += 1e-5;
    assert.ok(Math.abs(gradient[index] - (network.predict(right)[0] - network.predict(left)[0]) / 2e-5) < 1e-6);
  }
  const repeat = new ScenarioNetwork(2, 2, createNeuralRandom(9)); await repeat.train(rows, 240);
  assert.deepEqual(repeat.weights, network.weights);
});

test("teacher labels calculated operands after assignments and masks unreachable comparisons", async () => {
  const model = await buildInputModel('export function inspect(x: number) {\n let score = x * 3;\n score += 7;\n if (score > 100) return 1;\n if (score < 0) return 2;\n return 0;\n}');
  const observations: Array<{ left: number; right: number }> = [];
  evaluateFunctionTutorInputs(model.declaration, [{ parameterId: model.declaration.parameters[0].id, value: { kind: "number", value: 40 } }], { observeDecision: (item) => observations.push(item) });
  assert.deepEqual(observations.map(({ left, right }) => [left, right]), [[127, 100]]);
});

test("weight training itself remains cancellable after updates begin", async () => {
  const network = new ScenarioNetwork(4, 2); const before = network.weights.slice();
  const rows = Array.from({ length: 320 }, (_, index) => ({ x: [index / 320, 0.2, -0.4, 0.9], y: [index / 640, undefined] }));
  const controller = new AbortController(); const training = network.train(rows, 400, controller.signal);
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(training, /neural-cancelled/u); assert.notDeepEqual(network.weights, before);
});

test("contradictory earlier guards cannot produce a fabricated neural boundary", async () => {
  const model = await buildInputModel('export function inspect(x: number) {\n if (x > 10) {\n if (x < 5) return "impossible";\n }\n return "ordinary";\n}');
  const response = await createLocalNeuralScenarioProvider().suggest(model, "en", new AbortController().signal);
  for (const pair of response.boundaries ?? []) for (const inputs of [pair.inputs, pair.neighbor]) {
    assert.notDeepEqual(evaluateFunctionTutorInputs(model.declaration, inputs).terminal?.value, { kind: "string", value: "impossible" });
  }
  assert.ok(response.boundaries?.length === 1, JSON.stringify(response));
});

test("trained inference finds a derived-input boundary and independently verifies both outcomes", async () => {
  const model = await buildInputModel('export function inspect(x: number, y: number) {\n let score = x * 3;\n score += y;\n if (score === 137) return "rare";\n return "ordinary";\n}');
  const response = await createLocalNeuralScenarioProvider().suggest(model, "ko", new AbortController().signal);
  assert.ok(response.training && response.training.finalLoss < response.training.initialLoss * 0.02, JSON.stringify(response));
  assert.ok(response.training.validationError < 0.1);
  assert.equal(response.training.trainingSamples, 320); assert.equal(response.training.validationSamples, 80);
  assert.ok(response.training.evaluations <= 1400);
  assert.ok(response.boundaries?.length, JSON.stringify(response));
  const parsed = parseScenarioInputSuggestions(response.text, model, response.boundaries);
  assert.ok(parsed.accepted >= 1, JSON.stringify({ response, parsed }));
  assert.ok(parsed.seeds.some((seed) => seed.quality?.evaluation.terminal?.value?.kind === "string" && seed.quality.evaluation.terminal.value.value === "rare"));
  for (const boundary of response.boundaries!) {
    const values = [boundary.inputs, boundary.neighbor].map((inputs) => evaluateFunctionTutorInputs(model.declaration, inputs).decisions.find((item) => item.blockId === boundary.blockId)?.outcome);
    assert.ok(values[0] && values[1]); assert.notEqual(values[0], values[1]);
  }
  const duplicate = parseScenarioInputSuggestions(response.text, { ...model, seeds: [...model.seeds, ...parsed.seeds] }, response.boundaries);
  assert.equal(duplicate.accepted, 0);
});

test("neural boundaries retain required object fields and complete caller correlations", async () => {
  const model = await buildInputModel('export function inspect(input: { amount: number; offset: number; label: string }) {\n const adjusted = input.amount * 4 + input.offset;\n if (adjusted >= 61) return 1;\n return 0;\n}');
  const problem = createNeuralScenarioProblem(model); const space = createNeuralInputSpace(problem); assert.ok(space);
  for (const example of problem.examples) {
    const encoded = space.encode(example);
    if (encoded) assert.deepEqual(space.decode(encoded).map((input) => input.value), example.map((input) => input.value));
  }
  const response = await createLocalNeuralScenarioProvider().suggest(model, "en", new AbortController().signal);
  assert.ok(response.boundaries?.length, response.text);
  const parsed = parseScenarioInputSuggestions(response.text, model, response.boundaries); assert.ok(parsed.accepted);
  for (const seed of parsed.seeds) {
    const value = seed.inputs[0].value; assert.equal(value.kind, "object");
    if (value.kind === "object") assert.ok(value.entries.some((entry) => entry.key === "label" && entry.value.kind === "string"));
  }
});

test("fractional boundaries keep exact explanatory digits instead of hiding the changed input", async () => {
  const model = await buildInputModel('export function inspect(x: number) {\n const score = x * 3;\n if (score === 1) return "rare";\n return "ordinary";\n}');
  const response = await createLocalNeuralScenarioProvider().suggest(model, "en", new AbortController().signal);
  assert.ok(response.boundaries?.length, JSON.stringify(response));
  const proposals = JSON.parse(response.text).scenarios as Array<{ title: string; inputs: { x: number }; reason: string }>;
  assert.equal(proposals.length, 2); assert.notEqual(proposals[0].inputs.x, proposals[1].inputs.x);
  for (const proposal of proposals) assert.ok(proposal.title.includes(String(proposal.inputs.x)), proposal.title);
  assert.notEqual(proposals[0].title, proposals[1].title);
  assert.ok(proposals.every((proposal) => proposal.reason.includes(String(proposals[0].inputs.x)) && proposal.reason.includes(String(proposals[1].inputs.x))));
});

test("false boundary witnesses cannot make ordinary inputs useful", async () => {
  const model = await buildInputModel('export function inspect(x: number) {\n if (x < 0) return 1;\n return 0;\n}');
  const blockId = model.declaration.program.blocks.find((block) => block.decision)!.blockId;
  const tuple = (value: number) => [{ parameterId: model.declaration.parameters[0].id, value: { kind: "number" as const, value } }];
  const text = JSON.stringify({ scenarios: [{ title: "Ordinary", reason: "Should not be accepted", inputs: { x: 123 } }] });
  assert.equal(parseScenarioInputSuggestions(text, model, [{ blockId, inputs: tuple(123), neighbor: tuple(124) }]).accepted, 0);
  assert.equal(parseScenarioInputSuggestions(text, model, [{ blockId: "missing", inputs: tuple(123), neighbor: tuple(-1) }]).accepted, 0);
});

test("local training yields to cancellation and unsupported external state produces no invented labels", async () => {
  const provider = createLocalNeuralScenarioProvider();
  const model = await buildInputModel('export function inspect(x: number) {\n if (x * 3 > 137) return 1;\n return 0;\n}');
  const controller = new AbortController();
  const pending = provider.suggest(model, "en", controller.signal); setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, /cancelled/u);
  await assert.rejects(provider.suggest(model, "en", controller.signal), /cancelled/u);
  for (const source of [
    'export function inspect(x: number) {\n const y = external(x);\n if (y > 9) return 1;\n return 0;\n}',
    'export function inspect(x: number) {\n return x;\n}'
  ]) {
    const unsupported = await buildInputModel(source);
    assert.equal(await inferNeuralScenarios(createNeuralScenarioProblem(unsupported)), undefined);
  }
  const otherLanguage = createNeuralScenarioProblem(model); otherLanguage.declaration.language = "python";
  assert.equal(await inferNeuralScenarios(otherLanguage), undefined);
});
