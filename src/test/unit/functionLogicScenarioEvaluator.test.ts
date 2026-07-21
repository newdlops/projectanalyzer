/**
 * Browser-source tests for the safe Function Logic Scenario evaluator. They
 * exercise scalar parsing, expression stacks, CFG merges, and selected edges
 * without relying on a full DOM runtime.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  getFunctionLogicScenarioEvaluatorBrowserSource
} from "../../webview/codeFlow/valuePreview";

type ScenarioState = {
  kind: "known" | "unknown" | "unset";
  value?: unknown;
  reason?: string;
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
    }>;
  }>;
  inputStateByBindingId: Map<string, ScenarioState>;
  truncated: boolean;
};

type ScenarioEvaluator = {
  calculate(
    logic: Record<string, unknown>,
    nodes: Map<string, FakeClassRecord>,
    edges: Map<string, { path: FakeClassRecord }>
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
  assert.match(result.reason ?? "", /calls are not executed/u);
  assert.deepEqual(result.origins, ["input"]);
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
  assert.match(inherited.reason ?? "", /unavailable/u);
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
  assert.match(state?.reason ?? "", /prototype-sensitive/u);
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
      valueChanges: [propertyChange("payload.items[index]", "update", "++")]
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
