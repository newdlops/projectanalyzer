/** Source-to-browser regression fixtures for arithmetic, reference identity and immutable value history. */
import assert from "node:assert/strict";
import test from "node:test";
import * as ts from "typescript";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { analyzeFunctionTutorDeclaration } from "../../analyzer/functionTutor";
import { buildFunctionTutorModel, CodeFlowInsightCache } from "../../application/codeFlow";
import { createFunctionTutorPayload } from "../../application/codeFlow/functionTutor";
import { getFunctionLogicScenarioEvaluatorBrowserSource, getFunctionLogicScenarioTraceBrowserSource } from "../../webview/codeFlow/valuePreview";
import type { SymbolNode } from "../../shared/types";
import { createGraph } from "./helpers/projectReadingGuideFixtures";

type State = { kind: string; value?: unknown; origins: string[] };
type Transition = { targetBindingId: string; before: State; after: State; dependencyBindingIds: string[] };
type Calculation = { recordsByBlockId: Map<string, { before: Map<string, State>; after: Map<string, State>; transitions: Transition[] }>; inputStateByBindingId: Map<string, State>; scenarioPaths: Array<{ terminal: { value?: { kind: string; value?: unknown; entries?: unknown[]; items?: unknown[] } }; occurrences: Array<{ blockId: string; before?: Map<string, State>; after?: Map<string, State>; transitions: Transition[] }>; transitions: Transition[] }> };

/** Uses the actual AST adapter, application bundle and opaque projection before browser evaluation. */
async function evaluateSource(source: string, inputs: Record<string, unknown> = {}) {
  const filePath = "/workspace/valueInference.ts";
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const syntax = file.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "inspect")!;
  const start = file.getLineAndCharacterOfPosition(syntax.getStart(file)); const end = file.getLineAndCharacterOfPosition(syntax.end);
  const name = file.getLineAndCharacterOfPosition(syntax.name!.getStart(file));
  const node: SymbolNode = { id: "function:inspect", kind: "function", name: "inspect", qualifiedName: "inspect", filePath, language: "typescript",
    range: { startLine: start.line, startCharacter: start.character, endLine: end.line, endCharacter: end.character },
    selectionRange: { startLine: name.line, startCharacter: name.character, endLine: name.line, endCharacter: name.character + 7 } };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText: source });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText: source, functionLogic: logic });
  const graph = createGraph({ files: [filePath], callables: [node] }); const cache = new CodeFlowInsightCache().get(graph);
  const model = await buildFunctionTutorModel({ graph, declaration, functionLogic: logic, architectureIndex: cache.functionArchitecture,
    semanticFlows: cache.semanticFlows, functionIndex: cache.functionIndex, readSourceText: async () => source });
  const projectedTutor = createFunctionTutorPayload(model, { flowId: "code-flow:root", blockIds: new Map(logic.blocks.map((block) => [block.id, block.id])),
    edgeIds: new Map(logic.edges.map((edge) => [edge.id, edge.id])), bindingIds: new Map((logic.valueBindings ?? []).map((binding) => [binding.id, binding.id])),
    createEvidenceToken: () => "code-evidence:test" });
  assert.ok(projectedTutor);
  // Match the Webview's actual JSON transport, including special-number limits.
  const tutor = JSON.parse(JSON.stringify(projectedTutor)) as typeof projectedTutor;
  const root = tutor.programBundle!.programs.find((program) => program.id === tutor.programBundle!.rootProgramId)!;
  const browser = new Function("readFunctionLogicScenarioEditableBindings", "readFunctionLogicValuePreview", "projectAnalyzerText",
    getFunctionLogicScenarioEvaluatorBrowserSource() + getFunctionLogicScenarioTraceBrowserSource() +
    ";return { run: calculateFunctionLogicScenarioProgramBundle, known: createFunctionLogicScenarioKnown, records: collectFunctionLogicScenarioBlockRecords, project: projectFunctionLogicScenarioCalculation };")(
    (bindings: unknown) => bindings, () => "", (key: string) => key) as {
      run(logic: unknown, nodes: Map<string, unknown>, edges: Map<string, unknown>, supplied: Map<string, State>): Calculation;
      known(value: unknown, origins: string[]): State;
      records(logic: unknown, calculation: Calculation): Array<{ block: { id: string }; record: { transitions: Transition[] } }>;
      project(logic: unknown, calculation: Calculation, identity: unknown): Calculation;
    };
  const supplied = new Map(root.bindings.filter((binding) => binding.parameterId && Object.hasOwn(inputs, binding.name))
    .map((binding) => [binding.bindingId, browser.known(inputs[binding.name], [binding.bindingId])]));
  const calculation = browser.run({ valueBindings: [], tutor }, new Map(), new Map(), supplied);
  return { calculation, root, browser, terminal: calculation.scenarioPaths[0].terminal.value,
    transitions: (name: string) => calculation.scenarioPaths[0].transitions.filter((item) => item.targetBindingId === root.bindings.find((binding) => binding.name === name)?.bindingId) };
}

