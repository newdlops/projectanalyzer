/** Complete source-only root constructor boundaries and strict serialization. CPU fixtures never establish actual neural meaning or three-second latency. */
import assert from "node:assert/strict";
import test from "node:test";
import { createNativeRootSource, createNativeSourceRootPacket, createNativeRootCodec } from "../../llm/nativeNarrativeCodec";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { nativeRootSourceFixture, nativeRootRetypedSourceFixture, nativeRootSourceReading, nativeRootUnavailableReading } from "../helpers/nativeNarrativeRootSource";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const invalid = (error: unknown) => error instanceof FunctionNarrativeError && error.code === "invalid-response";
const controlled = (error: unknown) => error instanceof FunctionNarrativeError;
const build = (context = nativeRootSourceFixture()) => createNativeRootSource({ context, locale: "en" });

test("root source retains full original parent/helper/caller bytes, syntax IR and independent Host occurrences", () => {
  const context = nativeRootSourceFixture(), before = JSON.stringify(context), result = build(context), data = result.sourceData as any;
  assert.equal(JSON.stringify(context), before); assert.equal(data.snippets.length, 3); assert.ok(data.snippets[0].text.includes("10: export function total")); assert.ok(data.snippets[0].text.includes("\r\n11:   // 원문 😀")); assert.ok(data.snippets[1].text.includes("\r2: return value;"));
  assert.deepEqual(data.valueFacts, context.valueFacts); assert.equal(data.selectedRoutes[0].operations.length, 2); assert.ok(!Object.hasOwn(data, "sourceFlow"));
  assert.deepEqual(result.bindings.route, context.sourceFlow.paths[0].graph); assert.equal(result.bindings.occurrences.length, 2); assert.notEqual(result.bindings.occurrences[0].source, context.sourceFlow.paths[0].steps[0].source);
  context.snippets[0].text += "changed"; assert.ok(!data.snippets[0].text.endsWith("changed"));
});

test("root producer optional absence and shared source records materialize without dropping defined fields or changing ordinary order", () => {
  const a = nativeRootSourceFixture(), b = nativeRootSourceFixture(); (b as any).groundingLimited = undefined; (b.parameters[0] as any).type = "number"; (b.sourceFlow.paths[0] as any).reason = undefined;
  (b.sourceFlow.paths[0].steps[0] as any).branch = undefined; (b as any).nodePreparation = true;
  const shared = { complete: "source metadata" }; (b as any).sourceEvidence = { first: shared, second: shared };
  const result = build(b); assert.equal((result.sourceData as any).sourceEvidence.first.complete, shared.complete); assert.notEqual((result.sourceData as any).sourceEvidence.first, (result.sourceData as any).sourceEvidence.second);
  assert.deepEqual(result.codec, build(a).codec); assert.ok(!Object.hasOwn(result.sourceData, "nodePreparation")); assert.ok(!Object.hasOwn(result.sourceData, "groundingLimited"));
});

test("root producer capabilities, sparse arrays, symbols, hidden data, nonfinite values and negative zero fail without invoking getters", () => {
  let invoked = 0;
  for (const mutate of [(x: any) => Object.defineProperty(x, "returnTypeText", { enumerable: true, get() { invoked++; return "number"; } }), (x: any) => { x.parameters.length = 2; }, (x: any) => { x[Symbol("hidden")] = 1; }, (x: any) => Object.defineProperty(x, "hidden", { value: 1 }), (x: any) => { x.sourceEvidence = { n: Infinity }; }, (x: any) => { x.sourceEvidence = { n: -0 }; }, (x: any) => { x.parameters[0].extra = undefined; }]) {
    const context = nativeRootSourceFixture(); mutate(context); assert.throws(() => build(context), invalid);
  }
  assert.equal(invoked, 0);
});

