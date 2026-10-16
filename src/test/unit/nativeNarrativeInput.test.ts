/** Complete native input boundaries: source bytes/prior fields, all local codecs/macros and invalid/budget/ownership failures. No model or source execution. */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { packNativeInputShapes, unpackNativeInputShapes, packNativeInputTemplates, unpackNativeInputTemplates, packNativeInputDag, unpackNativeInputDag,
  packNativeSourceJson, unpackNativeSourceJson, encodeNativeSourceSchema, decodeNativeSourceSchema, createNativeRootInput, restoreNativeRootInput, createNativeRootPacket, createNativeRootCodec,
  encodeNativeSchemaNotation, decodeNativeSchemaNotation, packNativeInputMessages, unpackNativeInputMessages, numberNativeSourceLines, createNativeCallPacket } from "../../llm/nativeNarrativeCodec";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { nativeInputFixture, nativeCallInputFixture } from "../helpers/nativeNarrativeInput";
import { nativeCodecFixture } from "../helpers/nativeNarrativeCodec";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const invalid = (error: unknown): boolean => error instanceof FunctionNarrativeError && error.code === "invalid-response";
const codecs = [["shapes", packNativeInputShapes, unpackNativeInputShapes], ["templates", packNativeInputTemplates, unpackNativeInputTemplates], ["dag", packNativeInputDag, unpackNativeInputDag]] as const;

for (const [name, pack, unpack] of codecs) {
  test(name + " retains complete source, original key order and all six fields of every long prior", () => {
    const fixture = nativeInputFixture(), value = { "SOURCE DATA:": fixture.sourceData, "sourceReadingRoles:": fixture.roles }, before = JSON.stringify(value), packet = pack(value), restored = unpack(packet) as any;
    assert.equal(JSON.stringify(restored), before); assert.equal(JSON.stringify(value), before); assert.equal(restored["SOURCE DATA:"].earlierModelReadings.length, 20);
    for (const row of restored["SOURCE DATA:"].earlierModelReadings) { assert.deepEqual(Object.keys(row), ["callId", "role", "inputs", "output", "effects", "reason"]); assert.ok(row.reason.length > 100); }
  });
  test(name + " rejects getters, cycles, aliases, sparse arrays and nonfinite/-0 values before serialization", () => {
    let called = 0; const getter = {}; Object.defineProperty(getter, "value", { enumerable: true, get() { called++; return "source"; } });
    const cyclic: any = {}; cyclic.loop = cyclic; const shared = {}, sparse = new Array(2);
    for (const value of [getter, cyclic, [shared, shared], sparse, { n: NaN }, { n: Infinity }, { n: -0 }]) assert.throws(() => pack(value), invalid); assert.equal(called, 0);
  });
}

test("shape tags preserve actual arrays, empty objects, null, false and prototype-named literal fields", () => {
  const value = [{ a: 1 }, [], {}, [-1, 0]], packet = packNativeInputShapes(value);
  assert.deepEqual(packet, { format: "json-shapes-v1", shapes: [["a"], []], texts: [], data: [0, [1, 1], [0], [2], [0, -1, 0]] });
  const literal = JSON.parse('{"__proto__":{"exact":true},"constructor":"data","null":null,"false":false}'), restored = unpackNativeInputShapes(packNativeInputShapes(literal)) as any;
  assert.equal(Object.hasOwn(restored, "__proto__"), true); assert.equal(restored.__proto__.exact, true); assert.equal(restored.constructor, "data");
});

test("text references cannot borrow another request's table or use an out-of-range reference", () => {
  const packet = packNativeInputShapes(["one complete source string repeated for sharing".repeat(4), "one complete source string repeated for sharing".repeat(4)]);
  assert.ok(packet.texts.length > 0); const missing = copy(packet); missing.texts = []; assert.throws(() => unpackNativeInputShapes(missing), invalid);
  const foreign = copy(packet); foreign.data = [-1, 999]; assert.throws(() => unpackNativeInputShapes(foreign), invalid);
});

