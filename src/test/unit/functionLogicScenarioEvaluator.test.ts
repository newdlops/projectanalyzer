/**
 * Browser-source tests for the safe Function Logic Scenario evaluator. They
 * exercise scalar parsing, expression stacks, CFG merges, and selected edges
 * without relying on a full DOM runtime.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  getFunctionLogicScenarioEvaluatorBrowserSource,
  getFunctionLogicScenarioTraceBrowserSource
} from "../../webview/codeFlow/valuePreview";

type ScenarioState = {
  kind: "known" | "unknown" | "unset";
  value?: unknown;
  reason?: string;
  reasonDescriptor?: {
    key: string;
    values: Record<string, string | number | boolean>;
    fallback?: string;
  };
  origins: string[];
};

type ScenarioCalculation = {
  recordsByBlockId: Map<string, {
    before: Map<string, ScenarioState>;
    after: Map<string, ScenarioState>;
    transitions: Array<{
      targetName: string;
      before: ScenarioState;
      after: ScenarioState;
      valueRef?: { rootBindingId: string; path: string[] };
    }>;
  }>;
  inputStateByBindingId: Map<string, ScenarioState>;
  truncated: boolean;
};

type ScenarioEvaluator = {
  calculate(
    logic: Record<string, unknown>,
    nodes: Map<string, FakeClassRecord>,
    edges: Map<string, { path: FakeClassRecord }>,
    scenarioIdentity?: { resolveScenarioBindingId?(id: string): string | undefined }
  ): ScenarioCalculation;
  createContext(bindings: Array<Record<string, unknown>>): unknown;
  evaluate(expression: string, environment: Map<string, ScenarioState>, context: unknown): ScenarioState;
  format(state: ScenarioState): string;
  known(value: unknown, origins: string[]): ScenarioState;
  parse(value: string, bindingId: string): ScenarioState;
};

type FakeClassRecord = {
  classList: { contains(name: string): boolean };
};

test("parses bounded JSON and scalar Scenario inputs without dynamic execution", () => {
  const evaluator = loadScenarioEvaluator(new Map());

  assert.deepEqual(evaluator.parse("42", "input"), {
    kind: "known",
    value: 42,
    origins: ["input"]
  });
  assert.deepEqual(evaluator.parse("{'not': 'json'}", "input").kind, "unknown");
  assert.deepEqual(evaluator.parse('{"ready":true,"items":[2,3]}', "input").value, {
    ready: true,
    items: [2, 3]
  });
  assert.equal(evaluator.parse("'hello'", "input").value, "hello");
  assert.equal(evaluator.parse("True", "input").value, true);
});

test("formats canonical Scenario field segments in emitted browser source", () => {
  const format = new Function(`${getFunctionLogicScenarioTraceBrowserSource()}; return formatFunctionLogicScenarioCanonicalFieldSegment;`)() as (key: string) => string;
  assert.equal(format("1"), "[1]");
  assert.equal(format("01"), '["01"]');
  assert.equal(format("key"), ".key");
});

test("calculates complex booleans, nested ternaries, assignments, and updates", () => {
  const previews = new Map([
    ["input", "4"],
    ["ready", "true"]
  ]);
  const evaluator = loadScenarioEvaluator(previews);
  const logic = createLinearCalculationLogic();
  const calculation = evaluator.calculate(logic, createEnabledNodes(logic), new Map());

  assert.equal(readKnown(calculation, "choose", "adjusted"), 8);
  assert.equal(readKnown(calculation, "derive", "total"), 11);
  assert.equal(readKnown(calculation, "update", "total"), 13);
  assert.equal(calculation.truncated, false);

  const bindings = logic.valueBindings as Array<Record<string, unknown>>;
  const environment = new Map([
    ["input", evaluator.known(4, ["input"])],
    ["ready", evaluator.known(true, ["ready"])]
  ]);
  const state = evaluator.evaluate(
    "ready && input >= 4 ? input > 5 ? 99 : input * 3 : 0",
    environment,
    evaluator.createContext(bindings)
  );
  assert.equal(state.kind, "known");
  assert.equal(state.value, 12);
});

test("follows selected control edges and reports ambiguous unselected merges", () => {
  const previews = new Map([["input", "4"]]);
  const evaluator = loadScenarioEvaluator(previews);
  const logic = createBranchCalculationLogic();
  const allEnabled = evaluator.calculate(logic, createEnabledNodes(logic), new Map());
  assert.equal(allEnabled.recordsByBlockId.get("join")?.after.get("result")?.kind, "unknown");
  assert.match(
    allEnabled.recordsByBlockId.get("join")?.after.get("result")?.reason ?? "",
    /multiple reachable values/u
  );

  const selectedNodes = createEnabledNodes(logic, new Set(["when-false"]));
  const selectedEdges = new Map([
    ["false-edge", { path: createClassRecord(new Set(["choice-dimmed"])) }]
  ]);
  const selected = evaluator.calculate(logic, selectedNodes, selectedEdges);
  assert.equal(readKnown(selected, "join", "result"), 10);
});

test("leaves calls and unsupported runtime behavior explicitly unknown", () => {
  const evaluator = loadScenarioEvaluator(new Map([["input", "3"]]));
  const bindings = [{
    id: "input",
    name: "input",
    kind: "parameter",
    definitionBlockId: "entry",
    confidence: "exact"
  }];
  const environment = new Map([["input", evaluator.known(3, ["input"])]]);
  const result = evaluator.evaluate(
    "danger(input)",
    environment,
    evaluator.createContext(bindings)
  );

  assert.equal(result.kind, "unknown");
  assert.deepEqual(result.reasonDescriptor, {
    key: "scenario-reason-calls-static",
    values: {}
  });
  assert.deepEqual(result.origins, ["input"]);

  const unsupportedToken = evaluator.evaluate("input @ 2", environment, evaluator.createContext(bindings));
  assert.deepEqual(unsupportedToken.reasonDescriptor, {
    key: "scenario-reason-unsupported-token",
    values: { token: "@" }
  });

  const unsupportedOperator = evaluator.evaluate("input <<", environment, evaluator.createContext(bindings));
  assert.equal(unsupportedOperator.reasonDescriptor?.key, "scenario-reason-expression-operator-end");
});

test("evaluates opaque direct and two-level Scenario calls without Host or source execution", () => {
  const previews = new Map([["input", "4"]]);
  const evaluator = loadScenarioEvaluator(previews);
  const literal = (value: number) => ({ kind: "literal", value: { kind: "number", value } });
  const binding = (bindingId: string) => ({ kind: "binding", bindingId });
  const call = (callId: string, argument: Record<string, unknown>) => ({ kind: "direct-call", calleeName: "display-only", callId, certainty: "exact", arguments: [argument] });
  const program = (id: string, parameter: string, result: string, value: Record<string, unknown>, returnValue: Record<string, unknown>) => ({
    id, executionKind: "sync", confidence: "exact", entryBlockId: `${id}-entry`,
    bindings: [{ bindingId: parameter, parameterId: `${id}-parameter`, parameterIndex: 0, name: "value", kind: "parameter", certainty: "exact" }, { bindingId: result, name: "result", kind: "local", certainty: "exact" }],
    blocks: [{ blockId: `${id}-entry`, kind: "entry", label: "", evidenceTokens: [], operations: [{ kind: "define", bindingId: result, value }], terminal: { kind: "return", value: returnValue } }], edges: []
  });
  const leaf = program("leaf", "leaf-input", "leaf-result", { kind: "binary", operator: "add", left: binding("leaf-input"), right: literal(1) }, binding("leaf-result"));
  const helper = program("helper", "helper-input", "helper-result", call("helper-leaf", binding("helper-input")), binding("helper-result"));
  const root = program("root", "input", "result", call("root-helper", binding("input")), binding("result"));
  const logic = { valueBindings: [{ id: "input", name: "input", kind: "parameter", confidence: "exact" }], blocks: [], edges: [], tutor: { programBundle: { rootProgramId: "root", programs: [root, helper, leaf], links: [{ callerProgramId: "root", calleeProgramId: "helper", callId: "root-helper" }, { callerProgramId: "helper", calleeProgramId: "leaf", callId: "helper-leaf" }], omittedLinks: [] } } };
  const calculation = evaluator.calculate(logic, new Map(), new Map());
  assert.equal(calculation.recordsByBlockId.get("root-entry")?.after.get("result")?.value, 5);
  previews.set("input", "8");
  assert.equal(evaluator.calculate(logic, new Map(), new Map()).recordsByBlockId.get("root-entry")?.after.get("result")?.value, 9);
});

test("loop occurrence order retains each bounded visit, mutation, exit, and continuation", () => {
  const evaluator = loadScenarioEvaluator(new Map());
  const literal = (value: number) => ({ kind: "literal", value: { kind: "number", value } });
  const binding = (bindingId: string) => ({ kind: "binding", bindingId });
  const root = {
    id: "root", executionKind: "sync", entryBlockId: "entry",
    bindings: [{ bindingId: "i", name: "i", kind: "local", certainty: "exact" }],
    blocks: [
      { blockId: "entry", operations: [{ kind: "define", bindingId: "i", value: literal(0) }] },
      { blockId: "loop", decision: { expression: { kind: "binary", operator: "lt", left: binding("i"), right: literal(2) }, outcomes: [{ edgeId: "loop-body", matches: "true" }, { edgeId: "loop-exit", matches: "false" }] }, operations: [] },
      { blockId: "body", operations: [{ kind: "increment", target: { kind: "binding", bindingId: "i" }, delta: 1 }] },
      { blockId: "after", operations: [], terminal: { kind: "return", value: binding("i") } }
    ],
    edges: [
      { edgeId: "entry-loop", sourceBlockId: "entry", targetBlockId: "loop", kind: "next" },
      { edgeId: "loop-body", sourceBlockId: "loop", targetBlockId: "body", kind: "true" },
      { edgeId: "body-loop", sourceBlockId: "body", targetBlockId: "loop", kind: "next" },
      { edgeId: "loop-exit", sourceBlockId: "loop", targetBlockId: "after", kind: "false" }
    ]
  };
  const logic = { valueBindings: [], blocks: [], edges: [], tutor: { programBundle: { rootProgramId: "root", programs: [root], links: [], omittedLinks: [] } } };
  const path = (evaluator.calculate(logic, new Map(), new Map()) as ScenarioCalculation & { scenarioPaths: Array<{ occurrences: Array<{ blockId: string; selectedEdgeId?: string; transitions: Array<{ before: ScenarioState; after: ScenarioState }> }> }> }).scenarioPaths[0];

  assert.deepEqual(path.occurrences.map((occurrence) => occurrence.blockId), ["entry", "loop", "body", "loop", "body", "loop", "after"]);
  assert.deepEqual(path.occurrences.map((occurrence) => occurrence.selectedEdgeId), ["entry-loop", "loop-body", "body-loop", "loop-body", "body-loop", "loop-exit", undefined]);
  assert.deepEqual(path.occurrences.filter((occurrence) => occurrence.blockId === "body").map((occurrence) => [occurrence.transitions[0].before.value, occurrence.transitions[0].after.value]), [[0, 1], [1, 2]]);
});

test("seeds raw root programs from exactly resolved visible Scenario inputs", () => {
  const previews = new Map([["visible-input", "false"]]);
  const evaluator = loadScenarioEvaluator(previews);
  const root = {
    id: "root", executionKind: "sync", entryBlockId: "raw-entry",
    bindings: [{ bindingId: "raw-input", parameterId: "root-param", parameterIndex: 0 }],
    blocks: [{ blockId: "raw-entry", operations: [], terminal: { kind: "return", value: { kind: "binding", bindingId: "raw-input" } } }], edges: []
  };
  const logic = { valueBindings: [{ id: "visible-input", name: "input", kind: "parameter", confidence: "exact" }], blocks: [], edges: [], tutor: { programBundle: { rootProgramId: "root", programs: [root], links: [], omittedLinks: [] } } };
  const resolve = { resolveScenarioBindingId: (id: string) => id === "raw-input" ? "visible-input" : undefined };
  const exact = evaluator.calculate(logic, new Map(), new Map(), resolve) as ScenarioCalculation & { scenarioPaths: Array<{ terminal: { value?: { value?: unknown } } }> };
  assert.equal(exact.inputStateByBindingId.get("raw-input")?.value, false);
  assert.equal(exact.scenarioPaths[0].terminal.value?.value, false);

  const missing = evaluator.calculate(logic, new Map(), new Map(), { resolveScenarioBindingId: () => undefined }) as ScenarioCalculation & { scenarioPaths: Array<{ terminal: { value?: { kind?: string } } }> };
  assert.equal(missing.inputStateByBindingId.get("raw-input")?.kind, "unknown");
  assert.equal(missing.scenarioPaths[0].terminal.value?.kind, "unknown");

  const collidedRoot = { ...root, bindings: [...root.bindings, { bindingId: "raw-other", parameterId: "other", parameterIndex: 1 }] };
  const collided = evaluator.calculate({ ...logic, tutor: { programBundle: { ...logic.tutor.programBundle, programs: [collidedRoot] } } }, new Map(), new Map(), { resolveScenarioBindingId: () => "visible-input" });
  assert.equal(collided.inputStateByBindingId.get("raw-input")?.kind, "unknown");
});

test("selects opaque root decision edges from direct and nested call return values", () => {
  const previews = new Map([["input", "true"]]);
  const evaluator = loadScenarioEvaluator(previews);
  const literal = (value: boolean) => ({ kind: "literal", value: { kind: "boolean", value } });
  const binding = (bindingId: string) => ({ kind: "binding", bindingId });
  const call = (callId: string, argument: Record<string, unknown>) => ({ kind: "direct-call", calleeName: "display-only", callId, certainty: "exact", arguments: [argument] });
  const leaf = { id: "leaf", executionKind: "sync", entryBlockId: "leaf-entry", bindings: [{ bindingId: "leaf-input", parameterId: "leaf-param", parameterIndex: 0 }], blocks: [{ blockId: "leaf-entry", operations: [], terminal: { kind: "return", value: binding("leaf-input") } }], edges: [] };
  const helper = { id: "helper", executionKind: "sync", entryBlockId: "helper-entry", bindings: [{ bindingId: "helper-input", parameterId: "helper-param", parameterIndex: 0 }], blocks: [{ blockId: "helper-entry", operations: [], terminal: { kind: "return", value: call("helper-leaf", binding("helper-input")) } }], edges: [] };
  const root = { id: "root", executionKind: "sync", entryBlockId: "root-entry", bindings: [{ bindingId: "input", parameterId: "root-param", parameterIndex: 0 }], blocks: [{ blockId: "root-entry", operations: [], decision: { expression: call("root-helper", binding("input")), outcomes: [{ edgeId: "root-true", matches: "true" }, { edgeId: "root-false", matches: "false" }] } }, { blockId: "true-terminal", operations: [], terminal: { kind: "return", value: literal(true) } }, { blockId: "false-terminal", operations: [], terminal: { kind: "return", value: literal(false) } }], edges: [{ edgeId: "root-true", sourceBlockId: "root-entry", targetBlockId: "true-terminal", kind: "true" }, { edgeId: "root-false", sourceBlockId: "root-entry", targetBlockId: "false-terminal", kind: "false" }] };
  const logic = { valueBindings: [{ id: "input", name: "input", kind: "parameter", confidence: "exact" }], blocks: [], edges: [], tutor: { programBundle: { rootProgramId: "root", programs: [root, helper, leaf], links: [{ callerProgramId: "root", calleeProgramId: "helper", callId: "root-helper" }, { callerProgramId: "helper", calleeProgramId: "leaf", callId: "helper-leaf" }], omittedLinks: [] } } };
  const truePath = (evaluator.calculate(logic, new Map(), new Map()) as ScenarioCalculation & { scenarioPaths: Array<{ edgeIds: string[]; blockIds: string[]; terminal: { kind: string } }> }).scenarioPaths[0];
  assert.deepEqual(truePath.edgeIds, ["root-true"]);
  assert.deepEqual(truePath.blockIds, ["root-entry", "true-terminal"]);
  assert.equal(truePath.terminal.kind, "return");
  previews.set("input", "false");
  const falsePath = (evaluator.calculate(logic, new Map(), new Map()) as ScenarioCalculation & { scenarioPaths: Array<{ edgeIds: string[]; blockIds: string[]; terminal: { kind: string } }> }).scenarioPaths[0];
  assert.deepEqual(falsePath.edgeIds, ["root-false"]);
  assert.deepEqual(falsePath.blockIds, ["root-entry", "false-terminal"]);
});

test("requires await for async children and short-circuits a statically absent optional call", () => {
  const evaluator = loadScenarioEvaluator(new Map());
  const literal = (value: boolean) => ({ kind: "literal", value: { kind: "boolean", value } });
  const asyncChild = { id: "async-child", executionKind: "async", entryBlockId: "child-entry", bindings: [], blocks: [{ blockId: "child-entry", operations: [], terminal: { kind: "return", value: literal(true) } }], edges: [] };
  const awaited = { id: "root", executionKind: "sync", entryBlockId: "root-entry", bindings: [], blocks: [{ blockId: "root-entry", operations: [], terminal: { kind: "return", value: { kind: "await", operand: { kind: "direct-call", calleeName: "display", callId: "awaited", certainty: "exact", arguments: [] } } } }], edges: [] };
  const bare = { ...awaited, id: "bare", blocks: [{ blockId: "root-entry", operations: [], terminal: { kind: "return", value: { kind: "direct-call", calleeName: "display", callId: "bare", certainty: "exact", arguments: [] } } }] };
  const absent = { ...awaited, id: "absent", blocks: [{ blockId: "root-entry", operations: [], terminal: { kind: "return", value: { kind: "direct-call", calleeName: "display", invocationKind: "optional-direct", optionalDisposition: "absent", certainty: "exact", arguments: [{ kind: "unsupported", reason: "dynamic-call", summary: "must not run" }] } } }] };
  const run = (root: Record<string, unknown>, links: Array<Record<string, string>> = []) => {
    return evaluator.calculate({ valueBindings: [], tutor: { programBundle: { rootProgramId: String(root.id), programs: [root, asyncChild], links, omittedLinks: [] } } }, new Map(), new Map()) as unknown as ScenarioCalculation & { scenarioPaths: Array<{ terminal: { value?: { value?: unknown; kind: string } } }> };
  };
  assert.equal(run(awaited, [{ callerProgramId: "root", calleeProgramId: "async-child", callId: "awaited" }]).scenarioPaths[0].terminal.value?.value, true);
  assert.equal(run(bare, [{ callerProgramId: "bare", calleeProgramId: "async-child", callId: "bare" }]).scenarioPaths[0].terminal.value?.kind, "unknown");
  assert.equal(run(absent).scenarioPaths[0].terminal.value?.kind, "undefined");
});

test("creates dormant synchronous iterators and consumes bounded next values without root child records", () => {
  const evaluator = loadScenarioEvaluator(new Map());
  const generator = { id: "generator", executionKind: "generator", entryBlockId: "g", bindings: [], generatorYields: [{ kind: "literal", value: { kind: "number", value: 2 } }, { kind: "literal", value: { kind: "number", value: 3 } }], generatorReturn: { kind: "literal", value: { kind: "number", value: 4 } }, blocks: [{ blockId: "g", operations: [] }], edges: [] };
  const next = (bindingId: string) => ({ kind: "direct-call", calleeName: "display", invocationKind: "iterator-next", receiver: { kind: "binding", bindingId }, certainty: "exact", arguments: [] });
  const root = { id: "root", executionKind: "sync", entryBlockId: "entry", bindings: [], blocks: [{ blockId: "entry", operations: [{ kind: "define", bindingId: "iterator", value: { kind: "direct-call", calleeName: "display", callId: "make", certainty: "exact", arguments: [] } }, { kind: "define", bindingId: "first", value: next("iterator") }, { kind: "define", bindingId: "second", value: next("iterator") }, { kind: "define", bindingId: "returned", value: next("iterator") }, { kind: "define", bindingId: "exhausted", value: next("iterator") }], terminal: { kind: "return", value: { kind: "member", object: { kind: "binding", bindingId: "exhausted" }, path: ["done"], optional: false } } }], edges: [] };
  const calculation = evaluator.calculate({ valueBindings: [], tutor: { programBundle: { rootProgramId: "root", programs: [root, generator], links: [{ callerProgramId: "root", calleeProgramId: "generator", callId: "make" }], omittedLinks: [] } } }, new Map(), new Map());
  const after = calculation.recordsByBlockId.get("entry")?.after;
  assert.equal((after?.get("first")?.value as { value: number }).value, 2); assert.equal((after?.get("first")?.value as { done: boolean }).done, false);
  assert.equal((after?.get("second")?.value as { value: number }).value, 3); assert.equal((after?.get("second")?.value as { done: boolean }).done, false);
  assert.equal((after?.get("returned")?.value as { value: number }).value, 4); assert.equal((after?.get("returned")?.value as { done: boolean }).done, true);
  assert.equal((after?.get("exhausted")?.value as { value: undefined }).value, undefined); assert.equal((after?.get("exhausted")?.value as { done: boolean }).done, true);
});

test("calculates immediate code text but never enters defined or deferred text", () => {
  const evaluator = loadScenarioEvaluator(new Map());
  const logic = {
    language: "typescript",
    valueBindings: [{
      id: "score", name: "score", kind: "local", definitionBlockId: "entry", confidence: "exact"
    }],
    blocks: [{
      id: "entry",
      kind: "entry",
      valueAccesses: [definition("score", "local")],
      valueChanges: [{
        target: "score", targetKind: "variable", operation: "initialize", operator: "=",
        value: "0", confidence: "exact"
      }]
    }, {
      id: "immediate",
      kind: "embedded",
      valueChanges: [{
        target: "score", targetKind: "variable", operation: "update", operator: "+=",
        value: "1", confidence: "exact"
      }]
    }, {
      id: "host",
      kind: "operation",
      valueChanges: [{
        target: "score", targetKind: "variable", operation: "update", operator: "+=",
        value: "1", confidence: "exact"
      }]
    }, {
      id: "stored",
      kind: "embedded",
      valueChanges: [{
        target: "score", targetKind: "variable", operation: "update", operator: "+=",
        value: "100", confidence: "exact"
      }]
    }, {
      id: "timer",
      kind: "embedded",
      valueChanges: [{
        target: "score", targetKind: "variable", operation: "update", operator: "+=",
        value: "1000", confidence: "exact"
      }]
    }],
    edges: [
      edge("entry-immediate", "entry", "immediate"),
      edge("immediate-host", "immediate", "host"),
      { ...edge("host-stored", "host", "stored"), kind: "defines" },
      { ...edge("host-timer", "host", "timer"), kind: "deferred" }
    ]
  };
  const calculation = evaluator.calculate(logic, createEnabledNodes(logic), new Map());

  assert.equal(readKnown(calculation, "host", "score"), 2);
  assert.equal(calculation.recordsByBlockId.has("stored"), false);
  assert.equal(calculation.recordsByBlockId.has("timer"), false);
});

test("reads JSON members and dynamic indexes without invoking prototype access", () => {
  const evaluator = loadScenarioEvaluator(new Map());
  const bindings = [{
    id: "payload", name: "payload", kind: "parameter", definitionBlockId: "entry",
    confidence: "exact"
  }, {
    id: "index", name: "index", kind: "parameter", definitionBlockId: "entry",
    confidence: "exact"
  }];
  const environment = new Map([
    ["payload", evaluator.known({ items: [2, 3] }, ["payload"])],
    ["index", evaluator.known(1, ["index"])]
  ]);
  const context = evaluator.createContext(bindings);

  assert.equal(evaluator.evaluate("payload.items[index] * 2", environment, context).value, 6);
  const inherited = evaluator.evaluate("payload.toString", environment, context);
  assert.equal(inherited.kind, "unknown");
  assert.deepEqual(inherited.reasonDescriptor, {
    key: "scenario-reason-member-unavailable",
    values: { member: "toString" }
  });
});

test("calculates nested JSON field writes, dynamic indexes, and deletes immutably", () => {
  const previews = new Map([
    ["payload", '{"profile":{"score":3},"status":"new","items":[4,6],"stale":true}'],
    ["index", "1"]
  ]);
  const evaluator = loadScenarioEvaluator(previews);
  const logic = createObjectFieldCalculationLogic();
  const calculation = evaluator.calculate(logic, createEnabledNodes(logic), new Map());
  assert.deepEqual(readKnown(calculation, "delete", "payload"), {
    profile: { score: 5 },
    status: "ready",
    items: [4, 7]
  });

  const statusTransition = calculation.recordsByBlockId.get("status")?.transitions[0];
  assert.equal(statusTransition?.targetName, 'payload["status"]');
  assert.equal(statusTransition?.before.value, "new");
  assert.equal(statusTransition?.after.value, "ready");
  const itemTransition = calculation.recordsByBlockId.get("item")?.transitions[0];
  assert.equal(itemTransition?.before.value, 6);
  assert.equal(itemTransition?.after.value, 7);
  assert.deepEqual(itemTransition?.valueRef, {
    rootBindingId: "payload",
    path: ["items", "1"],
    displayPath: "payload.items[index]",
    segments: [{ kind: "static", key: "items" }, { kind: "static", key: "1" }]
  });
  const deleteTransition = calculation.recordsByBlockId.get("delete")?.transitions[0];
  assert.equal(deleteTransition?.targetName, "payload.stale");
  assert.equal(deleteTransition?.before.value, true);
  assert.equal(deleteTransition?.after.kind, "unset");
  assert.deepEqual(evaluator.parse(previews.get("payload") ?? "", "payload").value, {
    profile: { score: 3 },
    status: "new",
    items: [4, 6],
    stale: true
  });
});

test("evaluates JSON source literals but blocks prototype-sensitive field writes", () => {
  const evaluator = loadScenarioEvaluator(new Map([["key", '"__proto__"']]));
  const literalLogic = createJsonLiteralCalculationLogic();
  const literal = evaluator.calculate(
    literalLogic,
    createEnabledNodes(literalLogic),
    new Map()
  );
  assert.deepEqual(readKnown(literal, "increment", "payload"), {
    nested: { count: 3 }
  });

  const blockedLogic = createBlockedObjectFieldLogic();
  const blocked = evaluator.calculate(
    blockedLogic,
    createEnabledNodes(blockedLogic),
    new Map()
  );
  const state = blocked.recordsByBlockId.get("blocked")?.after.get("payload");
  assert.equal(state?.kind, "unknown");
  assert.deepEqual(state?.reasonDescriptor, {
    key: "scenario-reason-object-prototype",
    values: { key: "__proto__" }
  });
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"), false);
});

/** Loads generated helpers with the Scenario editor's two public read interfaces. */
function loadScenarioEvaluator(previews: ReadonlyMap<string, string>): ScenarioEvaluator {
  const source = getFunctionLogicScenarioEvaluatorBrowserSource();
  const factory = new Function(
    "readFunctionLogicValuePreview",
    "readFunctionLogicScenarioEditableBindings",
    `${source}\nreturn {
      calculate: calculateFunctionLogicScenario,
      createContext: createFunctionLogicScenarioContext,
      evaluate: evaluateFunctionLogicScenarioExpression,
      format: formatFunctionLogicScenarioState,
      known: createFunctionLogicScenarioKnown,
      parse: parseFunctionLogicScenarioInput
    };`
  ) as (
    reader: (bindingId: string) => string,
    readBindings: (bindings: Array<Record<string, unknown>>) => Array<Record<string, unknown>>
  ) => ScenarioEvaluator;
  return factory(
    (bindingId) => previews.get(bindingId) ?? "",
    (bindings) => bindings
  );
}

