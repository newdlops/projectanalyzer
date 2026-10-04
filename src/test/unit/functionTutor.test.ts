/** Function Guide tests cover bounded declaration facts, codebase context, scenarios, and opaque projection. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { analyzeFunctionTutorDeclaration } from "../../analyzer/functionTutor";
import { buildFunctionTutorModel, CodeFlowInsightCache } from "../../application/codeFlow";
import { createFunctionTutorPayload } from "../../application/codeFlow/functionTutor";
import { createContentHash } from "../../shared/hash";
import type { SymbolNode } from "../../shared/types";
import { createGraph } from "./helpers/projectReadingGuideFixtures";
import { getFunctionTutorBrowserSource } from "../../webview/codeFlow/tutor";
import { getFunctionLogicScenarioEvaluatorBrowserSource } from "../../webview/codeFlow/valuePreview";
import { getFunctionLogicScenarioEvaluationBrowserSource } from "../../webview/codeFlow/scenarioEvaluation";
import { getFunctionLogicScenarioPathPlannerBrowserSource } from "../../webview/codeFlow/scenarioWorkspace";

const filePath = "/workspace/src/discount.ts";
const source = [
  "export function discount(amount: number = 10, member: boolean = false) {",
  "  let value = amount;",
  "  if (amount >= 100) value += 10;",
  "  if (member) value += 5;",
  "  return value;",
  "}",
  "discount(120, true);"
].join("\n");

test("formats bounded protocol and null-prototype Scenario values without coercion", () => {
  const formatter = new Function("projectAnalyzerText", `${getFunctionTutorBrowserSource()} return functionTutorValueText;`)(() => "Unknown") as (value: unknown) => string;
  const inputText = new Function("projectAnalyzerText", `${getFunctionTutorBrowserSource()} return functionTutorScenarioInputText;`)(() => "Unknown") as (value: unknown) => string | undefined;
  assert.equal(formatter({ kind: "number", value: 2 }), "2");
  assert.equal(formatter({ kind: "array", items: [{ kind: "number", value: 1 }, { kind: "number", value: 2 }] }), "[1, 2]");
  assert.equal(formatter({ kind: "object", entries: [{ key: "count", value: { kind: "number", value: 2 } }] }), "{count: 2}");
  assert.equal(formatter({ kind: "known", value: 2 }), "2");
  const instance = Object.assign(Object.create(null), { __functionTutorBrand: "opaque", count: 2 });
  assert.equal(formatter({ kind: "known", value: instance }), "{count: 2}");
  assert.equal(formatter({ kind: "known", value: Object.assign(Object.create(null), { value: 2, done: false }) }), "{value: 2, done: false}");
  assert.equal(formatter({ kind: "known", value: Object.assign(Object.create(null), { __functionTutorIterator: true, index: 1 }) }), "Unknown");
  const cycle = Object.create(null) as Record<string, unknown>; cycle.self = cycle;
  assert.equal(formatter({ kind: "known", value: cycle }), "Unknown");
  let invoked = false; const accessor = Object.create(null); Object.defineProperty(accessor, "value", { get() { invoked = true; return 2; }, enumerable: true });
  assert.equal(formatter({ kind: "known", value: accessor }), "Unknown"); assert.equal(invoked, false);
  const hostile = { toString() { invoked = true; return "bad"; }, valueOf() { invoked = true; return 1; }, toJSON() { invoked = true; return {}; } };
  assert.equal(formatter({ kind: "known", value: hostile }), "Unknown"); assert.equal(invoked, false);
  assert.equal(inputText({
    kind: "object",
    entries: [{ key: "profile", value: { kind: "object", entries: [{ key: "score", value: { kind: "number", value: 0 } }], truncated: false } },
      { key: "items", value: { kind: "array", items: [], truncated: false } }],
    truncated: false
  }), '{"profile":{"score":0},"items":[]}');
});

test("Function Guide derives bounded typed/default/branch scenarios without executing calls", async () => {
  const node = createFunctionNode();
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText: source });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText: source, functionLogic: logic });
  assert.equal(declaration.parameters.length, 2);
  assert.equal(declaration.parameters[0].typeKind, "number");
  assert.deepEqual(declaration.parameters[0].defaultValue, { kind: "number", value: 10 });
  assert.ok(declaration.constraints.some((constraint) => constraint.operator === "gte"));
  assert.ok(declaration.program.blocks.some((block) => block.operations.some((operation) => operation.kind === "assign")));
  const graph = createGraph({ files: [filePath], callables: [node] });
  graph.edges.push({
    id: "call:discount",
    kind: "calls",
    sourceId: "caller",
    targetId: node.id,
    filePath,
    range: { startLine: 6, startCharacter: 0, endLine: 6, endCharacter: 19 },
    confidence: "exact"
  });
  const insights = new CodeFlowInsightCache().get(graph);
  const model = await buildFunctionTutorModel({
    graph,
    declaration,
    functionLogic: logic,
    architectureIndex: insights.functionArchitecture,
    semanticFlows: insights.semanticFlows,
    functionIndex: insights.functionIndex,
    readSourceText: async () => source
  });
  assert.ok(model.callsites.length > 0);
  assert.ok(model.seeds.length > 0 && model.seeds.length <= 12);
  assert.ok(model.seeds.some((seed) => seed.source === "callsite"));
  assert.ok(model.seeds.every((seed) => seed.inputs.length === declaration.parameters.length));
  assert.equal(model.guide.chapters.length, 5);
  // Fixed questions are semantic descriptors, not Host-provided English.
  assert.deepEqual(model.guide.chapters.map((chapter) => chapter.questionKey), [
    "place", "inputs", "decisions", "work", "outcomes"
  ]);
  assert.ok(model.guide.chapters.every((chapter) => chapter.answerKey === chapter.kind));
  assert.notEqual(model.availability, "unavailable");
});

test("Function Guide type baseline bypasses unknown dynamic callsite arguments", async () => {
  const sourceText = [
    "export function typed(label: string, count: number, ready: boolean, items: string[], options: { enabled: boolean }) {",
    "  return ready ? label + count : String(items.length + Object.keys(options).length);",
    "}",
    "export function invoke(label: string, count: number, ready: boolean, items: string[], options: { enabled: boolean }) {",
    "  return typed(label, count, ready, items, options);",
    "}"
  ].join("\n");
  const node: SymbolNode = {
    ...createFunctionNode(),
    id: "function:typed",
    name: "typed",
    qualifiedName: "typed",
    range: { startLine: 0, startCharacter: 0, endLine: 2, endCharacter: 1 },
    selectionRange: { startLine: 0, startCharacter: 16, endLine: 0, endCharacter: 21 }
  };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  const graph = createGraph({ files: [filePath], callables: [node] });
  graph.edges.push({
    id: "call:typed-dynamic",
    kind: "calls",
    sourceId: "function:invoke",
    targetId: node.id,
    filePath,
    range: { startLine: 4, startCharacter: 2, endLine: 4, endCharacter: 52 },
    confidence: "exact"
  });
  const insights = new CodeFlowInsightCache().get(graph);
  const model = await buildFunctionTutorModel({
    graph,
    declaration,
    functionLogic: logic,
    architectureIndex: insights.functionArchitecture,
    semanticFlows: insights.semanticFlows,
    functionIndex: insights.functionIndex,
    readSourceText: async () => sourceText
  });

  assert.ok(model.seeds.some((seed) =>
    seed.source === "callsite" && seed.inputs.every((input) => input.value.kind === "unknown")
  ));
  const baseline = model.seeds.find((seed) => seed.source === "type");
  assert.ok(baseline);
  assert.deepEqual(baseline.inputs.map((input) => input.value), [
    { kind: "string", value: "" },
    { kind: "number", value: 0 },
    { kind: "boolean", value: false },
    { kind: "array", items: [], truncated: false },
    { kind: "object", entries: [{ key: "enabled", value: { kind: "boolean", value: false } }], truncated: false }
  ]);
});

test("Function Guide resolves bounded local and composite parameter type syntax", () => {
  const sourceText = [
    "type Priority = \"standard\" | \"urgent\";",
    "interface Options { enabled: boolean; nested?: { value: number }; }",
    "type CycleA = CycleB;",
    "type CycleB = CycleA;",
    "export function typed(payload: { score: number } & Record<string, unknown>, rows: readonly Options[], options: Options, priority: Priority, label: string | undefined, cycle: CycleA) { return payload.score + rows.length + label.length; }"
  ].join("\n");
  const node: SymbolNode = {
    ...createFunctionNode(),
    id: "function:composite-types",
    name: "typed",
    qualifiedName: "typed",
    range: { startLine: 4, startCharacter: 0, endLine: 4, endCharacter: sourceText.split("\n")[4].length },
    selectionRange: { startLine: 4, startCharacter: 16, endLine: 4, endCharacter: 21 }
  };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });

  assert.deepEqual(declaration.parameters.map((parameter) => parameter.typeKind), [
    "object",
    "array",
    "object",
    "literal-union",
    "string",
    "unknown"
  ]);
  assert.deepEqual(declaration.parameters[3]?.literalValues, [
    { kind: "string", value: "standard" },
    { kind: "string", value: "urgent" }
  ]);
  assert.deepEqual(declaration.parameters[0]?.memberFacts.map((fact) => fact.path), [["score"]]);
  assert.deepEqual(declaration.parameters[2]?.memberFacts.map((fact) => [fact.path, fact.optional]), [
    [["enabled"], false],
    [["nested"], true],
    [["nested", "value"], true]
  ]);
});

test("context-backed recommended values retain complete declared type representatives", () => {
  const sourceText = [
    "type Mode = \"safe\" | \"fast\";",
    "interface Settings { label: string; enabled: boolean; optional?: number; }",
    "type CycleA = CycleB; type CycleB = CycleA;",
    "export function typed(items: readonly Settings[], pair: [Mode, number], payload: { mode: Mode; count: number }, unsupported: CycleA) { return items.length + pair[1] + payload.count; }"
  ].join("\n");
  const node: SymbolNode = {
    ...createFunctionNode(), id: "function:representatives", name: "typed", qualifiedName: "typed",
    range: { startLine: 3, startCharacter: 0, endLine: 3, endCharacter: sourceText.split("\n")[3].length },
    selectionRange: { startLine: 3, startCharacter: 16, endLine: 3, endCharacter: 21 }
  };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });

  assert.deepEqual(declaration.parameters.map((parameter) => parameter.typeRepresentative), [
    { kind: "array", items: [{ kind: "object", entries: [
      { key: "label", value: { kind: "string", value: "sample" } },
      { key: "enabled", value: { kind: "boolean", value: false } }
    ], truncated: false }], truncated: false },
    { kind: "array", items: [{ kind: "string", value: "safe" }, { kind: "number", value: 0 }], truncated: false },
    { kind: "object", entries: [
      { key: "mode", value: { kind: "string", value: "safe" } },
      { key: "count", value: { kind: "number", value: 0 } }
    ], truncated: false },
    undefined
  ]);
});

test("Function Guide builds nested object input representatives from declared fields", async () => {
  const sourceText = readFileSync(resolve(process.cwd(), "src/test/fixtures/functionLogic/scenario_object_fields.ts"), "utf8");
  const node: SymbolNode = {
    ...createFunctionNode(),
    id: "function:object-fields-input",
    name: "scenarioObjectFields",
    qualifiedName: "scenarioObjectFields",
    filePath: "/workspace/scenario_object_fields.ts",
    range: { startLine: 1, startCharacter: 0, endLine: 12, endCharacter: 1 },
    selectionRange: { startLine: 1, startCharacter: 16, endLine: 1, endCharacter: 36 }
  };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  const graph = createGraph({ files: [node.filePath], callables: [node] });
  const insights = new CodeFlowInsightCache().get(graph);
  const model = await buildFunctionTutorModel({
    graph,
    declaration,
    functionLogic: logic,
    architectureIndex: insights.functionArchitecture,
    semanticFlows: insights.semanticFlows,
    functionIndex: insights.functionIndex,
    readSourceText: async () => sourceText
  });
  const baseline = model.seeds.find((seed) => seed.source === "type");

  assert.ok(baseline);
  assert.deepEqual(baseline.inputs.map((input) => input.value), [{
    kind: "object",
    entries: [{
      key: "profile",
      value: { kind: "object", entries: [{ key: "score", value: { kind: "number", value: 0 } }], truncated: false }
    }, {
      key: "items",
      value: { kind: "array", items: [], truncated: false }
    }],
    truncated: false
  }, { kind: "string", value: "" }, { kind: "number", value: 0 }]);
});

test("Tutor retains direct-call arguments as typed source IR without reading display labels", () => {
  const sourceText = [
    "function helper(value: number) { return value + 1; }",
    "export function root(input: number) { return helper(input); }"
  ].join("\n");
  const node = {
    ...createFunctionNode(),
    name: "root",
    qualifiedName: "root",
    range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 58 },
    selectionRange: { startLine: 1, startCharacter: 16, endLine: 1, endCharacter: 20 }
  };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  const terminal = declaration.program.blocks.flatMap((block) => block.terminal ? [block.terminal] : [])
    .find((candidate) => candidate.kind === "return");
  assert.equal(terminal?.kind, "return");
  assert.equal(terminal && "value" in terminal ? terminal.value?.kind : undefined, "direct-call");
  if (terminal?.kind === "return" && terminal.value?.kind === "direct-call") {
    assert.equal(terminal.value.calleeName, "helper");
    assert.equal(terminal.value.arguments[0]?.kind, "binding");
    assert.equal(terminal.value.certainty, "exact");
  }
});

test("Scenario catalog resolves range-backed private advanced calls without graph method edges", () => {
  const sourceText = readFileSync(resolve(process.cwd(), "src/test/fixtures/functionLogic/scenario_advanced_calls.ts"), "utf8");
  const start = sourceText.indexOf("export async function advancedScenario");
  const startLine = sourceText.slice(0, start).split("\n").length - 1;
  const endLine = startLine + 7;
  const root = { ...createFunctionNode(), id: "function:advanced", name: "advancedScenario", qualifiedName: "advancedScenario", range: { startLine, startCharacter: 0, endLine, endCharacter: 1 }, selectionRange: { startLine, startCharacter: 21, endLine: startLine, endCharacter: 37 } };
  const logic = analyzeFunctionLogic({ functionNode: root, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: root, sourceText, functionLogic: logic });
  const catalog = declaration.scenarioCatalog;
  assert.ok(catalog && catalog.programs.length >= 4, JSON.stringify({ programs: catalog?.programs.map((program) => program.invocationRole), resolutions: catalog?.resolutions.length, gaps: declaration.gaps }));
  assert.ok(catalog?.programs.some((program) => program.invocationRole === "constructor"));
  assert.ok(catalog?.programs.some((program) => program.invocationRole === "method"));
  assert.ok(catalog?.programs.some((program) => program.invocationRole === "static-method"));
  assert.ok(catalog?.resolutions.every((resolution) => resolution.targetId.startsWith("scenario-private:")));
  // The optional parameter receiver is deliberately not linked: its presence
  // is unknown and the browser must surface a localized gap instead of guessing.
  assert.ok((catalog?.resolutions.length ?? 0) >= 7);
  assert.ok(catalog?.programs.some((program) => program.invocationRole === "object-method"));
});

test("Scenario catalog rejects inexact dispatch and isolates exact owners", () => {
  const catalogFor = (prefix: string, rootBody: string) => {
    const sourceText = `${prefix}\nexport function root(value?: unknown) { ${rootBody} }`;
    const line = sourceText.slice(0, sourceText.indexOf("export function root")).split("\n").length - 1;
    const identity = createContentHash(sourceText).slice(0, 12);
    const root = { ...createFunctionNode(), id: `function:negative:${identity}`, filePath: `/workspace/${identity}.ts`, name: "root", qualifiedName: "root", range: { startLine: line, startCharacter: 0, endLine: line, endCharacter: 200 }, selectionRange: { startLine: line, startCharacter: 16, endLine: line, endCharacter: 20 } };
    const logic = analyzeFunctionLogic({ functionNode: root, sourceText });
    return analyzeFunctionTutorDeclaration({ functionNode: root, sourceText, functionLogic: logic });
  };
  const rejected: Array<[string, string, string, number]> = [
    ["duplicate callable", "function f(){return true;} function f(){return false;}", "return f();", 0],
    ["duplicate class", "class C { constructor(){} m(){return true;} } class C { constructor(){} m(){return false;} }", "return new C().m();", 0],
    ["parameter shadow", "function f(){return true;}", "const f = value as () => boolean; return f();", 0],
    ["class shadow at new", "class C { constructor(){} m(){return true;} }", "const C = value as unknown as { new(): unknown }; return new C();", 0],
    ["let receiver", "class C { constructor(){} m(){return true;} }", "let receiver = new C(); return receiver.m();", 1],
    ["reassigned receiver", "class C { constructor(){} m(){return true;} }", "let receiver = new C(); receiver = value as C; return receiver.m();", 1],
    ["computed receiver", "class C { constructor(){} m(){return true;} }", "const receiver = new C(); return receiver['m']();", 1],
    ["derived class", "class C { constructor(){} m(){return true;} } class D extends C { constructor(){ super(); } }", "const receiver = new D(); return receiver.m();", 0],
    ["instance as static", "class C { constructor(){} m(){return true;} }", "return C.m();", 0],
    ["static as instance", "class C { constructor(){} static m(){return true;} }", "const receiver = new C(); return receiver.m();", 1]
  ];
  for (const [label, prefix, body, expectedLinks] of rejected) {
    const catalog = catalogFor(prefix, body).scenarioCatalog;
    assert.equal(catalog?.resolutions.length, expectedLinks, label);
    if (expectedLinks) assert.equal(catalog?.resolutions[0]?.invocationRole, "constructor", `${label}: only constructor is proven`);
  }
  const unknownOptional = catalogFor("", "const receiver = value as { m(): boolean }; return receiver?.m();");
  const nullOptional = catalogFor("", "return (null as { m(): boolean } | null)?.m();");
  const undefinedOptional = catalogFor("", "return (undefined as { m(): boolean } | undefined)?.m();");
  const optionalDisposition = (analysis: ReturnType<typeof catalogFor>) => analysis.program.blocks.flatMap((block) => block.terminal?.kind === "return" && block.terminal.value?.kind === "direct-call" ? [block.terminal.value.optionalDisposition] : []).at(0);
  assert.equal(unknownOptional.scenarioCatalog?.resolutions.length, 0);
  assert.equal(nullOptional.scenarioCatalog?.resolutions.length, 0);
  assert.equal(undefinedOptional.scenarioCatalog?.resolutions.length, 0);
  assert.equal(optionalDisposition(unknownOptional), "unknown");
  assert.equal(optionalDisposition(nullOptional), "absent");
  assert.equal(optionalDisposition(undefinedOptional), "absent");
  const presentObject = catalogFor("const runner = { m(){ return true; } };", "return runner?.m();");
  assert.equal(presentObject.scenarioCatalog?.resolutions.length, 1);
  assert.equal(optionalDisposition(presentObject), "present");
  const isolated = catalogFor("class A { m(){return true;} } class B { m(){return false;} }", "const a = new A(); const b = new B(); return a.m() && b.m();");
  const methods = isolated.scenarioCatalog?.resolutions.filter((item) => item.invocationRole === "method") ?? [];
  assert.equal(methods.length, 2);
  assert.notEqual(methods[0]?.ownerId, methods[1]?.ownerId);
  assert.notEqual(methods[0]?.targetId, methods[1]?.targetId);
});

test("projects and evaluates advanced private Scenario calls from TS and JS roots without graph method edges", async () => {
  for (const extension of ["ts", "js"] as const) {
    const sourceText = readFileSync(resolve(process.cwd(), `src/test/fixtures/functionLogic/scenario_advanced_calls.${extension}`), "utf8");
    const start = sourceText.indexOf("export async function advancedScenario"); const startLine = sourceText.slice(0, start).split("\n").length - 1;
    const root = { ...createFunctionNode(), id: `function:advanced:${extension}`, filePath: `/workspace/scenario_advanced_calls.${extension}`, language: extension === "ts" ? "typescript" : "javascript", name: "advancedScenario", qualifiedName: "advancedScenario", range: { startLine, startCharacter: 0, endLine: startLine + 9, endCharacter: 1 }, selectionRange: { startLine, startCharacter: 21, endLine: startLine, endCharacter: 37 } };
    const logic = analyzeFunctionLogic({ functionNode: root, sourceText }); const declaration = analyzeFunctionTutorDeclaration({ functionNode: root, sourceText, functionLogic: logic });
    const graph = createGraph({ files: [root.filePath], callables: [root] }); const insights = new CodeFlowInsightCache().get(graph);
    const model = await buildFunctionTutorModel({ graph, declaration, functionLogic: logic, architectureIndex: insights.functionArchitecture, semanticFlows: insights.semanticFlows, functionIndex: insights.functionIndex, readSourceText: async () => sourceText });
    const blockIds = new Map(logic.blocks.map((block) => [block.id, `block:${block.id}`])); const edgeIds = new Map(logic.edges.map((edge) => [edge.id, `edge:${edge.id}`])); const bindingIds = new Map((logic.valueBindings || []).map((binding) => [binding.id, `binding:${binding.id}`]));
    const payload = createFunctionTutorPayload(model, { flowId: `code-flow:advanced:${extension}`, blockIds, edgeIds, bindingIds, createEvidenceToken: () => "code-evidence:advanced" });
    assert.ok(payload?.programBundle); const children = payload.programBundle!.programs.filter((program) => program.id !== payload.programBundle!.rootProgramId);
    assert.ok(children.some((program) => program.invocationRole === "constructor"));
    assert.ok(children.some((program) => program.fieldInitializers?.some((field) => field.key === "ready")), `${extension}: literal field initializer`);
    for (const program of children) assert.equal([...blockIds.values()].includes(program.entryBlockId), false);
    const rootProgram = payload.programBundle!.programs.find((program) => program.id === payload.programBundle!.rootProgramId)!;
    assert.equal(rootProgram.continuations?.length, 1, `${extension}: one logical continuation`);
    const continuation = rootProgram.continuations?.[0];
    assert.ok(continuation?.select);
    assert.ok(continuation?.supply);
    const continuationTerminal = rootProgram.blocks.find((block) => block.terminal?.continuationId === continuation?.id)?.terminal;
    assert.equal(continuationTerminal?.kind, "return");
    assert.equal(continuationTerminal?.value, undefined, `${extension}: terminal must not repeat the logical expression`);
    const expressions: unknown[] = [...(rootProgram.continuations ?? []).flatMap((item) => [item.select, item.supply])];
    const pending = [...expressions]; let fallbackCalls = 0;
    while (pending.length) { const expression = pending.pop() as { kind?: string; calleeName?: string; arguments?: unknown[]; receiver?: unknown; operand?: unknown; left?: unknown; right?: unknown; members?: unknown[]; condition?: unknown; whenTrue?: unknown; whenFalse?: unknown }; if (!expression || typeof expression !== "object") continue; if (expression.kind === "direct-call" && expression.calleeName === "enabled") fallbackCalls += 1; for (const child of [...(expression.arguments ?? []), expression.receiver, expression.operand, expression.left, expression.right, ...(expression.members ?? []), expression.condition, expression.whenTrue, expression.whenFalse]) if (child) pending.push(child); }
    assert.equal(fallbackCalls, 1, `${extension}: fallback call occurs in one projected expression`);
    const factory = new Function("readFunctionLogicValuePreview", "readFunctionLogicScenarioEditableBindings", "projectAnalyzerText", `${getFunctionLogicScenarioEvaluatorBrowserSource()}${getFunctionLogicScenarioEvaluationBrowserSource()}${getFunctionTutorBrowserSource()} return functionTutorRunScenario;`) as (reader: () => string, bindings: (values: unknown[]) => unknown[], text: (key: string) => string) => (tutor: NonNullable<typeof payload>, seed: Record<string, unknown>) => Array<{ terminal: { value?: { value?: unknown } }; blockIds: string[] }>;
    const run = factory(() => "", (values) => values, (key) => key);
    for (const input of [true, false]) {
      const paths = run(payload!, { inputs: [{ parameterId: payload!.parameters[0]!.id, value: { kind: "boolean", value: input } }], certainty: "exact" });
      assert.equal(paths.length, 1);
      assert.equal(paths[0]?.terminal.value?.value, input, JSON.stringify(paths[0]));
      if (!input) assert.equal(paths[0]?.terminal.value?.value, false, "raw explicit seed survives advanced private calls");
      assert.ok(paths[0]?.blockIds.every((id) => [...blockIds.values()].includes(id)));
      // The root records only root blocks; private async/generator/member work
      // is absent from its story while the source-backed object path reaches it.
      assert.ok(paths[0]?.blockIds.length);
    }
  }
});

test("logical-return continuations skip unsupported operands and do not invoke a fallback twice", async () => {
  const sourceText = [
    "class Counter {",
    "  count = 0;",
    "  constructor() {}",
    "  increment() { this.count += 1; return false; }",
    "  once() { return this.count === 1; }",
    "}",
    "export function root() { const counter = new Counter(); return counter.increment() || counter.once(); }",
    "export function skipped() { return true || unknownDynamic(); }"
  ].join("\n");
  const start = sourceText.indexOf("export function root"); const startLine = sourceText.slice(0, start).split("\n").length - 1;
  const root = { ...createFunctionNode(), id: "function:continuation", filePath: "/workspace/continuation.ts", name: "root", qualifiedName: "root", range: { startLine, startCharacter: 0, endLine: startLine, endCharacter: 100 }, selectionRange: { startLine, startCharacter: 16, endLine: startLine, endCharacter: 20 } };
  const logic = analyzeFunctionLogic({ functionNode: root, sourceText }); const declaration = analyzeFunctionTutorDeclaration({ functionNode: root, sourceText, functionLogic: logic });
  const graph = createGraph({ files: [root.filePath], callables: [root] }); const insights = new CodeFlowInsightCache().get(graph);
  const model = await buildFunctionTutorModel({ graph, declaration, functionLogic: logic, architectureIndex: insights.functionArchitecture, semanticFlows: insights.semanticFlows, functionIndex: insights.functionIndex, readSourceText: async () => sourceText });
  const payload = createFunctionTutorPayload(model, { flowId: "code-flow:continuation", blockIds: new Map(logic.blocks.map((block) => [block.id, `block:${block.id}`])), edgeIds: new Map(logic.edges.map((edge) => [edge.id, `edge:${edge.id}`])), bindingIds: new Map((logic.valueBindings ?? []).map((binding) => [binding.id, `binding:${binding.id}`])), createEvidenceToken: () => "code-evidence:continuation" });
  assert.equal(payload?.programBundle?.programs[0]?.continuations?.length, 1);
  const factory = new Function("readFunctionLogicValuePreview", "readFunctionLogicScenarioEditableBindings", "projectAnalyzerText", `${getFunctionLogicScenarioEvaluatorBrowserSource()}${getFunctionLogicScenarioEvaluationBrowserSource()}${getFunctionTutorBrowserSource()} return functionTutorRunScenario;`) as (reader: () => string, bindings: (values: unknown[]) => unknown[], text: (key: string) => string) => (tutor: NonNullable<typeof payload>, seed: Record<string, unknown>) => Array<{ terminal: { value?: { value?: unknown } } }>;
  const paths = factory(() => "", (values) => values, (key) => key)(payload!, { inputs: [], certainty: "exact" });
  assert.equal(paths[0]?.terminal.value?.value, true, JSON.stringify(paths[0]));
});

test("selected logical continuations skip unsupported supply expressions", async () => {
  for (const [name, expression] of [["or", "true || unknownDynamic()"], ["nullish-present", "true ?? unknownDynamic()"]] as const) {
    const sourceText = `export function root() { return ${expression}; }`;
    const root = { ...createFunctionNode(), id: `function:skip:${name}`, filePath: `/workspace/skip-${name}.ts`, name: "root", qualifiedName: "root", range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: sourceText.length }, selectionRange: { startLine: 0, startCharacter: 16, endLine: 0, endCharacter: 20 } };
    const logic = analyzeFunctionLogic({ functionNode: root, sourceText }); const declaration = analyzeFunctionTutorDeclaration({ functionNode: root, sourceText, functionLogic: logic });
    const graph = createGraph({ files: [root.filePath], callables: [root] }); const insights = new CodeFlowInsightCache().get(graph);
    const model = await buildFunctionTutorModel({ graph, declaration, functionLogic: logic, architectureIndex: insights.functionArchitecture, semanticFlows: insights.semanticFlows, functionIndex: insights.functionIndex, readSourceText: async () => sourceText });
    const payload = createFunctionTutorPayload(model, { flowId: `code-flow:skip:${name}`, blockIds: new Map(logic.blocks.map((block) => [block.id, `block:${block.id}`])), edgeIds: new Map(logic.edges.map((edge) => [edge.id, `edge:${edge.id}`])), bindingIds: new Map(), createEvidenceToken: () => "code-evidence:skip" });
    const factory = new Function("readFunctionLogicValuePreview", "readFunctionLogicScenarioEditableBindings", "projectAnalyzerText", `${getFunctionLogicScenarioEvaluatorBrowserSource()}${getFunctionLogicScenarioEvaluationBrowserSource()}${getFunctionTutorBrowserSource()} return functionTutorRunScenario;`) as (reader: () => string, bindings: (values: unknown[]) => unknown[], text: (key: string) => string) => (tutor: NonNullable<typeof payload>, seed: Record<string, unknown>) => Array<{ terminal: { value?: { value?: unknown } } }>;
    const paths = factory(() => "", (values) => values, (key) => key)(payload!, { inputs: [], certainty: "exact" });
    assert.equal(paths[0]?.terminal.value?.value, true, name);
  }
});

test("projects scenario_call_condition root identities exactly and keeps child identities private", async () => {
  const sourceText = readFileSync(resolve(process.cwd(), "src/test/fixtures/functionLogic/scenario_call_condition.ts"), "utf8");
  const root = { ...createFunctionNode(), id: "function:scenarioCallCondition", name: "scenarioCallCondition", qualifiedName: "scenarioCallCondition", range: { startLine: 5, startCharacter: 0, endLine: 8, endCharacter: 1 }, selectionRange: { startLine: 5, startCharacter: 16, endLine: 5, endCharacter: 37 } };
  const helper = { ...createFunctionNode(), id: "function:helper", name: "helper", qualifiedName: "helper", range: { startLine: 1, startCharacter: 0, endLine: 3, endCharacter: 1 }, selectionRange: { startLine: 1, startCharacter: 9, endLine: 1, endCharacter: 15 } };
  const logic = analyzeFunctionLogic({ functionNode: root, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: root, sourceText, functionLogic: logic });
  const graph = createGraph({ files: [root.filePath], callables: [root, helper] });
  graph.edges.push({ id: "call:helper", kind: "calls", sourceId: root.id, targetId: helper.id, filePath: root.filePath, range: { startLine: 6, startCharacter: 6, endLine: 6, endCharacter: 19 }, confidence: "exact" });
  const insights = new CodeFlowInsightCache().get(graph);
  const model = await buildFunctionTutorModel({ graph, declaration, functionLogic: logic, architectureIndex: insights.functionArchitecture, semanticFlows: insights.semanticFlows, functionIndex: insights.functionIndex, readSourceText: async () => sourceText });
  const blockIds = new Map(logic.blocks.map((block) => [block.id, `block:${block.id}`]));
  const edgeIds = new Map(logic.edges.map((edge) => [edge.id, `edge:${edge.id}`]));
  const bindingIds = new Map((logic.valueBindings || []).map((binding) => [binding.id, `binding:${binding.id}`]));
  const payload = createFunctionTutorPayload(model, { flowId: "code-flow:scenario", blockIds, edgeIds, bindingIds, createEvidenceToken: () => "code-evidence:scenario" });
  const rootProgram = payload?.programBundle?.programs.find((program) => program.id === payload.programBundle?.rootProgramId);
  assert.ok(rootProgram);
  assert.equal(rootProgram?.blocks.every((block) => [...blockIds.values()].includes(block.blockId)), true);
  assert.equal(rootProgram?.edges.every((edge) => [...edgeIds.values()].includes(edge.edgeId)), true);
  assert.equal(rootProgram?.bindings.every((binding) => [...bindingIds.values()].includes(binding.bindingId)), true);
  assert.equal(rootProgram?.blocks.flatMap((block) => block.decision?.outcomes || []).every((outcome) => [...edgeIds.values()].includes(outcome.edgeId)), true);
  assert.equal(payload?.programBundle?.programs.filter((program) => program.id !== rootProgram?.id).every((program) => !program.blocks.some((block) => [...blockIds.values()].includes(block.blockId))), true);
});

test("scenarioMotion keeps root assignments in the shared Workspace story", async () => {
  const sourceText = readFileSync(resolve(process.cwd(), "src/test/fixtures/functionLogic/scenario_call_condition.ts"), "utf8");
  const line = sourceText.slice(0, sourceText.indexOf("function scenarioMotion")).split("\n").length - 1;
  const root = { ...createFunctionNode(), id: "function:scenarioMotion", name: "scenarioMotion", qualifiedName: "scenarioMotion", range: { startLine: line, startCharacter: 0, endLine: line + 5, endCharacter: 1 }, selectionRange: { startLine: line, startCharacter: 16, endLine: line, endCharacter: 30 } };
  const logic = analyzeFunctionLogic({ functionNode: root, sourceText }); const declaration = analyzeFunctionTutorDeclaration({ functionNode: root, sourceText, functionLogic: logic });
  const graph = createGraph({ files: [root.filePath], callables: [root] }); const insights = new CodeFlowInsightCache().get(graph);
  const model = await buildFunctionTutorModel({ graph, declaration, functionLogic: logic, architectureIndex: insights.functionArchitecture, semanticFlows: insights.semanticFlows, functionIndex: insights.functionIndex, readSourceText: async () => sourceText });
  const blockIds = new Map(logic.blocks.map((block) => [block.id, `block:${block.id}`])); const edgeIds = new Map(logic.edges.map((edge) => [edge.id, `edge:${edge.id}`])); const bindingIds = new Map((logic.valueBindings || []).map((binding) => [binding.id, `binding:${binding.id}`]));
  const payload = createFunctionTutorPayload(model, { flowId: "code-flow:motion", blockIds, edgeIds, bindingIds, createEvidenceToken: () => "code-evidence:motion" }); assert.ok(payload);
  const factory = new Function("readFunctionLogicValuePreview", "readFunctionLogicScenarioEditableBindings", "projectAnalyzerText", `${getFunctionLogicScenarioEvaluatorBrowserSource()}${getFunctionLogicScenarioEvaluationBrowserSource()}${getFunctionTutorBrowserSource()} return functionTutorRunScenario;`) as (reader: () => string, bindings: (values: unknown[]) => unknown[], text: (key: string) => string) => (tutor: typeof payload, seed: Record<string, unknown>) => Array<{ edgeIds: string[]; terminal: { value?: { value?: unknown } }; transitions: Array<{ targetBindingId: string; after: { value?: unknown } }> }>;
  const run = factory(() => "", (bindings) => bindings, (key) => key);
  const paths = run(payload, { inputs: [{ parameterId: payload.parameters[0]!.id, value: { kind: "boolean", value: false } }], certainty: "exact" });
  const scoreBindingId = [...bindingIds.entries()].find(([id]) => logic.valueBindings?.find((binding) => binding.id === id)?.name === "score")?.[1];
  assert.deepEqual(paths[0]?.transitions.filter((transition) => transition.targetBindingId === scoreBindingId).map((transition) => transition.after.value), [0, 2, 6]);
  assert.equal(paths[0]?.edgeIds.filter((edgeId) => edgeId === payload.program.edges.find((edge) => edge.kind === "false")?.edgeId).length, 1);
  assert.equal(paths[0]?.terminal.value?.value, 6);
  const truePath = run(payload, { inputs: [{ parameterId: payload.parameters[0]!.id, value: { kind: "boolean", value: true } }], certainty: "exact" })[0];
  assert.deepEqual(truePath?.transitions.filter((transition) => transition.targetBindingId === scoreBindingId).map((transition) => transition.after.value), [1, 3, 9], JSON.stringify({ blocks: payload.programBundle?.programs.find((program) => program.id === payload.programBundle?.rootProgramId)?.blocks, edges: payload.program.edges, path: truePath }));
  assert.equal(truePath?.edgeIds.filter((edgeId) => edgeId === payload.program.edges.find((edge) => edge.kind === "true")?.edgeId).length, 1);
  assert.equal(truePath?.terminal.value?.value, 9);
});

test("Function Guide retains attached JSDoc as bounded source documentation", () => {
  const sourceText = [
    "/**",
    " * Applies a bounded member discount.",
    " * @param amount Requested amount.",
    " * @returns A static discount candidate.",
    " */",
    "export function discount(amount: number) { return amount; }"
  ].join("\n");
  const node = {
    ...createFunctionNode(),
    range: { startLine: 5, startCharacter: 0, endLine: 5, endCharacter: 58 },
    selectionRange: { startLine: 5, startCharacter: 16, endLine: 5, endCharacter: 24 }
  };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  assert.equal(declaration.documentation?.kind, "jsdoc");
  assert.equal(declaration.documentation?.summary, "Applies a bounded member discount.");
  assert.deepEqual(declaration.documentation?.tags, [
    { kind: "parameter", parameterName: "amount", text: "Requested amount." },
    { kind: "returns", text: "A static discount candidate." }
  ]);
  assert.equal(declaration.documentation?.evidence[0]?.range.startLine, 0);
});