test("malformed shape IDs, tuple arity and duplicate keys fail without filling fields", () => {
  const valid = { format: "json-shapes-v1", shapes: [["value"]], texts: [], data: [1, 3] };
  for (const data of [[2, 3], [1], [1, 3, 4], [-1], [-3, 0], [1.5, 3]]) assert.throws(() => unpackNativeInputShapes({ ...copy(valid), data }), invalid);
  assert.throws(() => unpackNativeInputShapes({ ...copy(valid), shapes: [["value", "value"]], data: [1, 3, 4] }), invalid);
});

test("template arguments remain independent and literal definitions cannot reference another template", () => {
  const packet = { format: "json-template-shapes-v1", shapes: [["value"]], texts: [], templates: [{ base: [1, null], paths: [[1]] }], data: [0, [-2, 0, "first"], [-2, 0, "second"]] };
  assert.deepEqual(unpackNativeInputTemplates(packet), [{ value: "first" }, { value: "second" }]);
  for (const paths of [[[1], [1]], [[0]], [[2]], [[1], [1, 1]]]) assert.throws(() => unpackNativeInputTemplates({ ...copy(packet), templates: [{ base: [1, null], paths }] }), invalid);
  assert.throws(() => unpackNativeInputTemplates({ ...copy(packet), templates: [{ base: [1, [-2, 0]], paths: [[1, 1]] }] }), invalid);
  assert.throws(() => unpackNativeInputTemplates({ ...copy(packet), data: [-2, 1, "foreign"] }), invalid);
});

test("DAG references must be earlier and locally owned; repeated expansions produce independent full objects", () => {
  const packet = { format: "json-dag-shapes-v1", shapes: [["value"]], texts: [], nodes: [[1, "source"]], data: [0, [-2, 0], [-2, 0]] };
  const restored = unpackNativeInputDag(packet) as any; assert.deepEqual(restored, [{ value: "source" }, { value: "source" }]); assert.notEqual(restored[0], restored[1]);
  for (const nodes of [[[0, [-2, 0]]], [[0, [-2, 1]], [0, "future"]]]) assert.throws(() => unpackNativeInputDag({ ...copy(packet), nodes }), invalid);
  assert.throws(() => unpackNativeInputDag({ ...copy(packet), data: [-2, 99] }), invalid);
});

test("input expansion bombs and complete oversize/depth failures reject the whole value", () => {
  const nodes: any[][] = [[0, "literal"]]; for (let index = 1; index < 19; index++) nodes.push([0, [-2, index - 1], [-2, index - 1]]);
  assert.throws(() => unpackNativeInputDag({ format: "json-dag-shapes-v1", shapes: [], texts: [], nodes, data: [-2, 18] }), invalid);
  let deep: unknown = "source"; for (let index = 0; index < 130; index++) deep = [deep];
  for (const [, pack] of codecs) { assert.throws(() => pack(deep), invalid); assert.throws(() => pack("s".repeat(196609)), invalid); }
});

test("canonical source-only codec selection preserves the whole input, including an absent optional block", () => {
  const fixture = nativeInputFixture(), value = { "SOURCE DATA:": fixture.sourceData }, before = JSON.stringify(value), selected = packNativeSourceJson(value);
  assert.equal(JSON.stringify(unpackNativeSourceJson(selected.packet)), before); assert.equal(Object.hasOwn(unpackNativeSourceJson(selected.packet) as object, "sourceReadingRoles:"), false);
  assert.ok(selected.legend.length > 0); assert.throws(() => unpackNativeSourceJson({ ...selected.packet, format: "foreign-format" }), invalid);
});

