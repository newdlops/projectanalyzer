/** Native source/shape codecs keep every independent typed value, literal datum and original field constraint. */
import assert from "node:assert/strict";
import test from "node:test";
import { createNativeNamedWire, createNativeObjectTupleWire, factorNativeSchema, expandNativeSchema, releaseNativeModelValues, requireNativeModelValues, createNativeCallCodec } from "../../llm/nativeNarrativeCodec";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { nativeCodecFixture } from "../helpers/nativeNarrativeCodec";

const invalid = (error: unknown) => error instanceof FunctionNarrativeError && error.code === "invalid-response";
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const shape = () => ({ type: "object", additionalProperties: false, required: ["source", "text", "value"], properties: {
  source: { const: { $ref: "literal source data", properties: { const: 7 }, full: "😀\r\nwhole" } }, text: { type: "string", minLength: 1, maxLength: 20 }, value: { type: "integer", minimum: -10, maximum: 10 }
} });
const sample = () => ({ source: { $ref: "literal source data", properties: { const: 7 }, full: "😀\r\nwhole" }, text: "Authored 😀", value: 7 });

test("named native fields omit only source constants and restore every original field without mutating source or model data", () => {
  const schema = shape(), reading = sample(), before = JSON.stringify([schema, reading]), codec = createNativeNamedWire(schema), raw = codec.encode(reading);
  assert.deepEqual(JSON.parse(raw), { text: "Authored 😀", value: 7 }); assert.deepEqual(codec.decode(raw), reading); assert.equal(JSON.stringify([schema, reading]), before);
  schema.properties.source.const.full = "changed outside"; assert.deepEqual(codec.decode(raw), sample());
});

test("named native decoding validates opaque leaf types and bounds before any source metadata is restored", () => {
  const codec = createNativeNamedWire(shape());
  for (const value of [{ text: "ok", value: "7" }, { text: "", value: 7 }, { text: "ok", value: 11 }, { text: "ok" }, { text: "ok", value: 7, source: {} }])
    assert.throws(() => codec.decode(JSON.stringify(value)), invalid);
});

test("opaque optional/union/ref schemas retain all original choices and cannot gain source-field restoration", () => {
  const schema = { type: "object", additionalProperties: false, required: ["value"], properties: { value: { anyOf: [{ type: "string", pattern: "^text$" }, { type: "integer", minimum: 2 }] }, optional: { type: "boolean" } } };
  const codec = createNativeNamedWire(schema); assert.deepEqual(codec.schema, schema);
  for (const reading of [{ value: "text" }, { value: 3, optional: false }]) assert.deepEqual(codec.decode(codec.encode(reading)), reading);
  assert.throws(() => codec.decode('{"value":"wrong"}'), invalid);
});

test("schema IDs remain valid opaque constraints in both original and wire validation", () => {
  const schema = { $id: "urn:project-analyzer:native-codec-fixture", type: "object", properties: { value: { type: "integer" } }, required: ["value"], additionalProperties: false };
  const codec = createNativeNamedWire(schema); assert.deepEqual(codec.decode(codec.encode({ value: 5 })), { value: 5 }); assert.throws(() => codec.decode('{"value":"5"}'), invalid);
});

test("closed object tuples preserve exact field order, source constants, unions and every original array slot", () => {
  const codec = createNativeObjectTupleWire(shape()), reading = sample(), tuple = codec.encode(reading);
  assert.deepEqual(tuple, [reading.source, reading.text, reading.value]); assert.deepEqual(codec.decode(tuple), reading);
  assert.equal(codec.transformedClosedObjects, 1);
  for (const wrong of [[], [reading.source, reading.text], [reading.source, reading.text, 7, "extra"], [reading.source, reading.text, "7"]]) assert.throws(() => codec.decode(wrong), invalid);
});