test("Function Guide reads only the first Python body docstring and keeps detached text out", () => {
  const sourceText = [
    "# Detached comment.",
    "def discount(amount: int):",
    "  \"\"\"Returns a bounded amount.\"\"\"",
    "  return amount"
  ].join("\n");
  const node = {
    ...createFunctionNode(),
    language: "python",
    filePath: "/workspace/src/demo.py",
    range: { startLine: 1, startCharacter: 0, endLine: 3, endCharacter: 15 },
    selectionRange: { startLine: 1, startCharacter: 4, endLine: 1, endCharacter: 12 }
  };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  assert.equal(declaration.documentation?.kind, "docstring");
  assert.equal(declaration.documentation?.summary, "Returns a bounded amount.");
  assert.equal(declaration.documentation?.evidence[0]?.range.startLine, 2);
});

test("Function Guide derives bounded Python declaration facts from its parser-owned header", () => {
  const node = { ...createFunctionNode(), language: "python", filePath: "/workspace/src/demo.py" };
  const sourceText = "def discount(amount: int = 10, member: bool = False):\n  if amount >= 100:\n    return amount\n  return 0\n";
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({
    functionNode: node,
    sourceText,
    functionLogic: logic
  });
  assert.deepEqual(declaration.parameters.map((parameter) => parameter.name), ["amount", "member"]);
  assert.equal(declaration.parameters[0].typeKind, "number");
  assert.deepEqual(declaration.parameters[0].defaultValue, { kind: "number", value: 10 });
  assert.equal(declaration.parameters[1].typeKind, "boolean");
  assert.deepEqual(declaration.parameters[1].defaultValue, { kind: "boolean", value: false });
  assert.ok(declaration.constraints.some((constraint) => constraint.operator === "gte"));
});