test("source schema macros retain all original constraints, literal schema-looking data and annotations", () => {
  const fixture = nativeInputFixture(), before = JSON.stringify(fixture), encoded = encodeNativeSourceSchema(fixture.schema, fixture.sourceData), text = JSON.stringify(encoded.notation);
  assert.ok(text.includes('["V",')); assert.ok(text.includes('["P",')); assert.deepEqual(decodeNativeSourceSchema(encoded.notation, fixture.sourceData, encoded.sourceInputSha256), fixture.schema); assert.equal(JSON.stringify(fixture), before);
});

test("source-bound annotation references reject changed complete source and missing/foreign source operations", () => {
  const fixture = nativeInputFixture(), encoded = encodeNativeSourceSchema(fixture.schema, fixture.sourceData), changed = copy(fixture.sourceData); changed.fullSource += "\r";
  assert.throws(() => decodeNativeSourceSchema(encoded.notation, changed, encoded.sourceInputSha256), invalid);
  const foreign = copy(encoded.notation) as any; foreign.stepSequences[0].suffixes.pop(); assert.throws(() => decodeNativeSourceSchema(foreign, fixture.sourceData, encoded.sourceInputSha256), invalid);
  const wrongForm = copy(encoded.notation) as any; wrongForm.stepSequences[0].form = 999; assert.throws(() => decodeNativeSourceSchema(wrongForm, fixture.sourceData, encoded.sourceInputSha256), invalid);
});

for (const locale of ["ko", "en"] as const) for (const withRoles of [false, true]) {
  test(locale + " complete root input preserves original source and optional role presence=" + withRoles, () => {
    const fixture = nativeInputFixture(), input = createNativeRootInput({ schema: fixture.schema, sourceData: fixture.sourceData, locale, ...(withRoles ? { sourceReadingRoles: fixture.roles } : {}) }), restored = input.restore();
    assert.deepEqual(restored.schema, fixture.schema); assert.equal(JSON.stringify(restored.sourceData), JSON.stringify(fixture.sourceData)); assert.equal(Object.hasOwn(restored, "sourceReadingRoles"), withRoles);
    if (withRoles) assert.deepEqual(restored.sourceReadingRoles, fixture.roles); assert.equal(input.sourceInputSha256, createHash("sha256").update(JSON.stringify(fixture.sourceData)).digest("hex"));
    assert.deepEqual(restoreNativeRootInput(input.payload, input.sourceInputSha256), restored); assert.ok(Buffer.byteLength(JSON.stringify(input.payload) + "\n") <= 196608);
  });
}

test("whole root input snapshots reject changed messages/schema and never silently discard an extra field", () => {
  const fixture = nativeInputFixture(), input = createNativeRootInput({ schema: fixture.schema, sourceData: fixture.sourceData, locale: "en" });
  input.payload.messages[0].content += "other instruction"; assert.throws(() => input.restore(), invalid);
  assert.throws(() => restoreNativeRootInput({ ...copy(input.payload), extra: true }, input.sourceInputSha256), invalid);
  const other = createNativeRootInput({ schema: fixture.schema, sourceData: fixture.sourceData, locale: "en" }); (other.payload.schema as any).extra = "changed"; assert.throws(() => other.restore(), invalid);
});

test("complete root packet binds its original input before decoding actual raw model values and full prose", () => {
  const fixture = nativeCodecFixture(), source = { selectedRoutes: [{ operations: fixture.reading.scenarios[0].steps.map((step: any, index: number) => ({ ordinal: index + 1, kind: index === 0 ? "loop" : "return", code: step.code })) }] };
  const packet = createNativeRootPacket({ codec: fixture.input, sourceData: source, locale: "en" });
  // This is a schema/serialization fixture, not an actual neural output or a source-meaning proof.
  const value = { mode: "computed", reading: fixture.reading, justification: fixture.sentence };
  assert.deepEqual(packet.decode(createNativeRootCodec(fixture.input).encode(value, { shareProse: false })), value);
  const raw = JSON.stringify({ mode: "computed", reading: [[fixture.sentence], []], justification: fixture.sentence }); assert.throws(() => packet.decode(raw), invalid);
  assert.ok(value.reading.summary.length > 0); packet.payload.messages[1].content += " "; assert.throws(() => packet.decode("{}"), invalid);
});