test("root producer cycles, expanded alias bombs, excessive depth and huge sparse lengths reject the whole context", () => {
  const cycle = nativeRootSourceFixture(); (cycle as any).sourceEvidence = {}; (cycle as any).sourceEvidence.self = (cycle as any).sourceEvidence; assert.throws(() => build(cycle), invalid);
  const aliases = nativeRootSourceFixture(); let node: any = { text: "complete metadata" }; for (let index = 0; index < 24; index++) node = [node, node]; (aliases as any).sourceEvidence = node; assert.throws(() => build(aliases), controlled);
  const deep = nativeRootSourceFixture(); let row: any = {}; (deep as any).sourceEvidence = row; for (let index = 0; index < 140; index++) row = row.next = {}; assert.throws(() => build(deep), controlled);
  const sparse = nativeRootSourceFixture(); sparse.parameters.length = 100000000; assert.throws(() => build(sparse), controlled);
});

test("root construction requires every supplied snippet and one complete bound occurrence list; invalid metadata cannot become partial success", () => {
  for (const mutate of [(x: any) => { x.snippets[0].truncated = true; }, (x: any) => { x.snippets[0].role = "helper"; }, (x: any) => { x.sourceFlow.paths[0].steps[0].source.endLine = 99; }, (x: any) => { x.sourceFlow.paths[0].steps[0].graphNodeId = "foreign"; }, (x: any) => { x.sourceFlow.paths[0].steps[1] = x.sourceFlow.paths[0].steps[0]; }, (x: any) => { delete x.sourceFlow.paths[0].graph; }, (x: any) => { x.sourceFlow.paths.push(x.sourceFlow.paths[0]); }]) {
    const context = nativeRootSourceFixture(); mutate(context); assert.throws(() => build(context), invalid);
  }
});

test("root CPU answer/prose/evaluation ports are rejected at any depth while identical words inside source remain opaque", () => {
  let calls = 0;
  for (const port of ["sourceWorksheet", "sourceExampleFacts", "sourceVerifiedAnalysis", "sourceCallReadings", "sourceProseReader", "checkedExamples", "nodeTask", "summaryTask"]) {
    const context = nativeRootSourceFixture(); (context as any).sourceEvidence = { [port]: {} }; assert.throws(() => build(context), invalid);
  }
  const callback = nativeRootSourceFixture(); (callback as any).sourceWorksheet = { trace() { calls++; } }; assert.throws(() => build(callback), invalid); assert.equal(calls, 0);
  const literal = nativeRootSourceFixture(); literal.snippets[0].text += "// sourceExampleFacts is just source text."; assert.ok(JSON.stringify(build(literal).sourceData).includes("sourceExampleFacts"));
});

test("root option descriptors and exact syntax DTO fields are validated before locale/context members are read", () => {
  const input = { context: nativeRootSourceFixture(), locale: "en" as const }; let calls = 0; Object.defineProperty(input, "locale", { enumerable: true, get() { calls++; return "en"; } }); assert.throws(() => createNativeRootSource(input), invalid); assert.equal(calls, 0);
  const context = nativeRootSourceFixture(); (context.valueFacts![0] as any).resultValue = 5; assert.throws(() => build(context), invalid);
  const branch = nativeRootSourceFixture(); (branch.sourceFlow.paths[0].steps[0] as any).branch = null; assert.throws(() => build(branch), invalid);
});

test("unrecognized source annotations retain the original bounded unknown result domain instead of an invented calculated type", () => {
  const context = nativeRootSourceFixture(); context.parameters[0].type = "DomainAlias"; context.returnTypeText = "DomainAlias"; const result = build(context), scenario = (result.codec.readingSchema as any).properties.scenarios.items[0].properties;
  assert.deepEqual(scenario.exampleInputs.items[0].properties.value, {}); assert.deepEqual(scenario.exampleResult.anyOf.map((x: any) => x.type), ["number", "boolean", "null", "string", "array", "object"]); assert.equal(scenario.exampleResult.anyOf[4].maxItems, 24);
});