/** Creates a chain that exercises transitive arithmetic and nested ternaries. */
function createLinearCalculationLogic(): Record<string, unknown> {
  const valueBindings = [{
    id: "input", name: "input", kind: "parameter", definitionBlockId: "entry", confidence: "exact"
  }, {
    id: "ready", name: "ready", kind: "parameter", definitionBlockId: "entry", confidence: "exact"
  }, {
    id: "adjusted", name: "adjusted", kind: "local", definitionBlockId: "choose", confidence: "exact"
  }, {
    id: "total", name: "total", kind: "local", definitionBlockId: "derive", confidence: "exact"
  }];
  return {
    language: "typescript",
    valueBindings,
    blocks: [{
      id: "entry",
      kind: "entry",
      valueAccesses: [definition("input", "parameter"), definition("ready", "parameter")]
    }, {
      id: "choose",
      kind: "operation",
      valueAccesses: [definition("adjusted", "local"), consume("input"), consume("ready")],
      valueChanges: [{
        target: "adjusted",
        targetKind: "variable",
        operation: "initialize",
        operator: "=",
        value: "ready ? input > 3 ? input * 2 : input + 2 : 0",
        confidence: "exact"
      }]
    }, {
      id: "derive",
      kind: "operation",
      valueAccesses: [definition("total", "local"), consume("adjusted")],
      valueChanges: [{
        target: "total",
        targetKind: "variable",
        operation: "initialize",
        operator: "=",
        value: "adjusted + 3",
        confidence: "exact"
      }]
    }, {
      id: "update",
      kind: "mutation",
      valueAccesses: [{
        bindingId: "total",
        name: "total",
        bindingKind: "local",
        access: "readwrite",
        usage: "sink",
        confidence: "exact"
      }],
      valueChanges: [{
        target: "total",
        targetKind: "variable",
        operation: "update",
        operator: "+=",
        value: "2",
        confidence: "exact"
      }]
    }],
    edges: [edge("entry-choose", "entry", "choose"), edge("choose-derive", "choose", "derive"),
      edge("derive-update", "derive", "update")]
  };
}

