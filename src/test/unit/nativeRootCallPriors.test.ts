/** Complete root input prior data is lossless and structurally source-bound; a DTO cannot prove actual neural authorship. */
import assert from "node:assert/strict";
import test from "node:test";
import { createNativeSourceRootPacket, type NativeRootSourceContext } from "../../llm/nativeNarrativeCodec";
import type { FunctionNarrativeCallPriors } from "../../shared/functionNarratives";
import { completeNativeSourceFixture } from "../helpers/completeNativeNarrativeRoot";
import { createCompleteFunctionNarrativeRoot } from "../../application/functionNarratives";
import { FunctionNarrativeError } from "../../shared/functionNarratives";

/** Author a data-only source/reading pair; only the actual production Host tests establish worker/action binding. */
function context(): NativeRootSourceContext {
  const source = completeNativeSourceFixture(), snippet = source.snippets[0].id;
  const sequence = [1,2].map(index => ({ callId: "call-" + index, expression: "helper(original)", callee: "helper", deferred: false }));
  const targets = sequence.map(row => ({ ...row, caller: source.functionName, language: source.language, relation: "call" as const, confidence: "inferred" as const,
    guards: [{ expression: "Full original source guard ".repeat(100), outcome: "true" }], loops: ["Full original source loop ".repeat(100)], sourceLimited: true, callerSnippet: snippet, calleeSnippet: snippet }));
  const readings = sequence.map(row => ({ callId: row.callId, role: "Original role ".repeat(80), inputs: "Original inputs 😀 ".repeat(80), output: "Original output remains unknown ".repeat(80), effects: "Original effects remain unknown ".repeat(80), reason: "Original reaching reason ".repeat(80) }));
  const priors: FunctionNarrativeCallPriors = { basis: "model-inference", signature: "Full source signature ".repeat(100), sequence, targets, readings, limitations: [["The whole original model limitation remains unknown."], ["A separate whole original limitation remains unknown."]] };
  source.callPriors = priors; return source;
}

test("complete root packet retains every prior field/source annotation/limitation and owns its original full values", () => {
  const source = context(), expected = structuredClone(source.callPriors), packet = createNativeSourceRootPacket({ context: source, locale: "en" });
  assert.deepEqual(packet.restore().sourceData.callPriors, expected);
  source.callPriors!.readings[0].reason = "Mutated after ownership"; assert.deepEqual(packet.restore().sourceData.callPriors, expected);
  assert.equal((packet.restore().sourceData.callPriors as any).targets[0].confidence, "inferred");
});

test("root prior fields cannot omit prose, reorder identity, add keys or refer to missing source snippets", () => {
  const a = context(); delete (a.callPriors!.readings[0] as Partial<FunctionNarrativeCallPriors["readings"][number]>).reason;
  assert.throws(() => createNativeSourceRootPacket({ context: a, locale: "en" }));
  const b = context(); b.callPriors!.readings.reverse(); assert.throws(() => createNativeSourceRootPacket({ context: b, locale: "en" }));
  const c = context(); Object.assign(c.callPriors!.readings[0], { inferredAnswer: "Extra" }); assert.throws(() => createNativeSourceRootPacket({ context: c, locale: "en" }));
  const d = context(); d.callPriors!.targets[0].callerSnippet = "missing-source"; assert.throws(() => createNativeSourceRootPacket({ context: d, locale: "en" }));
});

test("root prior copying rejects getters without invoking them and never accepts a data label as a proof capability", () => {
  const source = context(); let invoked = false;
  Object.defineProperty(source.callPriors!.readings[0], "role", { enumerable: true, get() { invoked = true; return "Forbidden"; } });
  assert.throws(() => createNativeSourceRootPacket({ context: source, locale: "en" })); assert.equal(invoked, false);
  const other = context(); Object.assign(other.callPriors!, { certifyNeural() { invoked = true; } });
  assert.throws(() => createNativeSourceRootPacket({ context: other, locale: "en" })); assert.equal(invoked, false);
});

test("complete root adapter preserves a whole aggregate input budget failure instead of misclassifying it as a malformed reply", () => {
  const source = context(); source.callPriors!.readings[0].output = "o".repeat(600000); source.callPriors!.readings[0].reason = "r".repeat(600000);
  assert.throws(() => createCompleteFunctionNarrativeRoot(source, "en"), error => error instanceof FunctionNarrativeError && error.code === "context-too-large");
});
