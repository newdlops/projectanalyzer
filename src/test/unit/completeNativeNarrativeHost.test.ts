/** Actual parser/capture/Host/page/source lifecycles with independently authored raw native fixtures; no neural or subject-program execution. */
import assert from "node:assert/strict";
import test from "node:test";
import { unpackNativeSourceJson } from "../../llm/nativeNarrativeCodec";
import { completeNativeUnverifiedReply } from "../helpers/completeNativeNarrativeRoot";
import { createWholeNarrativeRootHost as rootHost } from "../helpers/wholeNarrativeRootHost";

test("actual Host stores all complete raw native pages inside its ready scope and serves graph/source/page cache without any legacy generation", async () => {
  let calls = 0; const h = await rootHost({ callCount: 2, async completeRoot(request, _signal, options) {
    assert.deepEqual(Object.keys(request), ["schema", "messages"]); assert.equal(Object.hasOwn(options ?? {}, "assertSourceCurrent"), false);
    calls++; const marker = "SOURCE JSON:\n", content = request.messages[1].content;
    const data = (unpackNativeSourceJson(JSON.parse(content.slice(content.lastIndexOf(marker) + marker.length))) as any)["SOURCE DATA:"];
    assert.ok(data.sourceEvidence); assert.ok(data.snippets.some((snippet: any) => snippet.text.includes("Parent 원문 😀 224")));
    assert.ok(data.snippets.some((snippet: any) => snippet.text.includes("Helper 원문 😀 84")));
    assert.ok(data.snippets.some((snippet: any) => snippet.text.includes("outsideCaller")));
    assert.ok(!JSON.stringify(request).includes("function-logic-block:"));
    return completeNativeUnverifiedReply(request);
  } });
  try {
    await h.delivery.requestFunctionNarratives(h.request);
    const result = h.replies().at(-1)!; assert.equal(result.status, "ready"); assert.equal(result.coverage?.complete, true);
    assert.equal(calls, 2); assert.equal(h.contexts.length, 0); assert.equal(h.writes(), 2); assert.equal(h.state.captures, 1); assert.equal(h.state.disposed, 1);
    assert.ok(h.events.indexOf("provider-ready") < h.events.indexOf("capture"));
    const scenario = result.narrative!.scenarios[0]; assert.equal(scenario.evaluation!.mode, "unverified");
    assert.equal(typeof scenario.example!.inputs[0].json, "object"); assert.equal(typeof scenario.example!.result, "object");
    assert.ok(scenario.nodeDetails!.length >= 4); assert.equal(scenario.nodeDetails!.filter(detail => detail.code?.includes("finish(")).length, 2);
    for (const detail of scenario.nodeDetails!) {
      assert.equal(detail.reason, "Source evidence remains unverified in this explicit CPU fixture.");
      assert.equal(typeof detail.values![0].after, "object");
      assert.equal(scenario.graph!.nodeIds[detail.occurrence!], detail.nodeId);
    }
    await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, pageIndex: 1, pageLanguage: "en" });
    const second = h.replies().at(-1)!; assert.equal(second.page?.index, 1); assert.equal(second.cacheHit, true); assert.equal(calls, 2);
    const detail = second.narrative!.scenarios[0].nodeDetails!.at(-1)!;
    await h.delivery.openFunctionNarrativeSource({ graphVersion: h.graphVersion, flowId: h.request.flowId, contextId: h.contextId,
      language: "en", scenarioIndex: 0, stepIndex: 0, nodeIndex: second.narrative!.scenarios[0].nodeDetails!.length - 1, pageIndex: 1 });
    assert.equal(h.opened.length, 1);
    await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 3, nodeId: detail.nodeId, pageLanguage: "en" });
    assert.equal(h.replies().at(-1)?.cacheHit, true); assert.equal(calls, 2); assert.equal(h.state.captures, 1);
  } finally { h.delivery.clearScenarioInputs(); }
});

test("native source change during storage revokes every page and never publishes ready", async () => {
  const h = await rootHost({ mutateDuringWrite: true, completeRoot: completeNativeUnverifiedReply });
  try {
    await h.delivery.requestFunctionNarratives(h.request);
    assert.equal(h.writes(), 1); assert.equal(h.storedPages(), 0); assert.equal(h.state.disposed, 1);
    assert.equal(h.replies().at(-1)?.status, "stale"); assert.ok(!h.replies().some(reply => reply.status === "ready"));
  } finally { h.delivery.clearScenarioInputs(); }
});

test("native cancellation awaits actual inference settlement and cleanup before returning, with no stored page", async () => {
  let enter!: () => void, release!: () => void, settled = false;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const h = await rootHost({ async completeRoot(request, signal) { enter(); await gate; assert.equal(signal.aborted, true); return completeNativeUnverifiedReply(request); } });
  try {
    const pending = h.delivery.requestFunctionNarratives(h.request).finally(() => { settled = true; });
    await entered; h.delivery.cancelFunctionNarratives(h.request); await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false); assert.equal(h.state.disposed, 0);
    release(); await pending; assert.equal(h.writes(), 0); assert.equal(h.state.disposed, 1); assert.ok(h.events.includes("provider-released"));
    assert.ok(!h.replies().some(reply => reply.status === "ready"));
  } finally { release(); h.delivery.clearScenarioInputs(); }
});

test("native cancellation during final provider release suppresses ready after all pages are written", async () => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const h = await rootHost({ completeRoot: completeNativeUnverifiedReply, async release() { enter(); await gate; } });
  try {
    const pending = h.delivery.requestFunctionNarratives(h.request); await entered;
    assert.equal(h.writes(), 2); assert.ok(!h.replies().some(reply => reply.status === "ready"));
    h.delivery.cancelFunctionNarratives(h.request); release(); await pending;
    assert.equal(h.state.disposed, 1); assert.ok(!h.replies().some(reply => reply.status === "ready"));
  } finally { release(); h.delivery.clearScenarioInputs(); }
});

test("native provider cleanup failure invalidates its completed page cache before any ready result", async () => {
  const h = await rootHost({ completeRoot: completeNativeUnverifiedReply, async release() { throw new Error("Explicit cleanup fixture failure"); } });
  try {
    await h.delivery.requestFunctionNarratives(h.request); assert.equal(h.writes(), 2); assert.equal(h.storedPages(), 0);
    assert.ok(!h.replies().some(reply => reply.status === "ready")); assert.equal(h.replies().at(-1)?.coverage?.completed, 0);
    assert.equal(h.state.disposed, 1);
  } finally { h.delivery.clearScenarioInputs(); }
});

test("an invalid complete native reply fails without falling back to legacy generation or provisional prose", async () => {
  const h = await rootHost({ async completeRoot() { return { modelName: "Explicit malformed fixture", text: "{}" }; } });
  try {
    await h.delivery.requestFunctionNarratives(h.request); assert.equal(h.writes(), 0); assert.equal(h.contexts.length, 0);
    assert.equal(h.replies().at(-1)?.status, "invalid-response"); assert.equal(h.state.disposed, 1);
    assert.ok(!h.replies().some(reply => reply.status === "ready"));
  } finally { h.delivery.clearScenarioInputs(); }
});
