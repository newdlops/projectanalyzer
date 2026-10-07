/** Local compact transport tests exercise source authority, tuple slots, partial evidence and typed example values. */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalNarrativeWire } from "../../llm/functionNarratives/localWire";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";
import { buildLocalNarrativeInput } from "../../llm/functionNarratives/localInput";
import { createFunctionCallNarrativeSchema } from "../../shared/functionCallNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

const context: FunctionNarrativeContext = { functionName: "inspect", language: "kotlin", detailLevel: "rich", limited: false,
  parameters: [{ name: "enabled", type: "Boolean" }, { name: "amount", type: "Int" }], valueNames: ["enabled", "amount", "adjusted", "condition", "result"],
  snippets: [{ id: "root", role: "function", startLine: 1, endLine: 5, text: "fun inspect(enabled: Boolean, amount: Int): Int {\n if (!enabled) return 0\n val adjusted = amount + 5\n return adjusted\n}", truncated: false }],
  sourceFlow: { basis: "source-control-flow", limited: false, paths: [{ status: "source-terminal", confidence: "exact", steps: [
    { kind: "condition", code: "!enabled", graphNodeId: "guard", graphOccurrence: 1, source: { snippetId: "root", startLine: 2, endLine: 2 }, confidence: "exact", branch: { outcome: "false", confidence: "exact", inputCondition: "enabled = true" } },
    { kind: "mutation", code: "val adjusted = amount + 5", graphNodeId: "write", graphOccurrence: 2, source: { snippetId: "root", startLine: 3, endLine: 3 }, confidence: "exact" },
    { kind: "return", code: "return adjusted", graphNodeId: "return", graphOccurrence: 3, source: { snippetId: "root", startLine: 4, endLine: 4 }, confidence: "exact" }
  ] }] } };

test("local wire restores owned source slots and fixed inputs without mutating the schema or allowing their replacement", () => {
  const schema = createLocalNarrativeSchema(context) as any, before = JSON.stringify(schema);
  const wire = createLocalNarrativeWire(schema), compact = wire.schema as any;
  const slot = compact.properties.scenarios.items[0];
  assert.deepEqual(slot.properties.when.const, ["enabled = true"]);
  assert.equal(slot.properties.steps.items[0].properties.code.const, "!enabled");
  assert.match(slot.properties.steps.items[1].description, /val adjusted = amount \+ 5/);
  assert.deepEqual(slot.properties.exampleInputs.items[0].properties, { name: { const: "enabled" }, value: { const: true } });
  const prose = { syntax: "Negation changes a Boolean.", text: "Continue along this source branch.", reason: "True negates to false.", effect: "Reach the write next.", values: [{ name: "condition", before: "true", after: "false" }] };
  const payload = { summary: "Purpose", limitations: [], scenarios: [{ title: "Path", when: ["enabled = true"], outcome: "return adjusted", explanation: "The selected path calculates its result.",
    analysis: { pathReason: "Guard is false.", stateChange: "Write then return.", alternative: "Disabled exits." }, assumptions: [],
    exampleInputs: [{ name: "enabled", value: true }, { name: "amount", value: 100 }], exampleResult: "105",
    steps: [{ code: "!enabled" }, { ...prose, code: "val adjusted = amount + 5", text: "Literal <script> remains text." }] }] };
  const decoded = JSON.parse(wire.decode(JSON.stringify(payload)));
  assert.equal(decoded.scenarios[0].exampleInputs[0].name, "enabled");
  assert.equal(decoded.scenarios[0].exampleInputs[0].value, true);
  assert.equal(decoded.scenarios[0].steps[1].code, "val adjusted = amount + 5");
  assert.deepEqual(decoded.scenarios[0].steps[1].source, context.sourceFlow!.paths[0].steps[1].source);
  assert.equal(decoded.scenarios[0].steps[1].text, "Literal <script> remains text.");
  assert.match(decoded.scenarios[0].steps[0].effect, /val adjusted = amount \+ 5/);
  assert.equal(decoded.scenarios[0].steps[0].values[0].after, "false");
  assert.equal(JSON.stringify(schema), before);
  for (const extra of [{ code: "return 0" }, { source: { snippetId: "foreign", startLine: 99, endLine: 99 } }, { nodeId: "forged" }, { effect: "The if body executes." }]) {
    const tampered = structuredClone(payload); Object.assign(tampered.scenarios[0].steps[0], extra);
    assert.throws(() => wire.decode(JSON.stringify(tampered)), { message: "invalid-response" });
  }
  const missing = structuredClone(payload); missing.scenarios[0].steps.pop();
  assert.throws(() => wire.decode(JSON.stringify(missing)), { message: "invalid-response" });
  const changedInput = structuredClone(payload); Object.assign(changedInput.scenarios[0].exampleInputs[0], { value: false });
  assert.throws(() => wire.decode(JSON.stringify(changedInput)), { message: "invalid-response" });
  const changedRoute = structuredClone(payload); changedRoute.scenarios[0].when = ["enabled = false"];
  assert.throws(() => wire.decode(JSON.stringify(changedRoute)), { message: "invalid-response" });
});