test("declared array/scalar domains retain all original nullable layers, source spelling and language-specific primitive rules", () => {
  const cases: Array<[string, string, any]> = [["typescript", "readonly number[][]", { type: "array", items: { type: "array", items: { type: "number" } } }], ["kotlin", "Array<IntArray?>?", { anyOf: [{ type: "array", items: { anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }] } }, { type: "null" }] }], ["python", "bool", { type: "boolean" }], ["kotlin", "Double?", { anyOf: [{ type: "number" }, { type: "null" }] }]];
  for (const [language, type, expected] of cases) { const context = nativeRootSourceFixture(); context.language = language; context.parameters[0].type = type; assert.deepEqual((build(context).codec.readingSchema as any).properties.scenarios.items[0].properties.exampleInputs.items[0].properties.value, expected); }
});

test("compound calculations remain free model fields; only explicit source literals acquire exact raw-value guards", () => {
  const ordinary = build(), properties = (ordinary.codec.readingSchema as any).properties.scenarios.items[0].properties;
  assert.deepEqual(ordinary.codec.calculatedValueDomains, {}); assert.equal(Object.hasOwn(properties.steps.items[0].properties.values.items[0].properties.after, "const"), false);
  const context = nativeRootSourceFixture(); context.sourceFlow.paths[0].steps[1].code = "return 7;";
  const source = build(context), key = "$.scenarios[0].steps[1].values[0].after"; assert.deepEqual(source.codec.calculatedValueDomains[key], { type: "string", minLength: 1, maxLength: 120 });
  assert.deepEqual((source.codec.readingSchema as any).properties.scenarios.items[0].properties.steps.items[1].properties.values.const[0].after, "7");
});

test("later numeric source IR cannot force an earlier Boolean declaration into a numerical model field", () => {
  const context = nativeRootRetypedSourceFixture(), source = build(context), packet = createNativeSourceRootPacket({ context, locale: "en" }), reading = nativeRootSourceReading(context);
  reading.scenarios[0].steps[0].values[0].after = "false"; reading.scenarios[0].steps[1].values[0].before = "false";
  const full = { mode: "computed", reading, justification: reading.summary }, codec = createNativeRootCodec(source.codec), raw = codec.encode(full, { shareProse: false });
  assert.deepEqual(packet.decode(raw), full); assert.deepEqual(source.codec.calculatedValueDomains, {});
});

test("an explicit source null literal owns only its after calculation; before source phases never acquire known-null authority", () => {
  const context = nativeRootSourceFixture(); context.sourceFlow.paths[0].steps[0].code = "null"; context.snippets[0].text = context.snippets[0].text.replace("input + 2", "null"); delete context.valueFacts; const source = build(context);
  assert.deepEqual(source.codec.knownNullPaths, ["$.scenarios[0].steps[0].values[0].after"]); assert.ok(!source.codec.knownNullPaths!.some(path => path.endsWith("before")));
  const codec = createNativeRootCodec(source.codec); assert.equal(codec.calculatedValueAudit.length, 1); assert.equal(codec.calculatedValueAudit[0].originalValue, null);
  const reading = nativeRootSourceReading(context); for (const step of reading.scenarios[0].steps) step.values[0].after = null; reading.scenarios[0].exampleResult = null;
  const full = { mode: "computed", reading, justification: reading.summary }, raw = codec.encode(full, { shareProse: false }); assert.deepEqual(codec.decode(raw), full);
  const changed = JSON.parse(raw), stack = [changed]; let nulls = 0;
  while (stack.length) { const row = stack.pop(); if (!row || typeof row !== "object") continue; for (const [key, value] of Object.entries(row)) if (value === null) { (row as any)[key] = 0; nulls++; } else if (value && typeof value === "object") stack.push(value); }
  assert.ok(nulls > 0); assert.throws(() => codec.decode(JSON.stringify(changed)), invalid);
});

test("source packet rejects changed payload or Host bindings, including getters inserted after construction, without evaluating them", () => {
  const packet = createNativeSourceRootPacket({ context: nativeRootSourceFixture(), locale: "en" }); packet.payload.messages[1].content += " changed"; assert.throws(() => packet.decode("{}"), invalid);
  const second = createNativeSourceRootPacket({ context: nativeRootSourceFixture(), locale: "en" }); let calls = 0; Object.defineProperty(second.bindings.occurrences[0], "code", { enumerable: true, get() { calls++; return "same"; } }); assert.throws(() => second.restore(), invalid); assert.throws(() => second.decode("{}"), invalid); assert.equal(calls, 0);
});

