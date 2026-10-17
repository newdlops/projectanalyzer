/** Strict source-only call packet/Host decoding with independent raw CPU prose, never a neural correctness oracle. */
import assert from "node:assert/strict";
import test from "node:test";
import { createCompleteFunctionCallNarrative } from "../../application/functionCallNarratives";
import { unpackNativeInputMessages } from "../../llm/nativeNarrativeCodec";
import { FunctionNarrativeError, type FunctionNarrativeContext } from "../../shared/functionNarratives";
import { completeNativeCallReply } from "../helpers/completeNativeNarrativeCall";
import { nativeCallInputFixture } from "../helpers/nativeNarrativeInput";

/** Use source-issued browser-compatible call IDs without deriving any explanatory prose from the source. */
function source(includeSummary = false): FunctionNarrativeContext {
  const context = nativeCallInputFixture(includeSummary) as FunctionNarrativeContext;
  context.callTask!.targets.forEach((target, index) => { target.callId = "call-" + (index + 1); });
  return context;
}

test("complete call packet retains all six whole prior fields and every original source byte without invoking source ports", () => {
  const context = source(); let invoked = false;
  context.sourceCallReadings = { read() { invoked = true; throw new Error("Forbidden source answer port"); } };
  const task = createCompleteFunctionCallNarrative(context, "en"), messages = unpackNativeInputMessages(task.request.messages);
  const data = JSON.parse(messages[1].content.split("SOURCE DATA:\n")[1]);
  assert.deepEqual(data.callTask.earlierModelReadings, context.callTask!.earlierModelReadings);
  assert.equal(data.callTask.earlierModelReadings.length, 20); assert.ok(data.callTask.earlierModelReadings[0].reason.length > 300);
  assert.ok(data.snippets[0].text.includes("\r\n")); assert.equal(invoked, false);
  const value = task.decode(completeNativeCallReply(task.request).text);
  assert.deepEqual(value.calls.map(call => call.callId), ["call-1", "call-2"]); assert.ok(value.calls.every(call => Object.keys(call).length === 6));
});

test("complete call raw decoding rejects a missing independent field, extra field and mutated packet instead of filling or repairing prose", () => {
  const task = createCompleteFunctionCallNarrative(source(), "en"), raw = JSON.parse(completeNativeCallReply(task.request).text);
  const missing = structuredClone(raw); delete missing.calls[0].reason;
  assert.throws(() => task.decode(JSON.stringify(missing)), FunctionNarrativeError);
  assert.throws(() => task.decode(JSON.stringify({ ...raw, invented: true })), FunctionNarrativeError);
  task.request.messages[1].content += "changed"; assert.throws(() => task.decode(JSON.stringify(raw)), FunctionNarrativeError);
});

test("native call decode binds to owned original targets and preserves an unfinished full raw summary without sentence clipping", () => {
  const context = source(true), task = createCompleteFunctionCallNarrative(context, "en"), raw = JSON.parse(completeNativeCallReply(task.request).text);
  raw.summary = "The complete supplied first sentence is retained. This unfinished final clause";
  context.callTask!.targets[0].callId = "call-99";
  const decoded = task.decode(JSON.stringify(raw)); assert.equal(decoded.summary, raw.summary); assert.equal(decoded.calls[0].callId, "call-1");
});

test("native call decode independently checks locale and rejects a missing source task", () => {
  const task = createCompleteFunctionCallNarrative(source(), "en"), raw = JSON.parse(completeNativeCallReply(task.request).text); raw.calls[0].role = "한국어로 작성된 설명입니다.";
  assert.throws(() => task.decode(JSON.stringify(raw)), error => error instanceof FunctionNarrativeError && error.code === "language-mismatch");
  const context = source(); delete context.callTask; assert.throws(() => createCompleteFunctionCallNarrative(context, "en"), FunctionNarrativeError);
});
