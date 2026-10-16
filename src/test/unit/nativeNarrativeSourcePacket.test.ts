/** Real production source capture enters the native call packet; fixture replies prove boundaries only, never neural semantics or latency. */
import assert from "node:assert/strict";
import test from "node:test";
import { createNativeCallPacket, createNativeCallCodec } from "../../llm/nativeNarrativeCodec";
import { createFunctionCallNarrativeSchema, type FunctionCallReading } from "../../shared/functionCallNarratives";
import { createWholeNarrativeCallHost } from "../helpers/wholeNarrativeCallHost";
import { functionCallReadingReply } from "./helpers/functionCallReadingFixture";

test("actual complete production call Host enters native packets with all long source/prior fields and strict unchanged fixture replies", async () => {
  const actual: FunctionCallReading[] = [], packets: ReturnType<typeof createNativeCallPacket>[] = []; let failure: unknown;
  const h = await createWholeNarrativeCallHost(fixture => ({
    async prepare() { fixture.events.push("prepare"); },
    async generate(context) {
      try {
        const packet = createNativeCallPacket({ locale: "en", context: { functionName: context.functionName, language: context.language, limited: context.limited, snippets: context.snippets, callTask: context.callTask, sourceEvidence: context.sourceEvidence } });
        packets.push(packet); const source = packet.restore().sourceData as any;
        assert.equal(source.callTask.earlierModelReadings.length, actual.length);
        for (const [index, prior] of source.callTask.earlierModelReadings.entries()) for (const key of ["callId", "role", "inputs", "output", "effects", "reason"] as const) assert.equal(prior[key], actual[index][key]);
        const fixtureReply = functionCallReadingReply(context), full = JSON.parse(fixtureReply.text);
        for (const call of full.calls) { call.role = "The supplied callee owns this complete source responsibility, including the original expression and its declared source context.";
          call.reason = "The selected source route reaches this call using every original guard and loop annotation, without assuming an observed execution result."; }
        // Authoring inversion of an explicit external-model fixture. No source calculation or real neural output is used to manufacture these sentences.
        const schema = JSON.parse(JSON.stringify(createFunctionCallNarrativeSchema(context.callTask!, "en"))), raw = createNativeCallCodec(schema).encode(full), decoded = packet.decode(raw) as typeof full;
        assert.deepEqual(decoded, full); actual.push(...decoded.calls); return { ...fixtureReply, text: JSON.stringify(decoded) };
      } catch (error) { failure = error; throw error; }
    },
    async withRun<T>(_language: "ko" | "en", _signal: AbortSignal, operation: () => Promise<T>) { try { return await operation(); } finally { fixture.events.push("provider-released"); } }
  }));
  try {
    await h.host.explain(h.request); if (failure) throw failure;
    assert.equal(h.messages.at(-1)?.status, "ready"); assert.equal(packets.length, 7); assert.equal(actual.length, 12); assert.equal(h.state.disposed, 1);
    for (const packet of packets) { const source = packet.restore().sourceData as any; assert.ok(source.sourceEvidence);
      assert.ok(source.snippets.find((snippet: any) => snippet.role === "function").text.includes("Parent 원문 😀 224"));
      assert.ok(source.snippets.every((snippet: any) => !snippet.truncated)); assert.ok(source.snippets.some((snippet: any) => snippet.text.includes("Helper 원문 😀 84"))); }
    assert.ok(h.events.indexOf("prepare") < h.events.indexOf("capture")); assert.ok(h.events.includes("provider-released"));
    const final = packets.at(-1)!.restore().sourceData as any; assert.equal(final.callTask.earlierModelReadings.length, 12); assert.equal(final.callTask.calleeEvidence.length, 12);
  } finally { h.host.reset(); }
});
