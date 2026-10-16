/** Complete root modes/prose/value wire: raw model fields are checked before source restoration, with no answer repair. */
import assert from "node:assert/strict";
import test from "node:test";
import { createNativeRootCodec, createNativeProseWire, createNativeApplicabilitySchema, createNativeNamedWire, releaseNativeModelValues, type NativeNarrativeMode } from "../../llm/nativeNarrativeCodec";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { nativeCodecFixture, unavailableCodecReading } from "../helpers/nativeNarrativeCodec";

const invalid = (error: unknown) => error instanceof FunctionNarrativeError && error.code === "invalid-response";
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

for (const locale of ["ko", "en"] as const) {
  test(locale + " root codec retains every original direct string and every full named model value", () => {
    const fixture = nativeCodecFixture(locale), before = JSON.stringify(fixture.input), codec = createNativeRootCodec(fixture.input), value = { mode: "computed", reading: fixture.reading, justification: fixture.sentence };
    const direct = codec.encode(value, { shareProse: false }), shared = codec.encode(value);
    assert.deepEqual(codec.decode(direct), value); assert.deepEqual(codec.decode(shared), value); assert.ok(shared.length < direct.length);
    assert.equal(JSON.stringify(fixture.input), before); assert.equal(codec.calculatedValueAudit.length, 4);
    const mutatedPublic = codec.schema as any; mutatedPublic.anyOf.length = 0; assert.deepEqual(codec.decode(shared), value);
  });
}

for (const mode of ["computed", "loop-visit", "source-infeasible", "unverified"] as const) {
  test("root " + mode + " retains its complete reading and all source/loop/unavailable fields", () => {
    const fixture = nativeCodecFixture(), codec = createNativeRootCodec(fixture.input), reading = ["source-infeasible", "unverified"].includes(mode) ? unavailableCodecReading(fixture.reading, fixture.sentence) : fixture.reading;
    const value = { mode, reading, justification: fixture.sentence, ...(mode === "loop-visit" ? { loopVisits: [{ sourceOperationOrdinal: 1, visit: 3, earlierIterations: 2, meaning: fixture.sentence }] } : {}) };
    assert.deepEqual(codec.decode(codec.encode(value)), value);
  });
}

test("raw missing/wrong calculations fail before fixed source fields can make the response look complete", () => {
  const fixture = nativeCodecFixture(), codec = createNativeRootCodec(fixture.input), value = { mode: "computed", reading: fixture.reading, justification: fixture.sentence };
  const raw = JSON.parse(codec.encode(value, { shareProse: false }));
  // Tuple paths are obtained from the declared schema field order; no decoder-generated value is reused as a model answer.
  const paths: number[][] = [], work: Array<{ value: unknown; path: number[] }> = [{ value: raw.reading, path: [] }];
  while (work.length) { const row = work.pop()!; if (row.value === 42) paths.push(row.path); if (Array.isArray(row.value)) row.value.forEach((value, index) => work.push({ value, path: [...row.path, index] })); }
  assert.ok(paths.length >= 2);
  for (const path of paths) { const wrong = copy(raw); let parent = wrong.reading; for (const index of path.slice(0, -1)) parent = parent[index]; parent[path.at(-1)!] = 0; assert.throws(() => codec.decode(JSON.stringify(wrong)), invalid); }
});

test("unknown phase/null markers remain source metadata while explicitly known null must be present in raw output", () => {
  const fixture = nativeCodecFixture("en", true), codec = createNativeRootCodec(fixture.input), value = { mode: "computed", reading: fixture.reading, justification: fixture.sentence };
  assert.equal(codec.calculatedValueAudit.length, 5); assert.deepEqual(codec.decode(codec.encode(value)), value);
});

for (const kind of ["object", "array"]) {
  test("computed empty " + kind + " must occupy an actual raw model field instead of being restored from a singleton shape", () => {
    const fixture = nativeCodecFixture(), value = kind === "object" ? {} : [];
    (fixture.input.readingSchema as any).properties.scenarios.items[0].properties.exampleResult.const = value;
    fixture.input.calculatedValueDomains = { ...fixture.input.calculatedValueDomains, "$.scenarios[0].exampleResult": kind === "object"
      ? { type: "object", properties: {}, required: [], additionalProperties: false } : { type: "array", items: false, minItems: 0, maxItems: 0 } };
    fixture.reading.scenarios[0].exampleResult = value;
    const codec = createNativeRootCodec(fixture.input), full = { mode: "computed", reading: fixture.reading, justification: fixture.sentence }, raw = JSON.parse(codec.encode(full, { shareProse: false }));
    assert.deepEqual(codec.decode(JSON.stringify(raw)), full); assert.deepEqual(raw.reading[1][0][6], []);
    raw.reading[1][0].splice(6, 1); assert.throws(() => codec.decode(JSON.stringify(raw)), invalid);
  });
}

