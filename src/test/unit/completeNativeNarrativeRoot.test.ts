/** Complete native root replies retain actual wire values, prose, modes and source occurrences without executing subject code. */
import assert from "node:assert/strict";
import test from "node:test";
import { createCompleteFunctionNarrativeRoot } from "../../application/functionNarratives";
import { createNativeRootSource, createNativeRootCodec } from "../../llm/nativeNarrativeCodec";
import { isFunctionNarrative, isFunctionNarrativePage, type FunctionNarrativeContext } from "../../shared/functionNarratives";
import { createFunctionNarrativePageStore } from "../../storage/functionNarrativePages";
import { completeNativeSourceFixture } from "../helpers/completeNativeNarrativeRoot";
import { nativeRootSourceReading, nativeRootUnavailableReading } from "../helpers/nativeNarrativeRootSource";

/** Authoring inversion belongs only to this explicit fixture; production consumes raw model text through its independent decoder. */
function fixture(context = completeNativeSourceFixture(), reading = nativeRootSourceReading(context)) {
  const source = createNativeRootSource({ context, locale: "en" }), codec = createNativeRootCodec(source.codec);
  return { context, source, codec, reading, task: createCompleteFunctionNarrativeRoot(context, "en"),
    raw(mode = "computed", extra: object = {}, body = reading) { return codec.encode({ mode, reading: body, justification: "The complete source relation is retained in this fixture.", ...extra }); } };
}

test("complete computed replies preserve every original sentence and typed value while binding only Host source occurrences", () => {
  const f = fixture(), page = f.task.decode(f.raw()), scenario = page.scenarios[0];
  assert.equal(isFunctionNarrativePage(page), true); assert.equal(isFunctionNarrative(page), false);
  assert.equal(page.summary, f.reading.summary); assert.deepEqual(page.limitations, f.reading.limitations);
  assert.equal(scenario.explanation, f.reading.scenarios[0].explanation); assert.deepEqual(scenario.analysis, f.reading.scenarios[0].analysis);
  assert.deepEqual(scenario.graph, f.context.sourceFlow.paths[0].graph);
  assert.deepEqual(scenario.example, { inputs: [{ name: "input", json: "3" }], result: "5" });
  assert.equal(scenario.nodeDetails!.length, 2);
  for (const [index, detail] of scenario.nodeDetails!.entries()) {
    const original = f.reading.scenarios[0].steps[index], source = f.context.sourceFlow.paths[0].steps[index];
    for (const field of ["code", "text", "syntax", "reason", "effect"] as const) assert.equal(detail[field], original[field]);
    assert.deepEqual(detail.source, source.source); assert.equal(detail.nodeId, source.graphNodeId); assert.equal(detail.occurrence, source.graphOccurrence);
    assert.equal(detail.values![0].before, index ? "not returned" : "not declared"); assert.equal(detail.values![0].after, "5");
  }
});

test("typed strings that resemble JSON or phase markers stay JSON strings rather than display markers", () => {
  const context = completeNativeSourceFixture();
  context.parameters[0].type = "string"; context.returnTypeText = "string"; delete context.valueFacts;
  context.snippets[0].text = context.snippets[0].text.replace("input: number): number", "input: string): string").replace("input + 2", "input");
  context.sourceFlow.paths[0].steps[0].code = "const total = input;";
  const reading = nativeRootSourceReading(context), scenario = reading.scenarios[0];
  scenario.exampleInputs[0].value = "null"; scenario.exampleResult = "not evaluated";
  scenario.steps[0].values[0].after = '"null"'; scenario.steps[1].values[0].after = "not evaluated";
  const f = fixture(context, reading), actual = f.task.decode(f.raw()).scenarios[0];
  assert.deepEqual(actual.example, { inputs: [{ name: "input", json: '"null"' }], result: '"not evaluated"' });
  assert.equal(actual.nodeDetails![0].values![0].after, '"null"'); assert.equal(actual.nodeDetails![1].values![0].after, '"not evaluated"');
});