test("Python address-sync scenarios preserve four complete effect paths and bounded loop prefixes", async () => {
  const fixturePath = resolve(process.cwd(), "src/test/fixtures/functionLogic/scenario_python_address_sync.py");
  const sourceText = readFileSync(fixturePath, "utf8");
  const lines = sourceText.split(/\r?\n/u);
  const startLine = lines.findIndex((line) => line.startsWith("def edit_director_ceo_address_change_event("));
  const node: SymbolNode = {
    id: "function:python-address-sync",
    kind: "function",
    name: "edit_director_ceo_address_change_event",
    qualifiedName: "edit_director_ceo_address_change_event",
    filePath: fixturePath,
    range: { startLine, startCharacter: 0, endLine: lines.length - 1, endCharacter: 0 },
    selectionRange: { startLine, startCharacter: 4, endLine: startLine, endCharacter: 42 },
    language: "python"
  };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  assert.deepEqual(declaration.parameters.map((parameter) => [parameter.name, parameter.typeKind]), [
    ["user", "unknown"],
    ["director", "unknown"],
    ["ceo_address_changes", "array"]
  ]);
  assert.equal(declaration.parameters[2]?.typeText, "list[CeoAddressChangeInput]");
  assert.deepEqual(logic.blocks.flatMap((block) => block.valueChanges?.map((change) => change.target) ?? []), [
    "event", "existing_events", "change", "new_events", "events_to_delete", "events_to_add"
  ]);
  assert.equal(logic.blocks.filter((block) => block.kind === "effect").length, 2);

  const graph = createGraph({ files: [fixturePath], callables: [node] });
  const insights = new CodeFlowInsightCache().get(graph);
  const model = await buildFunctionTutorModel({
    graph,
    declaration,
    functionLogic: logic,
    architectureIndex: insights.functionArchitecture,
    semanticFlows: insights.semanticFlows,
    functionIndex: insights.functionIndex,
    readSourceText: async () => sourceText
  });
  const baseline = model.seeds.find((seed) => seed.source === "type" || seed.source === "mixed");
  assert.ok(baseline);
  assert.deepEqual(baseline.inputs.map((input) => input.value.kind), ["unknown", "unknown", "array"]);
  assert.deepEqual(baseline.inputs[2]?.value, { kind: "array", items: [], truncated: false });

  const createScenarioTools = new Function(
    "projectAnalyzerText",
    `${getFunctionLogicScenarioPathPlannerBrowserSource()}\nreturn { plan: functionTutorPlanSymbolicPaths, resolve: functionTutorResolveScenarioPaths };`
  ) as (text: (key: string) => string) => {
    plan(tutor: Record<string, unknown>): Array<{
      limited: boolean;
      terminal: { kind: string };
      scenario: { decisions: Array<{ outcome: string }>; effects: Array<{ blockId: string; label: string }> };
    }>;
    resolve(tutor: Record<string, unknown>, seed: Record<string, unknown>, paths: Array<Record<string, unknown>>): Array<{
      limited: boolean;
      terminal: { kind: string };
      scenario: { decisions: Array<{ outcome: string }>; effects: Array<{ blockId: string; label: string }> };
    }>;
  };
  const scenarioTools = createScenarioTools((key) => key);
  const paths = scenarioTools.plan({ program: declaration.program });
  assert.equal(paths.length, 6);
  // Comprehension loops remain bounded source prefixes; they cannot imply that
  // a repeated loop completed or that a later database effect was reached.
  const loopPrefixes = paths.filter((path) => path.limited);
  assert.deepEqual(loopPrefixes.map((path) => path.scenario.decisions.map((decision) => decision.outcome)), [
    ["iterate"], ["exit", "iterate"]
  ]);
  assert.equal(loopPrefixes.every((path) => path.terminal.kind === "unknown" && path.scenario.effects.length === 0), true);
  const completePaths = paths.filter((path) => !path.limited);
  assert.equal(completePaths.length, 4);
  assert.equal(completePaths.every((path) => path.terminal.kind === "exit"), true);
  assert.deepEqual(new Set(completePaths.map((path) => path.scenario.decisions
    .filter((decision) => decision.outcome === "true" || decision.outcome === "false")
    .map((decision) => decision.outcome).join("/"))), new Set([
    "true/true", "true/false", "false/true", "false/false"
  ]));
  assert.deepEqual(completePaths.map((path) => path.scenario.effects.length).sort((left, right) => left - right), [0, 1, 1, 2]);

  const payload = createFunctionTutorPayload(model, {
    flowId: "code-flow:python-address-sync",
    blockIds: new Map(logic.blocks.map((block, index) => [block.id, `block-token-${index}`])),
    edgeIds: new Map(logic.edges.map((edge, index) => [edge.id, `edge-token-${index}`])),
    bindingIds: new Map((logic.valueBindings ?? []).map((binding, index) => [binding.id, `binding-token-${index}`])),
    createEvidenceToken: () => "code-evidence:python-address-sync"
  });
  assert.ok(payload);
  const projectedSeed = payload.seeds.find((seed) => seed.source === "type" || seed.source === "mixed");
  assert.ok(projectedSeed);
  assert.equal(projectedSeed.inputs.some((input) => input.value.kind === "unknown"), true);
  const projectedPaths = scenarioTools.resolve(payload as unknown as Record<string, unknown>, projectedSeed as unknown as Record<string, unknown>, [{
    blockIds: [payload.program.entryBlockId],
    edgeIds: [payload.program.edges[0]?.edgeId],
    transitions: [],
    terminal: { kind: "exit" },
    certainty: "inferred",
    limited: false
  }]);
  assert.equal(projectedPaths.length, 6, "an inferred mixed seed must preserve source branches and bounded loop prefixes");
  assert.equal(projectedPaths.filter((path) => path.limited).length, 2);
  // Summary projection also retains calls inside predicates. Count database
  // effect blocks separately so those source facts cannot inflate this matrix.
  const databaseEffectBlocks = new Set(payload.program.blocks.filter((block) => block.kind === "effect").map((block) => block.blockId));
  assert.equal(databaseEffectBlocks.size, 2);
  assert.deepEqual(projectedPaths.filter((path) => !path.limited)
    .map((path) => path.scenario.effects.filter((effect) => databaseEffectBlocks.has(effect.blockId)).length)
    .sort((left, right) => left - right), [0, 1, 1, 2]);
});