/** Creates a diamond whose merge differs until one branch edge is selected. */
function createBranchCalculationLogic(): Record<string, unknown> {
  return {
    language: "typescript",
    valueBindings: [{
      id: "input", name: "input", kind: "parameter", definitionBlockId: "entry", confidence: "exact"
    }, {
      id: "score", name: "score", kind: "local", definitionBlockId: "entry", confidence: "exact"
    }, {
      id: "result", name: "result", kind: "local", definitionBlockId: "join", confidence: "exact"
    }],
    blocks: [{
      id: "entry",
      kind: "entry",
      valueAccesses: [definition("input", "parameter"), definition("score", "local")],
      valueChanges: [{
        target: "score", targetKind: "variable", operation: "initialize", operator: "=",
        value: "input", confidence: "exact"
      }]
    }, {
      id: "when-true",
      kind: "operation",
      valueChanges: [{
        target: "score", targetKind: "variable", operation: "update", operator: "+=",
        value: "1", confidence: "exact"
      }]
    }, {
      id: "when-false",
      kind: "operation",
      valueChanges: [{
        target: "score", targetKind: "variable", operation: "update", operator: "-=",
        value: "1", confidence: "exact"
      }]
    }, {
      id: "join",
      kind: "operation",
      valueAccesses: [definition("result", "local")],
      valueChanges: [{
        target: "result", targetKind: "variable", operation: "initialize", operator: "=",
        value: "score * 2", confidence: "exact"
      }]
    }],
    edges: [{ ...edge("true-edge", "entry", "when-true"), kind: "true" }, {
      ...edge("false-edge", "entry", "when-false"), kind: "false"
    }, edge("true-join", "when-true", "join"), edge("false-join", "when-false", "join")]
  };
}