test("prose references cannot borrow a prior response, point outside this table or replace a numeric calculation", () => {
  const fixture = nativeCodecFixture(), source = createNativeApplicabilitySchema(fixture.input.readingSchema, [1]) as any;
  const released = releaseNativeModelValues(fixture.input.readingSchema, fixture.input.calculatedValueDomains), named = createNativeNamedWire(released.schema);
  const original = copy(source.anyOf[0]); original.properties.reading = named.schema;
  const codec = createNativeProseWire(original, "computed"), value = { mode: "computed", reading: JSON.parse(named.encode(fixture.reading)), justification: fixture.sentence };
  const shared = codec.encode(value) as any; assert.ok(shared.prose.length > 0); assert.deepEqual(codec.decode(shared), value);
  const foreign = copy(shared); delete foreign.prose; assert.throws(() => codec.decode(foreign), invalid);
  const missing = copy(shared); missing.justification = 23999; assert.throws(() => codec.decode(missing), invalid);
  const numeric = copy(shared); numeric.reading.scenarios[0].steps[0].values[0].after = shared.prose[0]; assert.throws(() => codec.decode(numeric), invalid);
});

test("one table string must satisfy the original destination slot bound and language pattern without truncation", () => {
  const fixture = nativeCodecFixture("ko"), source = createNativeApplicabilitySchema(fixture.input.readingSchema, [1]) as any;
  const released = releaseNativeModelValues(fixture.input.readingSchema, fixture.input.calculatedValueDomains), named = createNativeNamedWire(released.schema), branch = copy(source.anyOf[0]); branch.properties.reading = named.schema;
  const codec = createNativeProseWire(branch, "computed"), value: any = codec.encode({ mode: "computed", reading: JSON.parse(named.encode(fixture.reading)), justification: fixture.sentence });
  value.prose = ["한".repeat(300)]; value.reading.scenarios[0].steps[0].syntax = 0; assert.throws(() => codec.decode(value), invalid);
});

test("a root without source loop ordinals cannot acquire a loop mode or invented ordinal", () => {
  const fixture = nativeCodecFixture(), codec = createNativeRootCodec({ ...fixture.input, loopOperationOrdinals: [] });
  assert.deepEqual((codec.fullSchema as any).anyOf.map((branch: any) => branch.properties.mode.const), ["computed", "source-infeasible", "unverified"]);
  assert.throws(() => codec.encode({ mode: "loop-visit", reading: fixture.reading, justification: fixture.sentence, loopVisits: [] }), invalid);
  for (const ordinals of [[0], [1, 1], [NaN]]) assert.throws(() => createNativeRootCodec({ ...fixture.input, loopOperationOrdinals: ordinals }), invalid);
});

test("source-authored prose and incomplete complete-root schemas are rejected before inference", () => {
  const fixture = nativeCodecFixture(), input = copy(fixture.input), schema = input.readingSchema as any; schema.properties.summary = { const: "source-authored answer" };
  assert.throws(() => createNativeRootCodec(input), invalid);
  const empty = copy(fixture.input); (empty.readingSchema as any).properties.scenarios.items[0].properties.steps.items = []; assert.throws(() => createNativeRootCodec(empty), invalid);
});

test("a source-infeasible response cannot leave an after value computed or invent a concrete example", () => {
  const fixture = nativeCodecFixture(), codec = createNativeRootCodec(fixture.input), unavailable = unavailableCodecReading(fixture.reading, fixture.sentence);
  const value = { mode: "source-infeasible" as NativeNarrativeMode, reading: unavailable, justification: fixture.sentence };
  const wrong = copy(value); wrong.reading.scenarios[0].steps[0].values[0].after = 42; assert.throws(() => codec.encode(wrong), invalid);
  const concrete = copy(value); concrete.reading.scenarios[0].exampleInputs[0].value = 6; assert.throws(() => codec.encode(concrete), invalid);
});

test("raw root JSON, complete response length and extra model fields are never repaired", () => {
  const fixture = nativeCodecFixture(), codec = createNativeRootCodec(fixture.input);
  for (const text of ["not JSON", "{}", '{"mode":"computed","reading":{},"justification":"sentence","extra":1}', " ".repeat(24001)]) assert.throws(() => codec.decode(text), invalid);
});