test("all source JSON decoders reject malformed top-level capabilities and incomplete packet records", () => {
  for (const [, , unpack] of codecs) for (const input of [null, [], {}, "text", { format: "foreign" }]) assert.throws(() => unpack(input), invalid);
});

test("root input options reject hidden/getter/unknown members before reading caller values", () => {
  const fixture = nativeInputFixture(), source = { schema: fixture.schema, sourceData: fixture.sourceData, locale: "en" as const };
  assert.throws(() => createNativeRootInput({ ...source, extra: "not silently discarded" } as any), invalid);
  let called = 0; const getter = { ...source }; Object.defineProperty(getter, "locale", { enumerable: true, get() { called++; return "en"; } });
  assert.throws(() => createNativeRootInput(getter), invalid); assert.equal(called, 0);
  const hidden = { ...source }; Object.defineProperty(hidden, "extra", { enumerable: false, value: "hidden" }); assert.throws(() => createNativeRootInput(hidden), invalid);
});

for (const withRoles of [false, true]) {
  test("whole-block messages preserve every original direction and optional role presence=" + withRoles, () => {
    const fixture = nativeInputFixture(), notation = encodeNativeSchemaNotation(fixture.schema), prefix = "All original generated instructions remain complete.\n";
    const messages = [{ role: "system" as const, content: "Original language constraint." }, { role: "user" as const, content: prefix + "SCHEMA NOTATION:\n" + JSON.stringify(notation) + "\nSOURCE DATA:\n" + JSON.stringify(fixture.sourceData) + (withRoles ? "\nsourceReadingRoles:\n" + JSON.stringify(fixture.roles) : "") }], before = JSON.stringify(messages), packed = packNativeInputMessages(messages);
    assert.equal(JSON.stringify(unpackNativeInputMessages(packed)), before); assert.equal(JSON.stringify(messages), before); assert.ok(packed[1].content.startsWith(prefix)); assert.deepEqual(decodeNativeSchemaNotation(notation), fixture.schema);
  });
}

test("whole-block input rejects ambiguous boundaries, malformed trailing input and a foreign local table", () => {
  const messages = [{ role: "system" as const, content: "same" }, { role: "user" as const, content: 'SCHEMA NOTATION:\n{}\nSOURCE DATA:\n{"whole":"source"}' }], packed = packNativeInputMessages(messages);
  assert.throws(() => packNativeInputMessages([...messages, messages[1]]), invalid);
  const trailing = copy(packed); trailing[1].content += "not JSON"; assert.throws(() => unpackNativeInputMessages(trailing), invalid);
  const foreign = copy(packed); foreign[1].content = foreign[1].content.replace('"shapes":', '"unownedShapes":'); assert.throws(() => unpackNativeInputMessages(foreign), invalid);
});

test("schema notation rejects foreign/cyclic refs while preserving schema-looking opaque source data", () => {
  const fixture = nativeInputFixture(); assert.throws(() => encodeNativeSchemaNotation({ $ref: "#/foreign" }), invalid);
  assert.throws(() => encodeNativeSchemaNotation({ $defs: { d0: { $ref: "#/$defs/d0" } }, $ref: "#/$defs/d0" }), invalid);
  const notation = encodeNativeSchemaNotation(fixture.schema); assert.deepEqual(decodeNativeSchemaNotation(notation), fixture.schema);
});

test("a complete UTF8 request that cannot fit is rejected without reducing its source or fields", () => {
  const fixture = nativeInputFixture(); fixture.sourceData.fullSource = "가".repeat(64000); const before = JSON.stringify(fixture.sourceData);
  assert.throws(() => createNativeRootInput({ schema: fixture.schema, sourceData: fixture.sourceData, locale: "ko" }), (error: unknown) => error instanceof FunctionNarrativeError && error.code === "context-too-large");
  assert.equal(JSON.stringify(fixture.sourceData), before);
});

