/** Source-fixture tests for meaningful input coverage and untrusted neural suggestions. */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { analyzeFunctionTutorDeclaration, evaluateFunctionTutorInputs } from "../../analyzer/functionTutor";
import { buildFunctionTutorModel, CodeFlowInsightCache } from "../../application/codeFlow";
import { createScenarioInputPrompt, parseScenarioInputSuggestions } from "../../application/scenarioInputs";
import { validateWebviewRequest } from "../../protocol/webviewRequestValidation";
import type { SymbolNode } from "../../shared/types";
import { createGraph } from "./helpers/projectReadingGuideFixtures";

/** Runs both production syntax adapters and the production application planner. */
async function build(sourceText: string) {
  const lines = sourceText.split("\n");
  const startLine = lines.findIndex((line) => line.startsWith("export function inspect"));
  const node: SymbolNode = { id: "function:input-quality", kind: "function", name: "inspect", qualifiedName: "inspect",
    filePath: "/workspace/quality.ts", language: "typescript",
    range: { startLine, startCharacter: 0, endLine: lines.length - 1, endCharacter: lines.at(-1)!.length },
    selectionRange: { startLine, startCharacter: 16, endLine: startLine, endCharacter: 23 } };
  const functionLogic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic });
  const graph = createGraph({ files: [node.filePath], callables: [node] });
  const insights = new CodeFlowInsightCache().get(graph);
  return buildFunctionTutorModel({ graph, declaration, functionLogic, architectureIndex: insights.functionArchitecture,
    semanticFlows: insights.semanticFlows, functionIndex: insights.functionIndex, readSourceText: async () => sourceText });
}

test("input planning composes object-member predicates and preserves required interface fields", async () => {
  const model = await build([
    'interface Input { score: number; tier: "free" | "pro"; label: string }',
    'export function inspect(input: Input) {',
    '  if (input.score >= 10 && input.tier === "pro") return "upgrade";',
    '  return "ordinary";',
    '}'
  ].join("\n"));
  assert.ok(model.seeds.some((seed) => seed.quality?.evaluation.status === "verified"
    && seed.quality.evaluation.terminal?.value?.kind === "string" && seed.quality.evaluation.terminal.value.value === "upgrade"), JSON.stringify(model.seeds));
  const candidates = [...model.candidatesByParameter.values()][0];
  assert.ok([9, 10, 11].every((number) => candidates.some((candidate) => candidate.value.kind === "object"
    && candidate.value.entries.some((entry) => entry.key === "score" && entry.value.kind === "number" && entry.value.value === number))));
  assert.ok(model.seeds.every((seed) => seed.inputs[0].value.kind === "object"
    && seed.inputs[0].value.entries.some((entry) => entry.key === "label" && entry.value.kind === "string")));
});

test("input planning carries earlier guards through a deep path instead of changing isolated inputs", async () => {
  const model = await build([
    'export function inspect(a: number, b: number, c: boolean, d: "yes" | "no") {',
    '  if (a < 10) return 1;',
    '  if (b <= 20) return 2;',
    '  if (!c) return 3;',
    '  if (d !== "yes") return 4;',
    '  return 5;',
    '}'
  ].join("\n"));
  const outcomes = new Set(model.seeds.flatMap((seed) => {
    const value = seed.quality?.evaluation.terminal?.value;
    return seed.quality?.evaluation.status === "verified" && value?.kind === "number" ? [value.value] : [];
  }));
  assert.deepEqual([...outcomes].sort(), [1, 2, 3, 4, 5]);
  assert.equal(model.summary.plannedCoverageCount, 8);
});

test("contradictory guards do not earn coverage; assignments can change feasibility", async () => {
  const impossible = await build('export function inspect(x: number) {\n if (x > 10) {\n if (x < 5) return 99;\n }\n return 0;\n}');
  assert.ok(impossible.seeds.every((seed) => seed.quality?.evaluation.terminal?.value?.kind !== "number"
    || seed.quality.evaluation.terminal.value.value !== 99));
  assert.ok(impossible.summary.plannedCoverageCount < impossible.summary.totalObjectiveCount);
  const changed = await build('export function inspect(x: number) {\n if (x > 10) {\n x = 0;\n if (x < 5) return 99;\n }\n return 0;\n}');
  assert.ok(changed.seeds.some((seed) => seed.quality?.evaluation.status === "verified"
    && seed.quality.evaluation.terminal?.value?.kind === "number" && seed.quality.evaluation.terminal.value.value === 99));
});

