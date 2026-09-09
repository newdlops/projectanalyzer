/** Regression fixtures for nontrivial text/collection inputs and neural ranking of discrete alternatives. */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFunctionTutorInputs } from "../../analyzer/functionTutor";
import { createNeuralInputSpace } from "../../analyzer/neuralScenarios/inputSpace";
import { createNeuralScenarioProblem, createLocalNeuralScenarioProvider, parseScenarioInputSuggestions } from "../../application/scenarioInputs";
import { buildInputModel } from "./helpers/neuralScenarioFixtures";

async function infer(source: string) {
  const model = await buildInputModel(source);
  const response = await createLocalNeuralScenarioProvider().suggest(model, "en", new AbortController().signal);
  assert.ok(response.training && response.training.finalLoss < response.training.initialLoss, JSON.stringify(response));
  const checked = parseScenarioInputSuggestions(response.text, model, response.boundaries);
  return { model, response, checked };
}

test("string length varies through calculated values instead of staying at the empty baseline", async () => {
  const { model, response, checked } = await infer('export function inspect(name: string) {\n const size = name.length * 3 + 2;\n if (size >= 23) return "long";\n return "short";\n}');
  assert.ok(response.boundaries?.length, JSON.stringify(response)); assert.ok(checked.accepted, JSON.stringify(checked));
  const lengths = response.boundaries.flatMap((pair) => [pair.inputs, pair.neighbor]).map((inputs) => { const value = inputs[0].value; assert.equal(value.kind, "string"); return value.kind === "string" ? value.value.length : -1; });
  assert.ok(lengths.includes(6) && lengths.includes(7), JSON.stringify(lengths));
  const texts = response.boundaries.flatMap((pair) => [pair.inputs[0].value, pair.neighbor[0].value]).flatMap((value) => value.kind === "string" ? [value.value] : []);
  const shorter = texts.find((value) => value.length === 6)!; const longer = texts.find((value) => value.length === 7)!;
  assert.ok([...longer].some((_, index) => longer.slice(0, index) + longer.slice(index + 1) === shorter), JSON.stringify(texts));
  assert.ok(checked.seeds.every((seed) => evaluateFunctionTutorInputs(model.declaration, seed.inputs).status === "verified"));
});

test("a derived string comparison yields the required token and a checked near miss", async () => {
  const { model, response, checked } = await infer('export function inspect(name: string) {\n const key = "pkg:" + name;\n if (key === "pkg:admin") return "matched";\n return "rejected";\n}');
  assert.ok(response.boundaries?.length, JSON.stringify(response)); assert.ok(checked.accepted, JSON.stringify(checked));
  const results = response.boundaries.flatMap((pair) => [pair.inputs, pair.neighbor]).map((inputs) => evaluateFunctionTutorInputs(model.declaration, inputs).terminal?.value);
  assert.ok(results.some((value) => value?.kind === "string" && value.value === "matched"));
  assert.ok(results.some((value) => value?.kind === "string" && value.value === "rejected"));
  assert.ok(JSON.parse(response.text).scenarios.some((item: { inputs: { name: string } }) => item.inputs.name === "admin"));
  assert.ok(JSON.parse(response.text).scenarios.every((item: { reason: string }) => item.reason.includes('"pkg:admin"')));
});

test("collection inputs cross a nonzero length threshold while retaining element types", async () => {
  const { response } = await infer('export function inspect(items: number[]) {\n if (items.length >= 4) return "batch";\n return "small";\n}');
  assert.ok(response.boundaries?.length, JSON.stringify(response));
  const arrays = response.boundaries.flatMap((pair) => [pair.inputs[0].value, pair.neighbor[0].value]);
  assert.ok(arrays.every((value) => value.kind === "array" && value.items.every((item) => item.kind === "number")));
  assert.ok(arrays.some((value) => value.kind === "array" && value.items.length === 3));
  assert.ok(arrays.some((value) => value.kind === "array" && value.items.length === 4));
});