test("empty and homogeneous tuple shapes preserve all original cardinalities", () => {
  const empty = createNativeObjectTupleWire({ type: "object", additionalProperties: false, required: [], properties: {} }); assert.deepEqual(empty.encode({}), []); assert.deepEqual(empty.decode([]), {});
  const schema = { type: "array", minItems: 1, maxItems: 2, items: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string", minLength: 1 } } } };
  const codec = createNativeObjectTupleWire(schema); assert.deepEqual(codec.decode(codec.encode([{ text: "one" }, { text: "two" }])), [{ text: "one" }, { text: "two" }]); assert.throws(() => codec.decode([]), invalid);
});

test("schema factoring ignores schema-looking source constants and expands every original constraint exactly", () => {
  const repeated = { type: "string", minLength: 1, maxLength: 180, description: "Every original bound and this complete annotation must remain in the source-owned schema." };
  const schema = copy({ type: "object", properties: { a: repeated, b: repeated, c: repeated, source: { const: { $ref: "external literal", $defs: { type: "data" }, properties: { x: "source" } } } } });
  const before = JSON.stringify(schema), compact = factorNativeSchema(schema); assert.ok(compact.definitions > 0); assert.deepEqual(expandNativeSchema(compact.schema), schema); assert.equal(JSON.stringify(schema), before);
});

test("schema definition cycles, foreign refs and missing refs fail without recursive expansion", () => {
  for (const schema of [
    { properties: { a: { $ref: "#/$defs/d0" } }, $defs: { d0: { $ref: "#/$defs/d1" }, d1: { $ref: "#/$defs/d0" } } },
    { properties: { a: { $ref: "https://foreign.invalid/schema" } } }, { properties: { a: { $ref: "#/$defs/d1" } }, $defs: { d0: { type: "string" } } }
  ]) assert.throws(() => expandNativeSchema(schema), invalid);
});

test("model-value release covers every known calculation while preserving source names, phase markers and unknown nulls", () => {
  const fixture = nativeCodecFixture(), before = JSON.stringify(fixture.input.readingSchema), released = releaseNativeModelValues(fixture.input.readingSchema, fixture.input.calculatedValueDomains);
  assert.equal(released.audit.length, 4); assert.equal(JSON.stringify(fixture.input.readingSchema), before);
  assert.deepEqual(released.audit.map(row => row.path).sort(), Object.keys(fixture.input.calculatedValueDomains).sort());
  requireNativeModelValues(fixture.reading, released.audit); const wrong = copy(fixture.reading); wrong.scenarios[0].steps[0].values[0].after = 0;
  assert.throws(() => requireNativeModelValues(wrong, released.audit), invalid); delete wrong.scenarios[0].exampleResult; assert.throws(() => requireNativeModelValues(wrong, released.audit), invalid);
});

test("known null calculation is model-owned only with an explicit original known-null path", () => {
  const fixture = nativeCodecFixture("en", true), released = releaseNativeModelValues(fixture.input.readingSchema, fixture.input.calculatedValueDomains, fixture.input.knownNullPaths);
  assert.equal(released.audit.length, 5); requireNativeModelValues(fixture.reading, released.audit);
  const wrong = copy(fixture.reading); wrong.scenarios[0].steps[1].values[0].before = 0; assert.throws(() => requireNativeModelValues(wrong, released.audit), invalid);
});

test("calculation domains cannot omit a field, add a foreign field, force an answer or drop original bounds", () => {
  const fixture = nativeCodecFixture(), keys = Object.keys(fixture.input.calculatedValueDomains), missing = { ...copy(fixture.input.calculatedValueDomains) }; delete missing[keys[0]];
  assert.throws(() => releaseNativeModelValues(fixture.input.readingSchema, missing), invalid);
  assert.throws(() => releaseNativeModelValues(fixture.input.readingSchema, { ...fixture.input.calculatedValueDomains, "$.foreign": { type: "number" } }), invalid);
  assert.throws(() => releaseNativeModelValues(fixture.input.readingSchema, { ...fixture.input.calculatedValueDomains, [keys[0]]: { const: 42 } }), invalid);
  assert.throws(() => releaseNativeModelValues(fixture.input.readingSchema, { ...fixture.input.calculatedValueDomains, [keys[0]]: { type: "string" } }), invalid);
});

for (const value of [null, [2, 3], { values: ["raw", 7], reason: "literal value, not prose" }]) {
  test("complete computed " + (value === null ? "null" : Array.isArray(value) ? "array" : "object") + " remains an independent raw model value", () => {
    const schema = { type: "object", properties: { exampleResult: { const: value } }, required: ["exampleResult"], additionalProperties: false };
    const domain = value === null ? { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] } : Array.isArray(value) ? { type: "array", items: { type: "integer" } } : { type: "object", additionalProperties: true };
    const released = releaseNativeModelValues(schema, { "$.exampleResult": domain }, value === null ? ["$.exampleResult"] : []), codec = createNativeNamedWire(released.schema);
    const raw = codec.encode({ exampleResult: value }); requireNativeModelValues(JSON.parse(raw), released.audit); assert.deepEqual(codec.decode(raw), { exampleResult: value }); assert.throws(() => requireNativeModelValues({}, released.audit), invalid);
  });
}