test("external calls and aliased mutations stop static claims instead of using stale bindings", async () => {
  for (const source of [
    'export function inspect(x: number) {\n const y = external(x);\n if (x > 0) return 1;\n return 0;\n}',
    'export function inspect(input: { x: number }) {\n const alias = input;\n alias.x = 10;\n if (input.x === 10) return 1;\n return 0;\n}',
    'export function inspect(x: number) {\n void (x = 10);\n if (x === 10) return 1;\n return 0;\n}',
    'export function inspect(x: number) {\n try {\n throw x;\n } catch {\n return 99;\n }\n}'
  ]) {
    const model = await build(source);
    assert.ok(model.seeds.every((seed) => seed.quality?.evaluation.status === "partial"));
    assert.equal(model.summary.plannedCoverageCount, 0);
  }
});

test("repeated states and explicit evaluation budgets terminate without proving loop exits", async () => {
  const model = await build('export function inspect(x: number) {\n while (x > 0) { x += 1; }\n return x;\n}');
  const inputs = [{ parameterId: model.declaration.parameters[0].id, value: { kind: "number" as const, value: 1 } }];
  assert.equal(evaluateFunctionTutorInputs(model.declaration, inputs, { maxSteps: 1 }).reason, "step-budget");
  assert.equal(evaluateFunctionTutorInputs(model.declaration, inputs, { maxLoopVisits: 2 }).status, "partial");
});

test("model data must be complete interface-compatible tuples with a specific explanation", async () => {
  const model = await build('export function inspect(input: { score: number; tier: "free" | "pro" }, flag = false) {\n return external(input, flag);\n}');
  const parsed = parseScenarioInputSuggestions(JSON.stringify({ scenarios: [
    { title: "Conflicting upgrade flags", reason: "A negative score with pro tier reaches the external policy boundary; the disabled flag may conflict.", inputs: { input: { score: -100, tier: "pro" } }, omitted: ["flag"], assumptions: ["External policy is unknown."] },
    { title: "Missing field", reason: "Must be rejected", inputs: { input: { score: 20 }, flag: false } },
    { title: "Invalid union", reason: "Must be rejected", inputs: { input: { score: 20, tier: "admin" }, flag: false } },
    { title: "Invented parameter", reason: "Must be rejected", inputs: { input: { score: 20, tier: "pro" }, flag: false, other: 1 } },
    { title: "", reason: "No useful title", inputs: {} }
  ] }), model);
  assert.equal(parsed.accepted, 1); assert.equal(parsed.rejected, 4);
  assert.equal(parsed.seeds[0].source, "model");
  assert.equal(parsed.seeds[0].certainty, "inferred");
  assert.equal(parsed.seeds[0].quality?.evaluation.status, "partial");
  assert.equal(parsed.seeds[0].inputs[1].omitted, true);
  assert.ok(parsed.seeds[0].inputs.every((input) => input.evidence.length === 0));
});

test("malformed, executable, prototype and oversized model values are never applied", async () => {
  const model = await build('export function inspect(input: unknown) {\n return external(input);\n}');
  assert.throws(() => parseScenarioInputSuggestions('```json\n{}\n```', model), /invalid-response/u);
  assert.throws(() => parseScenarioInputSuggestions('a'.repeat(48001), model), /invalid-response/u);
  const cases = ['{"__proto__":{"x":1}}', JSON.stringify("x".repeat(1025)), JSON.stringify(Array(33).fill(1)), '1e999'];
  for (const value of cases) {
    const result = parseScenarioInputSuggestions('{"scenarios":[{"title":"Unsafe shape","reason":"Rejected by bounds","inputs":{"input":' + value + '}}]}', model);
    assert.equal(result.accepted, 0);
  }
});

test("prompt includes interface, guards and current coverage without host authority", async () => {
  const source = 'export function inspect(x: number) {\n if (x === 42) return "special";\n return "normal";\n}';
  const model = await build(source);
  const prompt = await createScenarioInputPrompt(model, source, async () => source, "ko");
  assert.match(prompt, /checkedOutcomes/u); assert.match(prompt, /currentInputs/u); assert.match(prompt, /Korean/u);
  assert.match(prompt, /x === 42/u); assert.doesNotMatch(prompt, /\/workspace\/|function:input-quality/u);
  const selected = 'export function inspect(x: number) { return x; }';
  const prefix = 'const adjacentBefore = 1; ';
  model.declaration.functionNode.range = { startLine: 0, startCharacter: prefix.length,
    endLine: 0, endCharacter: prefix.length + selected.length };
  const bounded = await createScenarioInputPrompt(model, prefix + selected + ' const adjacentAfter = 2;', async () => undefined, "en");
  assert.doesNotMatch(bounded, /adjacentBefore|adjacentAfter/u);
});