test("Function Guide derives Java parameter categories without claiming unavailable support", () => {
  const node = { ...createFunctionNode(), language: "java", filePath: "/workspace/src/Demo.java" };
  const sourceText = "class Demo { int discount(int amount, boolean member) { if (amount >= 100) return amount; return 0; } }";
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  assert.deepEqual(declaration.parameters.map((parameter) => parameter.name), ["amount", "member"]);
  assert.deepEqual(declaration.parameters.map((parameter) => parameter.typeKind), ["number", "boolean"]);
});

test("Function Guide preserves functional-language inputs as bounded unknown scenarios", () => {
  const node = { ...createFunctionNode(), language: "fsharp", filePath: "/workspace/src/demo.fs" };
  const sourceText = "let discount amount member = if member then amount else 0";
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  assert.deepEqual(declaration.parameters.map((parameter) => parameter.name), ["amount", "member"]);
  assert.equal(declaration.parameters.every((parameter) => parameter.typeKind === "unknown"), true);
});

test("Function Guide reads Elixir defaults without treating the default as an input name", () => {
  const node = { ...createFunctionNode(), language: "elixir", filePath: "/workspace/src/demo.ex" };
  const sourceText = "def discount(amount, member \\ false) do\n  if member, do: amount, else: 0\nend";
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  assert.deepEqual(declaration.parameters.map((parameter) => parameter.name), ["amount", "member"]);
  assert.deepEqual(declaration.parameters[1]?.defaultValue, { kind: "boolean", value: false });
});