test("compound assignments carry the immediately preceding value and its input dependency", async () => {
  const result = await evaluateSource('export function inspect(input: number) {\n let total = input;\n total += 5;\n total *= 2;\n total -= 4;\n total /= 2;\n return total;\n}', { input: 10 });
  assert.deepEqual(result.terminal, { kind: "number", value: 13 });
  assert.deepEqual(result.transitions("total").slice(1).map((item) => [item.before.value, item.after.value]), [[10, 15], [15, 30], [30, 26], [26, 13]]);
  const inputId = result.root.bindings.find((binding) => binding.name === "input")!.bindingId;
  assert.ok(result.transitions("total").every((item) => item.dependencyBindingIds.includes(inputId)));
});

test("composite expressions retain derived members, arrays, shorthand and unary values", async () => {
  const result = await evaluateSource('export function inspect(input: number) {\n const size = -input;\n const data = { size, items: [input, input + 1] };\n return data;\n}', { input: 3 });
  assert.deepEqual(result.terminal, { kind: "object", entries: [{ key: "size", value: { kind: "number", value: -3 } },
    { key: "items", value: { kind: "array", items: [{ kind: "number", value: 3 }, { kind: "number", value: 4 }], truncated: false } }], truncated: false });
});

test("loose equality preserves primitive coercion and nullish boundaries without object coercion", async () => {
  for (const [input, operator, expected] of [["0", "==", true], ["0", "===", false], [false, "!=", false], [null, "==", false], [null, "!=", true]] as const) {
    const result = await evaluateSource('export function inspect(input: unknown) {\n return input ' + operator + ' 0;\n}', { input });
    assert.deepEqual(result.terminal, { kind: "boolean", value: expected });
  }
  const nullish = await evaluateSource('export function inspect(input: unknown) {\n return input == null;\n}', { input: undefined });
  assert.deepEqual(nullish.terminal, { kind: "boolean", value: true });
  const coercion = await evaluateSource('export function inspect(input: unknown) {\n return input == 0;\n}', { input: [] });
  assert.equal(coercion.terminal?.kind, "unknown");
});

test("unknown object members and unsupported spreads cannot become complete known objects", async () => {
  for (const expression of ['{ known: 1, derived: external(input) }', '{ known: 1, ...external(input) }', '[1, ...external(input)]']) {
    const result = await evaluateSource('export function inspect(input: number) {\n const data = ' + expression + ';\n return data;\n}', { input: 1 });
    assert.equal(result.terminal?.kind, "unknown", expression);
    assert.equal(result.transitions("data").at(-1)?.after.kind, "unknown", expression);
  }
});

test("compound member assignment captures its left value before a mutating RHS call", async () => {
  const result = await evaluateSource('function update(value: { count: number }) {\n value.count = 100;\n return 2;\n}\nexport function inspect(input: { count: number }) {\n input.count += update(input);\n return input.count;\n}', { input: { count: 3 } });
  assert.deepEqual(result.terminal, { kind: "number", value: 5 });
  const change = result.transitions("input")[0];
  assert.deepEqual([change.before.value, change.after.value], [3, 5]);
  assert.equal((change as Transition & { targetName: string }).targetName, 'input["count"]');
});