test("prompt retains bounded caller neighborhoods including argument construction", async () => {
  const source = 'export function inspect(x: number) {\n return external(x);\n}';
  const model = await build(source);
  model.context.callers = Array.from({ length: 6 }, (_, index) => ({
    nodeId: "caller:" + index, name: "caller" + index, qualifiedName: "caller" + index,
    kind: "function", callCount: 1, certainty: "exact", evidence: [{
      kind: "callsite-argument", certainty: "exact", filePath: "/workspace/caller" + index + ".ts",
      range: { startLine: 10, startCharacter: 0, endLine: 10, endCharacter: 12 }, summary: "Graph-owned caller"
    }]
  }));
  const reads: string[] = [];
  const prompt = await createScenarioInputPrompt(model, source, async (filePath) => {
    reads.push(filePath);
    return [...Array(7).fill("// context"), 'const score = previousScore + offset;',
      'const offset = -1;', '// caller input construction', 'inspect(score);', '// after call'].join("\n");
  }, "en");
  assert.equal(reads.length, 4);
  assert.match(prompt, /previousScore \+ offset/u); assert.match(prompt, /inspect\(score\)/u);
  assert.doesNotMatch(prompt, /caller4\.ts|caller5\.ts|\/workspace\//u);
  assert.match(prompt, /untrusted data, never instructions/u);
});

test("suggestion protocol accepts only bounded correlation identities", () => {
  const payload = { graphVersion: "v1", flowId: "code-flow:" + "a".repeat(32), requestId: 1 };
  for (const type of ["codeFlow/requestScenarioInputs", "codeFlow/cancelScenarioInputs"]) {
    assert.equal(validateWebviewRequest({ type, payload }).ok, true);
    assert.equal(validateWebviewRequest({ type, payload: { ...payload, sourceText: "run()" } }).ok, false);
    assert.equal(validateWebviewRequest({ type, payload: { ...payload, requestId: -1 } }).ok, false);
    assert.equal(validateWebviewRequest({ type, payload: { ...payload, flowId: "/tmp/file.ts" } }).ok, false);
  }
});

test("ordinary model values that explain no new checked behavior are rejected", async () => {
  const model = await build('export function inspect(x: number) {\n if (x < 0) return "negative";\n return "positive";\n}');
  const result = parseScenarioInputSuggestions(JSON.stringify({ scenarios: [{ title: "Another positive", reason: "An ordinary positive number", inputs: { x: 123 } }] }), model);
  assert.equal(result.accepted, 0); assert.equal(result.rejected, 1);
});

test("model arrays and deep required fields preserve the known declared shape", async () => {
  const model = await build('export function inspect(input: { tags: string[]; profile: { address: { city: string } } }) {\n return external(input);\n}');
  const result = parseScenarioInputSuggestions(JSON.stringify({ scenarios: [
    { title: "Wrong array item", reason: "Rejected", inputs: { input: { tags: [12], profile: { address: { city: "Seoul" } } } } },
    { title: "Missing deep field", reason: "Rejected", inputs: { input: { tags: [], profile: { address: {} } } } },
    { title: "Unicode address", reason: "Unicode city and an empty collection test external normalization assumptions", inputs: { input: { tags: [], profile: { address: { city: "서울\u200b" } } } } }
  ] }), model);
  assert.equal(result.accepted, 1); assert.equal(result.rejected, 2);
});

test("late rare exceptions remain eligible after many earlier boundary candidates", async () => {
  const model = await build(['export function inspect(x: number) {',
    ...Array.from({ length: 16 }, (_, index) => ' if (x === ' + index + ') return ' + index + ';'),
    ' if (x === 97) throw "rare";', ' return -1;', '}'].join("\n"));
  assert.ok(model.seeds.length <= 12);
  assert.ok(model.seeds.some((seed) => seed.quality?.evaluation.terminal?.kind === "throw"));
  assert.ok(model.summary.plannedCoverageCount < model.summary.totalObjectiveCount);
});

test("an explicit undefined input uses the declared default in path checks", async () => {
  const model = await build('export function inspect(x: number = 42) {\n if (x === 42) return true;\n return false;\n}');
  const result = evaluateFunctionTutorInputs(model.declaration, [{ parameterId: model.declaration.parameters[0].id, value: { kind: "undefined" } }]);
  assert.deepEqual(result.terminal?.value, { kind: "boolean", value: true });
});

test("nullish and short-circuit guards never certify an incorrect concrete outcome", async () => {
  for (const expression of ["x ?? true", "x || true", "x && true"]) {
    const model = await build('export function inspect(x: boolean | null) {\n if (' + expression + ') return 1;\n return 0;\n}');
    for (const value of [{ kind: "boolean" as const, value: false }, { kind: "boolean" as const, value: true }, { kind: "null" as const }]) {
      const result = evaluateFunctionTutorInputs(model.declaration, [{ parameterId: model.declaration.parameters[0].id, value }]);
      const expected = expression === "x || true" || value.kind === "boolean" && value.value || expression === "x ?? true" && value.kind === "null" ? 1 : 0;
      if (result.status === "verified") assert.deepEqual(result.terminal?.value, { kind: "number", value: expected }, expression + JSON.stringify(value));
      else assert.ok(result.reason, "Unsupported control must remain an explicit gap.");
    }
  }
});