test("Function Guide projects only opaque browser identities and bounded evidence tokens", async () => {
  const node = createFunctionNode();
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText: source });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText: source, functionLogic: logic });
  const graph = createGraph({ files: [filePath], callables: [node] });
  const insights = new CodeFlowInsightCache().get(graph);
  const model = await buildFunctionTutorModel({
    graph,
    declaration,
    functionLogic: logic,
    architectureIndex: insights.functionArchitecture,
    semanticFlows: insights.semanticFlows,
    functionIndex: insights.functionIndex,
    readSourceText: async () => source
  });
  const blockIds = new Map(logic.blocks.map((block, index) => [block.id, `block-token-${index}`]));
  const edgeIds = new Map(logic.edges.map((edge, index) => [edge.id, `edge-token-${index}`]));
  const bindingIds = new Map((logic.valueBindings ?? []).map((binding, index) => [binding.id, `binding-token-${index}`]));
  const payload = createFunctionTutorPayload(model, {
    flowId: "code-flow:token",
    blockIds,
    edgeIds,
    bindingIds,
    createEvidenceToken: () => "code-evidence:token"
  });
  assert.ok(payload);
  assert.equal(payload?.version, 3);
  assert.equal(payload?.guide.chapters.length, 5);
  const serialized = JSON.stringify(payload);
  assert.ok(Buffer.byteLength(serialized, "utf8") < 96 * 1024, "Function Guide payload must stay below 96 KiB");
  assert.doesNotMatch(serialized, new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.doesNotMatch(serialized, /function:discount/u);
  assert.match(serialized, /code-evidence:token/u);
});