test("a full UTF8 source request exceeding the whole limit rejects rather than shortening a source member or output contract", () => {
  const context = nativeRootSourceFixture(); context.snippets[0].text += "가".repeat(64000); const before = JSON.stringify(context);
  assert.throws(() => createNativeSourceRootPacket({ context, locale: "ko" }), controlled); assert.equal(JSON.stringify(context), before);
});

test("an optional source-role enrichment cap never truncates the original route or schema operation count", () => {
  const context = nativeRootSourceFixture(), original = context.sourceFlow.paths[0].steps[0]; context.sourceFlow.paths[0].steps = Array.from({ length: 33 }, (_, index) => ({ ...clone(original), graphNodeId: "node-" + index, graphOccurrence: index })); context.sourceFlow.paths[0].graph = { nodeIds: context.sourceFlow.paths[0].steps.map(step => step.graphNodeId!), edgeIds: [] };
  const result = build(context); assert.equal(result.sourceReadingRoles, undefined); assert.equal((result.sourceData as any).selectedRoutes[0].operations.length, 33); assert.equal((result.codec.readingSchema as any).properties.scenarios.items[0].properties.steps.items.length, 33);
});

test("contradictory direct entry choices remain model applicability work and never cause the constructor to choose a convenient input", () => {
  const context = nativeRootSourceFixture(); context.parameters[0].type = "boolean"; for (const [index, step] of context.sourceFlow.paths[0].steps.entries()) step.branch = { outcome: index ? "false" : "true", confidence: "exact", inputCondition: "input = " + (index ? "false" : "true") };
  const result = build(context); assert.ok(!Object.hasOwn((result.sourceData as any).exampleSlots[0][0], "fixedValue")); assert.deepEqual((result.codec.readingSchema as any).properties.scenarios.items[0].properties.exampleInputs.items[0].properties.value, { type: "boolean" });
});

test("partial source routes retain explicit null result markers and original declared before-phase semantics", () => {
  const context = nativeRootSourceFixture(); context.sourceFlow.paths[0].status = "partial"; context.sourceFlow.paths[0].reason = "depth-limit";
  const result = build(context), scenario = (result.codec.readingSchema as any).properties.scenarios.items[0].properties;
  assert.deepEqual(scenario.exampleResult, { const: null }); assert.deepEqual(result.codec.knownNullPaths, []); assert.equal(scenario.steps.items[0].properties.values.items[0].properties.before.const, "not declared");
});

for (const locale of ["ko", "en"] as const) for (const mode of ["computed", "loop-visit", "source-infeasible", "unverified"] as const) {
  test(`${locale} ${mode} root packet preserves every original full value/prose field through strict native decoding`, () => {
    const context = nativeRootSourceFixture(true), source = createNativeRootSource({ context, locale }), packet = createNativeSourceRootPacket({ context, locale }), ordinary = nativeRootSourceReading(context, locale), sentence = ordinary.summary;
    // These are explicit transport fixtures. Selecting a mode here proves neither its source meaning nor actual model correctness.
    const reading = ["source-infeasible", "unverified"].includes(mode) ? nativeRootUnavailableReading(ordinary, source.codec.readingSchema, sentence) : ordinary;
    const full = { mode, reading, justification: sentence, ...(mode === "loop-visit" ? { loopVisits: [{ sourceOperationOrdinal: 1, visit: 3, earlierIterations: 2, meaning: sentence }] } : {}) }, before = JSON.stringify(full), codec = createNativeRootCodec(source.codec);
    for (const shareProse of [false, true]) assert.deepEqual(packet.decode(codec.encode(full, { shareProse })), full);
    assert.equal(JSON.stringify(full), before); assert.deepEqual(packet.restore().sourceData, source.sourceData); assert.equal((packet.readingSchema as any).properties.scenarios.items[0].properties.steps.items.length, 3);
  });
}