test("unsupported source operations do not disappear while later values stay known", async () => {
  const result = await evaluateSource('export function inspect(input: number) {\n let total = input;\n void (total = 100);\n return total;\n}', { input: 3 });
  const changes = result.transitions("total");
  assert.equal(changes.at(-1)?.after.kind, "unknown");
});

test("bounded static conversion rejects unknown children, cycles and truncated containers", () => {
  const convert = new Function(getFunctionLogicScenarioEvaluatorBrowserSource() + ';return functionLogicScenarioProgramLiteral;')() as (value: unknown) => State;
  assert.equal(convert({ kind: "object", entries: [{ key: "x", value: { kind: "unknown" } }], truncated: false }).kind, "unknown");
  assert.equal(convert({ kind: "array", items: [], truncated: true }).kind, "unknown");
  const cycle: { kind: string; entries: Array<{ key: string; value: unknown }> } = { kind: "object", entries: [] };
  cycle.entries.push({ key: "self", value: cycle });
  assert.equal(convert(cycle).kind, "unknown");
});

test("value text keeps undefined, NaN, infinity and negative zero distinct inside containers", () => {
  const format = new Function("projectAnalyzerText", getFunctionLogicScenarioEvaluatorBrowserSource() + ';return formatFunctionLogicScenarioState;')((key: string) => key) as (value: State) => string;
  const state = (value: unknown): State => ({ kind: "known", value, origins: [] });
  assert.equal(format(state({ missing: undefined, result: NaN, items: [Infinity, -Infinity, -0, null] })), '{"missing":undefined,"result":NaN,"items":[Infinity,-Infinity,-0,null]}');
  const shared = { count: 1 };
  assert.equal(format(state({ first: shared, second: shared })), '{"first":{"count":1},"second":{"count":1}}');
  const accessor = Object.defineProperty({}, "value", { enumerable: true, get() { throw new Error("accessor must not run"); } });
  assert.equal(format(state(accessor)), "unknown");
  assert.ok(format(state({ long: "x".repeat(1000) })).endsWith("…"));
});

test("source negative zero survives the JSON program boundary and controls the division sign", async () => {
  const result = await evaluateSource('export function inspect() {\n const zero = -0;\n return 1 / zero;\n}');
  assert.ok(Object.is(result.transitions("zero")[0].after.value, -0));
  assert.deepEqual(result.terminal, { kind: "number", value: -Infinity });
  const composite = await evaluateSource('export function inspect() {\n return [0, -0];\n}');
  assert.deepEqual(composite.terminal, { kind: "array", items: [{ kind: "number", value: 0 }, { kind: "number", value: -0 }], truncated: false });
});

test("member writes update direct and nested aliases without rewriting prior snapshots", async () => {
  const input = { child: { count: 2 }, untouched: 7 };
  const result = await evaluateSource('export function inspect(input: { child: { count: number }; untouched: number }) {\n const alias = input.child;\n const before = alias.count;\n alias.count += 3;\n return input.child.count + before;\n}', { input });
  assert.deepEqual(result.terminal, { kind: "number", value: 7 });
  assert.deepEqual(input, { child: { count: 2 }, untouched: 7 });
  const transition = result.transitions("alias").at(-1)!;
  assert.equal(transition.before.value, 2); assert.equal(transition.after.value, 5);
});

test("known callee mutations propagate through a shared argument to caller computations", async () => {
  const result = await evaluateSource('function update(value: { count: number }) {\n value.count += 1;\n return value.count;\n}\nexport function inspect(input: { count: number }) {\n const updated = update(input);\n return input.count + updated;\n}', { input: { count: 1 } });
  assert.deepEqual(result.terminal, { kind: "number", value: 4 });
});

test("live expression references survive a later argument mutation with their identity intact", async () => {
  const helper = 'function update(value: { count: number }) {\n value.count += 1;\n return value;\n}\n';
  const identity = await evaluateSource(helper + 'export function inspect(input: { count: number }) {\n return input === update(input);\n}', { input: { count: 1 } });
  assert.deepEqual(identity.terminal, { kind: "boolean", value: true });
  const composite = await evaluateSource(helper + 'export function inspect(input: { count: number }) {\n return { before: input, after: update(input) };\n}', { input: { count: 1 } });
  assert.deepEqual(composite.terminal, { kind: "object", entries: ["before", "after"].map((key) => ({ key,
    value: { kind: "object", entries: [{ key: "count", value: { kind: "number", value: 2 } }], truncated: false } })), truncated: false });
});