/** Creates sequential exact writes against a parameter-supplied JSON object. */
function createObjectFieldCalculationLogic(): Record<string, unknown> {
  return {
    language: "typescript",
    valueBindings: [{
      id: "payload", name: "payload", kind: "parameter", definitionBlockId: "entry",
      confidence: "exact"
    }, {
      id: "index", name: "index", kind: "parameter", definitionBlockId: "entry",
      confidence: "exact"
    }],
    blocks: [{
      id: "entry",
      kind: "entry",
      valueAccesses: [definition("payload", "parameter"), definition("index", "parameter")]
    }, {
      id: "score",
      kind: "mutation",
      valueChanges: [propertyChange("payload.profile.score", "update", "+=", "2")]
    }, {
      id: "status",
      kind: "mutation",
      valueChanges: [propertyChange('payload["status"]', "assign", "=", '"ready"')]
    }, {
      id: "item",
      kind: "mutation",
      valueChanges: [{
        ...propertyChange("payload.items[index]", "update", "++"),
        valueRef: {
          rootBindingId: "payload",
          path: [],
          displayPath: "payload.items[index]",
          segments: [{ kind: "static", key: "items" }, { kind: "binding", bindingId: "index" }]
        }
      }]
    }, {
      id: "delete",
      kind: "mutation",
      valueChanges: [propertyChange("payload.stale", "delete", "delete")]
    }],
    edges: [
      edge("entry-score", "entry", "score"),
      edge("score-status", "score", "status"),
      edge("status-item", "status", "item"),
      edge("item-delete", "item", "delete")
    ]
  };
}