test("source labels preserve CR-only, LF, CRLF, UTF16 characters and the final empty line", () => {
  assert.equal(numberNativeSourceLines("first\rsecond\nthird\r\n😀\r", 4), "4: first\r5: second\n6: third\r\n7: 😀\r8: ");
  assert.equal(numberNativeSourceLines("whole source\r\n", 1), "1: whole source\r\n2: "); assert.equal(numberNativeSourceLines("", 9), "9: ");
});

test("invalid/overflowing line labels and source too large for one member fail before returning any prefix", () => {
  for (const start of [0, -1, 1.5, NaN, -0]) assert.throws(() => numberNativeSourceLines("source", start), invalid);
  assert.throws(() => numberNativeSourceLines("a\rb", Number.MAX_SAFE_INTEGER), invalid);
  assert.throws(() => numberNativeSourceLines("가".repeat(70000), 1), (error: unknown) => error instanceof FunctionNarrativeError && error.code === "context-too-large");
});

for (const includeSummary of [false, true]) {
  test("source-only call packet retains every full prior/callee and summary inclusion=" + includeSummary, () => {
    const context = nativeCallInputFixture(includeSummary), before = JSON.stringify(context), packet = createNativeCallPacket({ context, locale: "en" }), restored = packet.restore().sourceData as any;
    assert.equal(JSON.stringify(context), before); assert.equal(restored.callTask.earlierModelReadings.length, 20); assert.equal(restored.callTask.calleeEvidence.length, 22); assert.ok(restored.callTask.signature.length > 450);
    for (const [index, row] of restored.callTask.earlierModelReadings.entries()) { assert.deepEqual(Object.keys(row), ["callId", "role", "output", "effects", "reason", "inputs"]); assert.equal(row.inputs, context.callTask!.earlierModelReadings![index].inputs); assert.equal(row.reason, context.callTask!.earlierModelReadings![index].reason); }
    const rawCalls = [{ role: "The first call passes the original input.", output: "The helper returns its formal value.", effects: "The supplied body contains only a return.", reason: "This call follows the preceding source statement." }, { role: "The second call passes the local result.", output: "Its value is returned by the parent.", effects: "The supplied body contains only a return.", reason: "This return follows the local assignment." }];
    const raw = JSON.stringify({ ...(includeSummary ? { summary: "The parent composes the helper calls.", flow: "The parent calls the helper and returns its next call." } : {}), calls: rawCalls, limitations: [] }), decoded = packet.decode(raw) as any;
    assert.equal(decoded.calls.length, 2); assert.deepEqual(Object.keys(decoded.calls[0]), ["callId", "role", "inputs", "output", "effects", "reason"]); assert.equal(decoded.calls[0].role, rawCalls[0].role); assert.equal(decoded.calls[1].output, rawCalls[1].output);
  });
}

test("call packet final summary contains no invented fresh call and retains complete given priors", () => {
  const context = nativeCallInputFixture(true, true), packet = createNativeCallPacket({ context, locale: "en" }); assert.equal((packet.restore().sourceData as any).callTask.earlierModelReadings.length, 20);
  assert.deepEqual(packet.decode(JSON.stringify({ summary: "All supplied calls contribute to this parent.", flow: "The complete original sequence determines the call flow.", calls: [], limitations: [] })), { summary: "All supplied calls contribute to this parent.", flow: "The complete original sequence determines the call flow.", calls: [], limitations: [] });
});

test("call packet refuses missing prior fields, clipped snippets, CPU source ports and changed sent input", () => {
  const incomplete = nativeCallInputFixture(); delete (incomplete.callTask!.earlierModelReadings![0] as any).inputs; assert.throws(() => createNativeCallPacket({ context: incomplete, locale: "en" }), invalid);
  const clipped = nativeCallInputFixture(); clipped.snippets[0].truncated = true; assert.throws(() => createNativeCallPacket({ context: clipped, locale: "en" }), invalid);
  const cpu = nativeCallInputFixture(); (cpu as any).sourceCallReadings = []; assert.throws(() => createNativeCallPacket({ context: cpu, locale: "en" }), invalid);
  const packet = createNativeCallPacket({ context: nativeCallInputFixture(), locale: "en" }); packet.payload.messages[1].content += " changed"; assert.throws(() => packet.decode("{}"), invalid);
});

