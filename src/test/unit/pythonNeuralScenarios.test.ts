/** Python source fixtures exercise real bytecode, learned input boundaries, opaque replay and safe unsupported states. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { evaluateFunctionTutorInputs } from "../../analyzer/functionTutor";
import { createLocalNeuralScenarioProvider, parseScenarioInputSuggestions } from "../../application/scenarioInputs";
import { createFunctionTutorPayload } from "../../application/codeFlow/functionTutor/functionTutorProjection";
import { createPythonRegexRuntime, createPythonScenarioRuntime } from "../../shared/pythonScenario";
import { getPythonScenarioBrowserSource } from "../../webview/codeFlow/scenarioEvaluation/pythonScenarioBrowserSource";
import { getFunctionLogicScenarioEvaluationBrowserSource } from "../../webview/codeFlow/scenarioEvaluation";
import { getFunctionLogicScenarioEvaluatorBrowserSource } from "../../webview/codeFlow/valuePreview";
import { getFunctionLogicScenarioWorkspaceBrowserSource } from "../../webview/codeFlow/scenarioWorkspace";
import { getFunctionTutorBrowserSource } from "../../webview/codeFlow/tutor";
import { buildInputModel } from "./helpers/neuralScenarioFixtures";

const source = readFileSync(resolve("src/test/fixtures/functionLogic/scenario_python_codes.py"), "utf8");
const runtime = createPythonScenarioRuntime(createPythonRegexRuntime());
const modelPromise = buildInputModel(source, "python");

test("Python regex, helper checksum, duplicate removal and labeled priority retain exact value changes", async () => {
  const model = await modelPromise; const program = model.declaration.program.python; assert.ok(program);
  for (const [input, expected] of [
    ["", []], ["no code", []], ["12340", []], ["12 - 349", ["12349"]],
    ["12349\n12349", ["12349"]], ["12349\nC O D E: 12-355", ["12355", "12349"]]
  ] as Array<[string, string[]]>) {
    const result = runtime.evaluate(program, new Map([["text", input]]));
    assert.equal(result.status, "verified", JSON.stringify(result));
    assert.deepEqual(result.terminal?.value, expected);
    assert.ok(result.blockIds.every((id) => model.functionLogic.blocks.some((block) => block.id === id)));
    // Each consecutive occurrence follows a real analyzer edge, including comprehensions and continue.
    for (let index = 0; index < result.blockIds.length - 1; index += 1) assert.ok(program.edges.some((edge) => edge.sourceBlockId === result.blockIds[index] && edge.targetBlockId === result.blockIds[index + 1]), JSON.stringify(result.blockIds));
  }
  const duplicate = runtime.evaluate(program, new Map([["text", "12349\n12349"]]));
  const guard = model.functionLogic.blocks.find((block) => block.label.startsWith("if not valid_code"))!;
  assert.deepEqual(duplicate.decisions.filter((item) => item.blockId === guard.id).map((item) => item.outcome), ["false", "true"]);
  const found = program.bindings.find((binding) => binding.name === "found")!;
  const writes = duplicate.transitions.filter((change) => change.bindingId === found.bindingId);
  assert.deepEqual(writes.map((write) => write.after), [[], ["12349"]]);
  const observations = duplicate.observations.filter((item) => item.blockId === guard.id);
  assert.deepEqual([observations[0].left, observations[0].right], [9, 9]);
});

test("Python semantics preserve short circuit, floor division, modulo, codepoint length and comprehension scope", async () => {
  const model = await buildInputModel('def inspect(text: str):\n    d = 99\n    values = [d for d in (1, 2, 3) if d > 1]\n    if not text or len(text) < 2:\n        return [-7 // 3, -7 % 3, d, values, [None][0]]\n    return len(text)\n', "python");
  const result = runtime.evaluate(model.declaration.program.python!, new Map([["text", "😀"]]));
  assert.equal(result.status, "verified", JSON.stringify(result));
  assert.deepEqual(result.terminal?.value, [-3, 2, 99, [2, 3], null]);
  const shortCircuit = await buildInputModel('def inspect(text: str):\n    if not text or external(text):\n        return 1\n    return 0\n', "python");
  assert.equal(runtime.evaluate(shortCircuit.declaration.program.python!, new Map([["text", ""]])).terminal?.value, 1);
  assert.equal(runtime.evaluate(shortCircuit.declaration.program.python!, new Map([["text", "x"]])).status, "partial");
});

test("Python unsupported source, mutated module state, recursion and work exhaustion never become verified labels", async () => {
  for (const source of [
    'import custom as len\ndef inspect(text: str):\n    return len(text)\n',
    'def inspect(text: str):\n    return inspect(text)\n',
    'def inspect(text: str):\n    values = (1, 2)\n    values.append(3)\n    return values\n',
    'def inspect(text: str):\n    return 3 < len(text) < 8\n',
    'VALUES = [1]\ndef inspect(text: str):\n    return VALUES\n',
    'def inspect(text: str):\n    x = y = 1\n    return y\n'
  ]) {
    const model = await buildInputModel(source, "python");
    assert.equal(evaluateFunctionTutorInputs(model.declaration, [{ parameterId: model.declaration.parameters[0].id, value: { kind: "string", value: "hello" } }]).status, "partial", source);
  }
  const model = await modelPromise;
  assert.equal(runtime.evaluate(model.declaration.program.python!, new Map([["text", "12349"]]), { maxSteps: 4 }).reason, "step-budget");
  assert.equal(runtime.evaluate(model.declaration.program.python!, new Map([["text", "12349\n12349"]]), { maxLoopVisits: 1 }).reason, "loop-budget");
  assert.equal(runtime.evaluate(model.declaration.program.python!, new Map()).reason, "unknown-input");
});

test("bounded Python regex semantics include captures, whitespace, digit lookarounds and explicit unsupported patterns", () => {
  const regex = createPythonRegexRuntime();
  const pattern = String.raw`(?<!\d)(\d{2})\s*-?\s*(\d{3})(?!\d)`;
  assert.deepEqual(regex.matches(pattern, "item 12 - 349"), [{ text: "12 - 349", groups: ["12", "349"] }]);
  assert.deepEqual(regex.matches(pattern, "112349 123499"), []);
  assert.equal(regex.matches(String.raw`C\s*O\s*D\s*E`, "C\u001cO\u0085D E").length, 1);
  assert.ok(regex.candidates(pattern).includes("12349"));
  for (const unsupported of ["(a+)+$", "a|b", "(a)?", String.raw`(a)\1`, ".*"]) assert.equal(regex.parse(unsupported), undefined);
});

test("projected Python replay keeps opaque graph IDs and the same checker under webview CSP", async () => {
  const model = await modelPromise;
  const context = {
    flowId: "code-flow:python-test" as const,
    blockIds: new Map(model.functionLogic.blocks.map((block, index) => [block.id, `block-${index}`])),
    edgeIds: new Map(model.functionLogic.edges.map((edge, index) => [edge.id, `edge-${index}`])),
    bindingIds: new Map(model.declaration.program.bindings.map((binding, index) => [binding.bindingId, `binding-${index}`])),
    createEvidenceToken: () => undefined
  };
  const payload = createFunctionTutorPayload(model, context)!;
  assert.ok(payload.program.python);
  const serialized = JSON.stringify(payload.program.python);
  assert.doesNotMatch(serialized, /\/workspace\/|logic-block:|logic-value-binding:|quality\.py/u);
  assert.ok(payload.program.python.functions.every((fn) => fn.id.startsWith("function-tutor-python-function:")));
  const replay = runtime.evaluate(payload.program.python, new Map([["text", "12349\nCODE: 12355"]]));
  assert.equal(replay.status, "verified"); assert.deepEqual(replay.terminal?.value, ["12355", "12349"]);
  const browser = new Function("projectAnalyzerText", `${getFunctionLogicScenarioEvaluatorBrowserSource()}${getFunctionLogicScenarioEvaluationBrowserSource()}${getFunctionTutorBrowserSource()}${getFunctionLogicScenarioWorkspaceBrowserSource()}
    return { run: functionTutorRunScenario, resolve: functionTutorResolveScenarioPaths, format: functionTutorValueText };`)((key: string) => key);
  const seed = { source: "model", certainty: "inferred", inputs: [{ parameterId: payload.parameters[0].id, value: { kind: "string", value: "12349\nCODE: 12355" }, certainty: "inferred" }] };
  const paths = browser.run(payload, seed); const resolved = browser.resolve(payload, seed, paths);
  assert.equal(resolved.length, 1); assert.equal(resolved[0].limited, false); assert.ok(!resolved[0].symbolic);
  assert.equal(browser.format(resolved[0].terminal.value), "[12355, 12349]");
  const changed = resolved[0].transitions.find((item: { targetName: string; after: { value?: unknown } }) => item.targetName === "found" && Array.isArray(item.after.value) && item.after.value.length === 1);
  assert.equal(browser.format(changed.before), "[]"); assert.equal(browser.format(changed.after), "[12349]");
  assert.doesNotMatch(getPythonScenarioBrowserSource(), /\beval\s*\(|\bFunction\s*\(|require\(|import\(/u);
});

test("real Python neural learning finds accepted, rejected and later-iteration inputs with independently checked witnesses", async () => {
  const model = await modelPromise; const controller = new AbortController();
  const response = await createLocalNeuralScenarioProvider().suggest(model, "en", controller.signal);
  assert.ok(response.training && response.training.finalLoss < response.training.initialLoss * 0.1);
  assert.ok(response.training.evaluations <= 1400);
  const checked = parseScenarioInputSuggestions(response.text, model, response.boundaries);
  assert.ok(checked.accepted >= 2, response.text);
  assert.ok(checked.seeds.some((seed) => seed.quality?.evaluation.terminal?.value?.kind === "array" && seed.quality.evaluation.terminal.value.items.length > 0), response.text);
  assert.ok(response.boundaries?.some((boundary) => boundary.occurrence === 1), response.text);
  for (const boundary of response.boundaries ?? []) {
    const outcomes = [boundary.inputs, boundary.neighbor].map((inputs) => evaluateFunctionTutorInputs(model.declaration, inputs).decisions.filter((item) => item.blockId === boundary.blockId)[boundary.occurrence ?? 0]?.outcome);
    assert.ok(outcomes.every((value) => value !== undefined)); assert.notEqual(outcomes[0], outcomes[1]);
  }
});