test("return and decision call mutations appear in the block that evaluated them", async () => {
  const helper = 'function update(value: { count: number }) {\n value.count += 1;\n return value.count;\n}\n';
  for (const body of ['return update(input);', 'if (update(input) > 0) {\n return input.count;\n}\n return 0;']) {
    const result = await evaluateSource(helper + 'export function inspect(input: { count: number }) {\n ' + body + '\n}', { input: { count: 1 } });
    assert.deepEqual(result.terminal, { kind: "number", value: 2 });
    const changes = result.transitions("input");
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0].before.value, { count: 1 });
    assert.equal((changes[0].after.value as { count: number }).count, 2);
  }
  const unknown = await evaluateSource('export function inspect(input: { count: number }) {\n return external(input);\n}', { input: { count: 2 } });
  assert.equal(unknown.transitions("input").at(-1)?.after.kind, "unknown");
});

test("a cyclic member write stops confirmation and cannot rewrite prior input snapshots", async () => {
  const input = { count: 1 };
  const result = await evaluateSource('export function inspect(input: { count: number; self?: unknown }) {\n input.self = input;\n return 7;\n}', { input });
  assert.equal(result.terminal?.kind, "unknown");
  assert.equal(result.transitions("input").at(-1)?.after.kind, "unknown");
  assert.deepEqual(input, { count: 1 });
});

test("unresolved calls invalidate stale dependent values instead of confirming an old value", async () => {
  const result = await evaluateSource('export function inspect(input: { count: number }) {\n const alias = input;\n const ignored = external(input);\n return alias.count;\n}', { input: { count: 2 } });
  assert.equal(result.terminal?.kind, "unknown");
  const last = [...result.calculation.recordsByBlockId.values()].at(-1)!;
  const aliasId = result.root.bindings.find((binding) => binding.name === "alias")!.bindingId;
  assert.equal(last.after.get(aliasId)?.kind, "unknown");
});

test("value trace uses actual bounded loop occurrences rather than layout order", async () => {
  const result = await evaluateSource('export function inspect(input: number) {\n let total = input;\n let i = 0;\n while (i < 2) {\n total += 3;\n i++;\n }\n return total;\n}', { input: 1 });
  assert.deepEqual(result.terminal, { kind: "number", value: 7 });
  const visible = { blocks: result.root.blocks.map((block) => ({ id: "visible:" + block.blockId })),
    valueBindings: result.root.bindings.map((binding) => ({ id: "visible:" + binding.bindingId, name: binding.name })),
    tutor: { programBundle: { rootProgramId: result.root.id, programs: [result.root] } }, layout: { nodes: [] } };
  const projected = result.browser.project(visible, result.calculation, { resolveScenarioBlockId: (id: string) => "visible:" + id, resolveScenarioBindingId: (id: string) => "visible:" + id });
  const records = result.browser.records(visible, projected);
  assert.deepEqual(records.flatMap((entry) => entry.record.transitions).filter((item) => item.targetBindingId === "visible:" + result.root.bindings.find((binding) => binding.name === "total")!.bindingId)
    .slice(1).map((item) => [item.before.value, item.after.value]), [[1, 4], [4, 7]]);
});

test("loop limits preserve the calculated prefix and expose that confirmation stopped", async () => {
  const result = await evaluateSource('export function inspect(input: number) {\n let total = input;\n while (true) {\n total += 3;\n }\n return total;\n}', { input: 1 });
  assert.equal((result.calculation as Calculation & { truncated: boolean }).truncated, true);
  assert.deepEqual(result.transitions("total").slice(1).map((item) => [item.before.value, item.after.value]), [[1, 4], [4, 7], [7, 10]]);
  assert.notEqual(result.terminal?.kind, "number");
  const child = await evaluateSource('function update(value: { count: number }) {\n while (true) {\n value.count += 1;\n }\n}\nexport function inspect(input: { count: number }) {\n const ignored = update(input);\n return 7;\n}', { input: { count: 1 } });
  assert.equal(child.terminal?.kind, "unknown");
});