/** Proves JSON-compatible source initializers feed later field calculations. */
function createJsonLiteralCalculationLogic(): Record<string, unknown> {
  return {
    language: "typescript",
    valueBindings: [{
      id: "payload", name: "payload", kind: "local", definitionBlockId: "initialize",
      confidence: "exact"
    }],
    blocks: [{
      id: "initialize",
      kind: "operation",
      valueAccesses: [definition("payload", "local")],
      valueChanges: [{
        target: "payload", targetKind: "variable", operation: "initialize", operator: "=",
        value: '{"nested":{"count":1}}', confidence: "exact"
      }]
    }, {
      id: "increment",
      kind: "mutation",
      valueChanges: [propertyChange("payload.nested.count", "update", "+=", "2")]
    }],
    edges: [edge("initialize-increment", "initialize", "increment")]
  };
}

/** Uses a dynamic key to verify blocked paths never reach Object prototypes. */
function createBlockedObjectFieldLogic(): Record<string, unknown> {
  return {
    language: "typescript",
    valueBindings: [{
      id: "payload", name: "payload", kind: "local", definitionBlockId: "entry",
      confidence: "exact"
    }, {
      id: "key", name: "key", kind: "parameter", definitionBlockId: "entry",
      confidence: "exact"
    }],
    blocks: [{
      id: "entry",
      kind: "entry",
      valueAccesses: [definition("payload", "local"), definition("key", "parameter")],
      valueChanges: [{
        target: "payload", targetKind: "variable", operation: "initialize", operator: "=",
        value: "{}", confidence: "exact"
      }]
    }, {
      id: "blocked",
      kind: "mutation",
      valueChanges: [propertyChange("payload[key]", "assign", "=", "true")]
    }],
    edges: [edge("entry-blocked", "entry", "blocked")]
  };
}