test("a concrete JSON object shaped like an unavailable discriminator remains a computed JSON value", () => {
  const context = completeNativeSourceFixture(); context.parameters[0].type = "unknown"; context.returnTypeText = "unknown";
  context.snippets[0].text = "export function total(input: unknown): unknown {\n  return input;\n}\n"; context.snippets[0].endLine = 13;
  const route = context.sourceFlow.paths[0], returned = route.steps[1]; returned.code = "return input;";
  returned.source = { snippetId: "parent", startLine: 11, endLine: 11 }; returned.graphOccurrence = 0;
  route.steps = [returned]; route.graph = { nodeIds: [returned.graphNodeId!], edgeIds: [] }; delete context.valueFacts;
  const reading = nativeRootSourceReading(context), literal = JSON.parse('{"kind":"not-evaluated","reason":"This is actual object data.","__proto__":{"literal":true},"constructor":"data"}');
  const properties: Record<string, number> = {}; for (let index = 0; index < 24; index++) properties["field" + index] = index;
  let nested: unknown = "original literal"; for (let depth = 0; depth < 16; depth++) nested = [nested];
  literal.properties = properties; literal.nested = nested; reading.scenarios[0].outcome = "return input;";
  reading.scenarios[0].exampleInputs[0].value = structuredClone(literal); reading.scenarios[0].exampleResult = structuredClone(literal);
  reading.scenarios[0].steps[0].values[0].after = structuredClone(literal);
  const f = fixture(context, reading), actual = f.task.decode(f.raw()).scenarios[0];
  assert.equal(actual.evaluation!.mode, "computed"); assert.equal(actual.example!.result, JSON.stringify(literal));
  assert.equal(actual.nodeDetails![0].values![0].after, JSON.stringify(literal));
});

test("loop-visit replies retain all model visit counters and complete meanings", () => {
  const f = fixture(completeNativeSourceFixture(true)), loopVisits = [
    { sourceOperationOrdinal: 1, visit: 3, earlierIterations: 2, meaning: "The fixture describes the third selected visit after two earlier iterations." },
    { sourceOperationOrdinal: 1, visit: 4, earlierIterations: 3, meaning: "This separate model statement remains unchanged and is not inferred by the Host." }
  ];
  const page = f.task.decode(f.raw("loop-visit", { loopVisits }));
  assert.deepEqual(page.scenarios[0].evaluation!.loopVisits, loopVisits); assert.equal(page.scenarios[0].nodeDetails!.length, 3);
});

test("complete native Unicode prose and unavailable reasons preserve the original code-point domains without truncating UTF16 strings", () => {
  const context = completeNativeSourceFixture(); delete context.scenarioBatch;
  const source = createNativeRootSource({ context, locale: "en" }), original = nativeRootSourceReading(context);
  const reason = "😀".repeat(100) + " This value is unavailable.", reading = nativeRootUnavailableReading(original, source.codec.readingSchema, reason);
  const scenario = reading.scenarios[0]; scenario.title = "😀".repeat(100) + " Original source route.";
  scenario.explanation = "😀".repeat(350) + " The complete paragraph retains all original characters.";
  scenario.steps[0].syntax = "😀".repeat(100) + " The source syntax is preserved.";
  scenario.steps[0].reason = "😀".repeat(120) + " The complete step reason is preserved.";
  const justification = "😀".repeat(150) + " The original model reason remains unchanged.", f = fixture(context, reading);
  const page = f.task.decode(f.raw("unverified", { justification }, reading));
  assert.equal(page.scenarios[0].title, scenario.title); assert.equal(page.scenarios[0].explanation, scenario.explanation);
  assert.equal(page.scenarios[0].nodeDetails![0].syntax, scenario.steps[0].syntax); assert.equal(page.scenarios[0].nodeDetails![0].reason, scenario.steps[0].reason);
  assert.deepEqual(page.scenarios[0].example!.result, { kind: "not-evaluated", reason }); assert.equal(page.scenarios[0].evaluation!.justification, justification);
});