test("optional constants and union alternatives are not silently manufactured", () => {
  const schema = { type: "object", additionalProperties: false, required: ["identity", "choice"], properties: {
    identity: { const: "owned" }, optional: { const: "not-present" }, choice: { anyOf: [{ const: "a" }, { const: "b" }] }
  } };
  const wire = createLocalNarrativeWire(schema);
  assert.deepEqual(JSON.parse(wire.decode('{"choice":"b"}')), { choice: "b", identity: "owned" });
  assert.deepEqual((wire.schema as any).properties.choice, schema.properties.choice);
});

test("call slots retain their owned ID and fixed empty-input facts while prose remains model authored", () => {
  const schema = createFunctionCallNarrativeSchema({ scope: "call", signature: "public-fixture", includeSummary: false,
    sequence: [], conditions: [], routeStatus: "structure", sourceLimited: false, targets: [{ callId: "call-0", caller: "inspect", callee: "zero",
      language: "typescript", expression: "zero()", relation: "call", confidence: "exact", guards: [], loops: [], deferred: false, sourceLimited: false, arguments: [] }] }, "en") as any;
  const wire = createLocalNarrativeWire(schema);
  const payload = { calls: [{ role: "Returns zero.", output: "Zero is returned.", effects: "No write is shown.", reason: "The call is reached." }], limitations: [] };
  const decoded = JSON.parse(wire.decode(JSON.stringify(payload)));
  assert.equal(decoded.calls[0].callId, "call-0");
  assert.equal(decoded.calls[0].inputs, schema.properties.calls.items[0].properties.inputs.const);
  assert.equal(decoded.calls[0].role, payload.calls[0].role);
  Object.assign(payload.calls[0], { callId: "foreign", inputs: "Invented argument" });
  assert.throws(() => wire.decode(JSON.stringify(payload)), { message: "invalid-response" });
});

test("type grammar constrains explicit primitives and retains nullable/unknown input contracts", () => {
  const schema = createLocalNarrativeSchema(context) as any;
  assert.deepEqual(schema.properties.scenarios.items[0].properties.exampleInputs.items[1].properties.value, { type: "integer" });
  const nullable = { ...context, parameters: [{ name: "other", type: "Int?" }], sourceFlow: undefined };
  const nullableValue = (createLocalNarrativeSchema(nullable) as any).properties.scenarios.items.properties.exampleInputs.items[0].properties.value;
  assert.deepEqual(nullableValue, { anyOf: [{ type: "integer" }, { type: "null" }] });
  const alias = { ...nullable, parameters: [{ name: "other", type: "UserAlias" }] };
  assert.deepEqual((createLocalNarrativeSchema(alias) as any).properties.scenarios.items.properties.exampleInputs.items[0].properties.value, {});
});

test("node worksheet treats false predicates and reaching a later write as separate facts, with no private identities", () => {
  const path = context.sourceFlow!.paths[0];
  const task = { ...context, nodeTask: { frame: { when: ["enabled = true"], outcome: "return adjusted" },
    example: { inputs: [{ name: "enabled", json: "true" }, { name: "amount", json: "100" }], result: "105" }, targets: [path.steps[1]],
    reading: { explanation: "Follow the false branch.", priorState: [] } } };
  const projected = buildLocalNarrativeInput(task) as any;
  assert.equal(projected.sourceFlow, undefined);
  assert.equal(projected.selectedRoute.precedingDecisions[0].predicateResult, false);
  assert.equal(projected.nodeTask.example.result, undefined);
  assert.equal(projected.nodeTask.reading.explanation, undefined);
  assert.equal(projected.nodeTask.targets, undefined);
  assert.equal(projected.selectedRoute.targets[0].reachedOnSelectedSourceRoute, true);
  assert.equal(projected.selectedRoute.targets[0].nextReachedOperation, "return adjusted");
  assert.doesNotMatch(JSON.stringify(projected), /graphNodeId|graphOccurrence/);
  assert.deepEqual(context.sourceFlow!.paths[0].steps, path.steps);
});
