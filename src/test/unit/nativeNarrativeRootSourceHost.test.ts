/** Actual production root capture reaches the source-only packet constructor before fixture model replies; this is not actual NN/meaning/latency qualification. */
import assert from "node:assert/strict";
import test from "node:test";
import { createNativeSourceRootPacket, type NativeRootSourceContext } from "../../llm/nativeNarrativeCodec";
import { createWholeNarrativeRootHost } from "../helpers/wholeNarrativeRootHost";

test("actual root Host passes all parent/helper/caller source and exact occurrence bindings into complete native source-only packets", async () => {
  const packets: ReturnType<typeof createNativeSourceRootPacket>[] = []; let failure: unknown;
  const h = await createWholeNarrativeRootHost({ callCount: 2, inspectContext(context) {
    if (context.nodeTask || context.summaryTask) return;
    try {
      const fields = ["functionName", "language", "limited", "snippets", "sourceEvidence", "groundingLimited", "returnTypeText", "valueNames", "valueFacts", "scenarioBatch", "nodePreparation", "detailLevel", "parameters", "sourceFlow"];
      const source = Object.fromEntries(fields.filter(key => Object.hasOwn(context, key)).map(key => [key, context[key as keyof typeof context]])) as NativeRootSourceContext;
      const packet = createNativeSourceRootPacket({ context: source, locale: "en" }), data = packet.restore().sourceData as any; packets.push(packet);
      assert.ok(data.sourceEvidence); assert.equal(data.snippets.length, context.snippets.length);
      assert.ok(data.snippets.some((snippet: any) => snippet.text.includes("Parent 원문 😀 224"))); assert.ok(data.snippets.some((snippet: any) => snippet.text.includes("Helper 원문 😀 84"))); assert.ok(data.snippets.some((snippet: any) => snippet.text.includes("outsideCaller")));
      assert.equal(data.selectedRoutes[0].operations.length, context.sourceFlow!.paths[0].steps.length);
      for (const [index, step] of context.sourceFlow!.paths[0].steps.entries()) { const bound = packet.bindings.occurrences[index]; assert.equal(bound.nodeId, step.graphNodeId); assert.equal(bound.occurrence, step.graphOccurrence); assert.deepEqual(bound.source, step.source); assert.equal(bound.code, step.code); }
    } catch (error) { failure = error; throw error; }
  } });
  try {
    await h.delivery.requestFunctionNarratives(h.request); if (failure) throw failure;
    assert.equal(h.replies().at(-1)?.status, "ready"); assert.equal(packets.length, 2); assert.equal(h.state.captures, 1); assert.equal(h.state.disposed, 1); assert.equal(h.writes(), 2);
    assert.ok(h.events.indexOf("prepare") < h.events.indexOf("capture")); assert.ok(h.events.includes("provider-released"));
  } finally { h.delivery.clearScenarioInputs(); }
});