for (const mode of ["source-infeasible", "unverified"] as const) test(mode + " retains every unavailable reason through actual disk storage without inventing a concrete example", async () => {
  const f = fixture(), unavailable = nativeRootUnavailableReading(f.reading, f.source.codec.readingSchema, "The model has not evaluated this exact cell."), scenario = unavailable.scenarios[0];
  scenario.exampleInputs[0].value.reason = "The original input is unavailable for this stated reason.";
  scenario.exampleResult.reason = "The original result is unavailable for a different stated reason.";
  scenario.steps[0].values[0].after.reason = "The model retains this complete state reason with <script>literal text</script>.";
  const page = f.task.decode(f.raw(mode, {}, unavailable)), store = createFunctionNarrativePageStore();
  try {
    assert.equal(page.scenarios[0].evaluation!.mode, mode);
    assert.deepEqual(page.scenarios[0].example!.inputs[0].json, scenario.exampleInputs[0].value);
    assert.deepEqual(page.scenarios[0].example!.result, scenario.exampleResult);
    assert.equal(page.scenarios[0].nodeDetails![0].values![0].before, "not declared");
    assert.deepEqual(page.scenarios[0].nodeDetails![0].values![0].after, scenario.steps[0].values[0].after);
    await store.write(0, page); assert.deepEqual(await store.read(0), page);
    const inconsistent = structuredClone(page); inconsistent.scenarios[0].example!.result = "0";
    assert.equal(isFunctionNarrativePage(inconsistent), false);
  } finally { await store.dispose(); }
});

test("complete page validation preserves original operations longer than the legacy display limit and source spans above twenty lines", () => {
  const context = completeNativeSourceFixture(), step = context.sourceFlow.paths[0].steps[0];
  const code = "const total = (input\n" + "  // Long source comment remains complete.\n".repeat(24) + "  + 2);";
  context.snippets[0].text = "export function total(input: number): number {\r\n  // Original source.\r\n" + code + "\nreturn total;\n}\n";
  context.snippets[0].endLine = 40; step.code = code; step.source.endLine = 37;
  context.sourceFlow.paths[0].steps[1].source.startLine = 38; context.sourceFlow.paths[0].steps[1].source.endLine = 38;
  context.valueFacts![0].source = { ...step.source };
  const f = fixture(context), page = f.task.decode(f.raw());
  assert.ok(code.length > 480); assert.equal(page.scenarios[0].nodeDetails![0].code, code);
  assert.deepEqual(page.scenarios[0].nodeDetails![0].source, step.source); assert.equal(isFunctionNarrativePage(page), true);
});

test("Host-only worksheet/prose capabilities are not read or invoked by complete root source projection", () => {
  const context: FunctionNarrativeContext = completeNativeSourceFixture(); let reads = 0;
  Object.defineProperty(context, "sourceWorksheet", { get() { reads++; throw new Error("Do not read worksheet"); } });
  const task = createCompleteFunctionNarrativeRoot(context, "en"); assert.ok(task.request.messages.length); assert.equal(reads, 0);
});

test("cached decoder results remain owned and request mutation or malformed/truncated raw replies fail closed", () => {
  const f = fixture(), raw = f.raw(), page = f.task.decode(raw); page.scenarios[0].nodeDetails![0].text = "Caller mutation.";
  assert.equal(f.task.decode(raw).scenarios[0].nodeDetails![0].text, f.reading.scenarios[0].steps[0].text);
  for (const bad of [raw.slice(0, -1), "{}", raw + " trailing"]) assert.throws(() => f.task.decode(bad));
  f.task.request.messages[0].content += " changed"; assert.throws(() => f.task.decode(raw));
});

test("portable native pages reject unavailable cells without a declared unavailable mode and reject malformed loop metadata", () => {
  const f = fixture(), page = f.task.decode(f.raw());
  page.scenarios[0].nodeDetails![0].values![0].after = { kind: "not-evaluated", reason: "This does not belong in computed mode." };
  assert.equal(isFunctionNarrativePage(page), false);
  const loop = f.task.decode(f.raw()); loop.scenarios[0].evaluation = { mode: "loop-visit", justification: "A stated model reason.", loopVisits: [] };
  assert.equal(isFunctionNarrativePage(loop), false);
});