test("complete call codec preserves all six original fields and never repairs missing/wrong call identities", () => {
  const fixture = nativeCodecFixture(), codec = createNativeCallCodec(fixture.callSchema), raw = codec.encode(fixture.callReading);
  assert.deepEqual(codec.decode(raw), fixture.callReading); const missing = JSON.parse(raw); delete missing.calls[0].reason; assert.throws(() => codec.decode(JSON.stringify(missing)), invalid);
  const forged = JSON.parse(raw); forged.calls[0].callId = "foreign"; assert.throws(() => codec.decode(JSON.stringify(forged)), invalid);
});

test("call codec rejects source-authored explanatory constants before constructing a model grammar", () => {
  const fixture = nativeCodecFixture(), schema = fixture.callSchema as any; schema.properties.calls.items[0].properties.reason = { const: "Source-authored answer" };
  assert.throws(() => createNativeCallCodec(schema), invalid);
});

test("a call source contract must require all six original fields in a closed row", () => {
  for (const field of ["callId", "inputs", "role", "output", "effects", "reason"]) {
    const schema = copy(nativeCodecFixture().callSchema) as any, row = schema.properties.calls.items[0];
    delete row.properties[field]; row.required = row.required.filter((name: string) => name !== field);
    assert.throws(() => createNativeCallCodec(schema), invalid);
    const optional = copy(nativeCodecFixture().callSchema) as any; optional.properties.calls.items[0].required.pop();
    assert.throws(() => createNativeCallCodec(optional), invalid);
  }
  const open = copy(nativeCodecFixture().callSchema) as any; open.properties.calls.items[0].additionalProperties = true;
  assert.throws(() => createNativeCallCodec(open), invalid);
});

test("asynchronous schemas cannot make a Promise count as successful synchronous raw validation", () => {
  assert.throws(() => createNativeNamedWire({ ...shape(), $async: true }), invalid);
});

test("a final summary with zero new calls preserves its empty call array and full model prose", () => {
  const fixture = nativeCodecFixture(), schema = copy(fixture.callSchema) as any;
  schema.properties.calls = { type: "array", minItems: 0, maxItems: 0, items: { type: "object" } };
  const value = { ...fixture.callReading, calls: [] }, codec = createNativeCallCodec(schema), raw = codec.encode(value);
  assert.deepEqual(codec.decode(raw), value);
  const invented = JSON.parse(raw); invented.calls.push((fixture.callReading.calls as unknown[])[0]); assert.throws(() => codec.decode(JSON.stringify(invented)), invalid);
});

test("native data rejects getters, cycles, aliases and nonfinite/-0 values without invoking capabilities", () => {
  let invoked = 0; const getter = {}; Object.defineProperty(getter, "text", { enumerable: true, get() { invoked++; return "answer"; } });
  const codec = createNativeNamedWire(shape()), cyclic: Record<string, unknown> = {}; cyclic.loop = cyclic;
  for (const value of [getter, cyclic, { source: sample().source, text: "value", value: NaN }, { source: sample().source, text: "value", value: -0 }]) assert.throws(() => codec.encode(value), invalid);
  assert.equal(invoked, 0); const common = { type: "string" }; assert.throws(() => createNativeNamedWire({ anyOf: [common, common] }), invalid);
});

test("native wire rejects all-restored constant-only answers and full restored output overflow", () => {
  assert.throws(() => createNativeNamedWire({ const: { answer: "not a model" } }), invalid);
  const codec = createNativeNamedWire({ type: "object", additionalProperties: false, required: ["source", "text"], properties: { source: { const: "s".repeat(23990) }, text: { type: "string", maxLength: 80 } } });
  assert.throws(() => codec.decode(JSON.stringify({ text: "complete model-written text" })), invalid);
});