test("Function Guide scenario interpreter remains bounded and never evaluates source strings", () => {
  const sourceText = getFunctionTutorBrowserSource();
  assert.doesNotMatch(sourceText, /\beval\s*\(/u);
  assert.doesNotMatch(sourceText, /\bnew Function\b/u);
  const runScenario = new Function(`${sourceText}\nreturn functionTutorRunScenario;`)() as (tutor: Record<string, unknown>, seed: Record<string, unknown>) => Array<Record<string, unknown>>;
  const finiteTutor = {
    program: {
      entryBlockId: "entry",
      bindings: [{ bindingId: "amount", parameterId: "parameter", name: "amount", kind: "parameter", certainty: "exact" }, { bindingId: "total", name: "total", kind: "local", certainty: "exact" }],
      blocks: [{ blockId: "entry", kind: "entry", operations: [] }, {
        blockId: "calculate", kind: "operation", operations: [{ kind: "define", bindingId: "total", value: { kind: "binary", operator: "add", left: { kind: "binding", bindingId: "amount" }, right: { kind: "literal", value: { kind: "number", value: 5 } } } }], terminal: { kind: "return", value: { kind: "binding", bindingId: "total" } }
      }],
      edges: [{ edgeId: "next", sourceBlockId: "entry", targetBlockId: "calculate", kind: "next", certainty: "exact" }]
    }
  };
  const seed = { certainty: "exact", inputs: [{ parameterId: "parameter", value: { kind: "number", value: 10 } }] };
  const finite = runScenario(finiteTutor, seed);
  assert.deepEqual(finite[0]?.terminal, { kind: "return", value: { kind: "number", value: 15 } });
  const loopingTutor = {
    program: {
      entryBlockId: "loop",
      bindings: [],
      blocks: [{ blockId: "loop", kind: "loop", operations: [] }],
      edges: [{ edgeId: "repeat", sourceBlockId: "loop", targetBlockId: "loop", kind: "back", certainty: "exact" }]
    }
  };
  const looping = runScenario(loopingTutor, { certainty: "exact", inputs: [] });
  assert.equal(looping[0]?.limited, true);
  assert.equal((looping[0]?.terminal as { reason?: string } | undefined)?.reason, "loop-budget");
});

function createFunctionNode(): SymbolNode {
  return {
    id: "function:discount",
    kind: "function",
    name: "discount",
    qualifiedName: "discount",
    filePath,
    range: { startLine: 0, startCharacter: 0, endLine: 5, endCharacter: 1 },
    selectionRange: { startLine: 0, startCharacter: 16, endLine: 0, endCharacter: 24 },
    language: "typescript"
  };
}