test("whole caller string alternatives round-trip instead of being rejected against one frozen string", async () => {
  const model = await buildInputModel('export function inspect(name: string, count: number) {\n if (name.length > count) return 1;\n return 0;\n}');
  const problem = createNeuralScenarioProblem(model);
  const examples = ["caller-A", "caller-B-extended"].map((name, index) => [
    { parameterId: model.declaration.parameters[0].id, value: { kind: "string" as const, value: name } },
    { parameterId: model.declaration.parameters[1].id, value: { kind: "number" as const, value: index + 2 } }
  ]);
  problem.examples.unshift(...examples); const space = createNeuralInputSpace(problem); assert.ok(space);
  for (const example of examples) { const encoded = space.encode(example); assert.ok(encoded); assert.deepEqual(space.decode(encoded).map((item) => item.value), example.map((item) => item.value)); }
  const stringChoices = space.dimensions.flatMap((dimension) => dimension.choices ?? []).filter((value) => value.kind === "string");
  assert.ok(!stringChoices.some((value) => value.kind === "string" && value.value === "matched"));
});

test("variable array sizes preserve learned numeric element changes", async () => {
  const { model, response, checked } = await infer('export function inspect(items: number[]) {\n if (items.length === 0) return "empty";\n const score = items[0] * 3;\n if (score === 57) return "rare";\n return "ordinary";\n}');
  assert.ok(response.boundaries?.length, JSON.stringify(response));
  assert.ok(checked.seeds.some((seed) => evaluateFunctionTutorInputs(model.declaration, seed.inputs).terminal?.value?.kind === "string"
    && seed.quality?.evaluation.terminal?.value?.kind === "string" && seed.quality.evaluation.terminal.value.value === "rare"), JSON.stringify(response));
});

test("unsupported string method results never become fabricated neural labels", async () => {
  const model = await buildInputModel('export function inspect(name: string) {\n const normalized = name.trim();\n if (normalized === "admin") return "ready";\n return "rejected";\n}');
  await assert.rejects(createLocalNeuralScenarioProvider().suggest(model, "en", new AbortController().signal), /unavailable/u);
});

test("empty guards retain a nonempty partner and deeper length cases", async () => {
  const { response } = await infer('export function inspect(name: string) {\n if (name === "") return "empty";\n if (name.length < 5) return "short";\n return "ready";\n}');
  assert.ok((response.boundaries?.length ?? 0) >= 2, JSON.stringify(response));
  for (const pair of response.boundaries!) assert.ok([pair.inputs, pair.neighbor].some((inputs) => inputs[0].value.kind === "string" && inputs[0].value.value.length > 0));
});

test("long text boundaries keep reviewable distinct descriptions within protocol limits", async () => {
  const token = "account/" + "reviewer".repeat(12);
  const name = "accountIdentifierForTheSelectedReviewAssignment";
  const { response, checked } = await infer(`export function inspect(${name}: string) {\n if (${name} === ${JSON.stringify(token)}) return "matched";\n return "rejected";\n}`);
  assert.ok(checked.accepted, JSON.stringify(response));
  const scenarios = JSON.parse(response.text).scenarios;
  assert.ok(scenarios.every((item: { reason: string }) => item.reason.length <= 700));
  assert.notEqual(scenarios[0].title, scenarios[1].title);
});

test("string vocabulary excludes unrelated return-only text", async () => {
  const model = await buildInputModel('export function inspect(name: string) {\n if (name.length > 3) return "PRIVATE_RETURN_ONLY_TOKEN";\n return "another-return";\n}');
  const space = createNeuralInputSpace(createNeuralScenarioProblem(model)); assert.ok(space);
  const values = space.dimensions.flatMap((dimension) => dimension.choices ?? []);
  assert.ok(!values.some((value) => value.kind === "string" && /PRIVATE_RETURN|another-return/u.test(value.value)));
});