/** Creates one protocol-shaped exact property mutation for Scenario fixtures. */
function propertyChange(
  target: string,
  operation: "assign" | "update" | "delete",
  operator: string,
  value?: string
): Record<string, unknown> {
  return { target, targetKind: "property", operation, operator, value, confidence: "exact" };
}

function definition(bindingId: string, bindingKind: "parameter" | "local"): Record<string, unknown> {
  return {
    bindingId,
    name: bindingId,
    bindingKind,
    access: "define",
    confidence: "exact"
  };
}

function consume(bindingId: string): Record<string, unknown> {
  return {
    bindingId,
    name: bindingId,
    bindingKind: "local",
    access: "read",
    usage: "consume",
    confidence: "exact"
  };
}

function edge(id: string, sourceId: string, targetId: string): Record<string, unknown> {
  return { id, sourceId, targetId, kind: "next", confidence: "exact" };
}

function createEnabledNodes(
  logic: Record<string, unknown>,
  dimmed = new Set<string>()
): Map<string, FakeClassRecord> {
  const blocks = logic.blocks as Array<{ id: string }>;
  return new Map(blocks.map((block) => [
    block.id,
    createClassRecord(dimmed.has(block.id) ? new Set(["choice-dimmed"]) : new Set())
  ]));
}

function createClassRecord(classes: ReadonlySet<string>): FakeClassRecord {
  return { classList: { contains: (name) => classes.has(name) } };
}

function readKnown(
  calculation: ScenarioCalculation,
  blockId: string,
  bindingId: string
): unknown {
  const state = calculation.recordsByBlockId.get(blockId)?.after.get(bindingId);
  assert.equal(state?.kind, "known", `${blockId}/${bindingId}: ${state?.reason}`);
  return state.value;
}