test("post-construction root/call payload getters are rejected without invoking them during identity checks", () => {
  const fixture = nativeInputFixture(), root = createNativeRootInput({ schema: fixture.schema, sourceData: fixture.sourceData, locale: "en" }), call = createNativeCallPacket({ context: nativeCallInputFixture(), locale: "en" }); let invoked = 0;
  for (const packet of [root, call]) { const original = packet.payload.messages[1].content; Object.defineProperty(packet.payload.messages[1], "content", { enumerable: true, get() { invoked++; return original; } }); assert.throws(() => packet.restore(), invalid); }
  assert.equal(invoked, 0);
});

test("source-only call construction rejects nested CPU answer data but leaves those words inside source strings untouched", () => {
  const bad = nativeCallInputFixture(); (bad.callTask as any).sourceExampleFacts = { resultValue: 42 }; assert.throws(() => createNativeCallPacket({ context: bad, locale: "en" }), invalid);
  const source = nativeCallInputFixture(); source.snippets[0].text += '\n// sourceExampleFacts and sourceWorksheet are just supplied source words.';
  const packet = createNativeCallPacket({ context: source, locale: "en" }); assert.ok((packet.restore().sourceData as any).snippets[0].text.includes("sourceWorksheet"));
});

test("in-process optional undefined fields retain their original JSON absence without altering any defined source value", () => {
  const original = nativeCallInputFixture(), producer = nativeCallInputFixture();
  for (const field of ["terminal", "calleeEvidence", "earlierModelReadings"]) if (!Object.hasOwn(producer.callTask!, field)) (producer.callTask as any)[field] = undefined;
  for (const target of producer.callTask!.targets) for (const field of ["callerSnippet", "calleeSnippet", "arguments", "parameters", "sourceKind", "returnSyntax", "resultUse", "effectSyntax"]) if (!Object.hasOwn(target, field)) (target as any)[field] = undefined;
  assert.equal(JSON.stringify(producer), JSON.stringify(original));
  assert.equal(JSON.stringify(createNativeCallPacket({ context: producer, locale: "en" }).payload), JSON.stringify(createNativeCallPacket({ context: original, locale: "en" }).payload));
});

test("source optional absence never permits unknown/required undefined fields or sparse/aliased target records", () => {
  for (const field of ["scope", "extra", "sourceWorksheet"]) { const source = nativeCallInputFixture(); (source.callTask as any)[field] = undefined; assert.throws(() => createNativeCallPacket({ context: source, locale: "en" }), invalid); }
  const sparse = nativeCallInputFixture(); delete sparse.callTask!.targets[0]; assert.throws(() => createNativeCallPacket({ context: sparse, locale: "en" }), invalid);
  const alias = nativeCallInputFixture(); alias.callTask!.targets[1] = alias.callTask!.targets[0]; assert.throws(() => createNativeCallPacket({ context: alias, locale: "en" }), invalid);
});

test("source optional absence checks descriptors before reading task fields or target array cells", () => {
  let invoked = 0;
  for (const position of ["task", "target", "cell"]) {
    const source = nativeCallInputFixture(), owner = position === "task" ? source.callTask! : position === "target" ? source.callTask!.targets[0] : source.callTask!.targets;
    Object.defineProperty(owner, position === "cell" ? "0" : "terminal", { enumerable: true, configurable: true, get() { invoked++; return undefined; } });
    assert.throws(() => createNativeCallPacket({ context: source, locale: "en" }), invalid);
  }
  assert.equal(invoked, 0);
});
