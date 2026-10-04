/** Host lifecycle tests exercise the real structured parser, cache, correlation and source-token projection. */
import assert from "node:assert/strict";
import test from "node:test";
import { FunctionNarrativesHostDelivery } from "../../webview/codeFlow/functionNarrativesHostDelivery";
import type { FunctionNarrativeProvider } from "../../application/functionNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import type { ExtensionResponse } from "../../protocol/messages";

const context: FunctionNarrativeContext = { functionName: "describe", language: "kotlin", limited: false,
  snippets: [{ id: "root", role: "function", startLine: 3, endLine: 6, text: 'fun describe() {\n if (LIMIT > 0) println("ready")\n else println("empty")\n}', truncated: false }] };
const narrative = { summary: "Print a message based on LIMIT.", scenarios: [{ title: "Positive LIMIT", when: ["LIMIT > 0"],
  steps: [{ text: "Print ready.", source: { snippetId: "root", startLine: 4, endLine: 4 } }], outcome: "Finish normally.", assumptions: [] }], limitations: [] };
const request = { flowId: `code-flow:${"a".repeat(32)}` as const, graphVersion: "fixture", requestId: 1 };

/** Only the remote provider is replaced; all request/result processing remains production code. */
function fixture(provider: FunctionNarrativeProvider) {
  const messages: ExtensionResponse[] = [];
  const locations: Array<{ path: string; startLine: number; endLine: number }> = [];
  const state = { active: "fixture", language: "en" as "ko" | "en" };
  const delivery = new FunctionNarrativesHostDelivery({ provider, isActive: (version) => version === state.active,
    getLanguage: () => state.language, createEvidence(path, range) { locations.push({ path, ...range }); return `code-evidence:${"b".repeat(64)}`; },
    async postMessage(message) { messages.push(message); } });
  delivery.register(request.flowId, request.graphVersion, context, "/private/Example.kt");
  return { delivery, messages, state, locations };
}

test("LLM Host caches source-reading narratives per locale and ignores replayed IDs without exposing source paths", async () => {
  let calls = 0;
  const f = fixture({ async generate(received, language) { calls += 1; assert.equal(received, context); assert.ok(["en", "ko"].includes(language)); return { modelName: "LLM", text: JSON.stringify(narrative) }; } });
  try {
    await f.delivery.request(request); await f.delivery.request(request);
    assert.equal(calls, 1); assert.equal(f.messages.length, 1);
    assert.deepEqual(f.locations, [{ path: "/private/Example.kt", startLine: 3, startCharacter: 0, endLine: 4, endCharacter: 0 }]);
    const first = f.messages[0]; assert.ok(first.type === "codeFlow/functionNarrativesLoaded"); assert.equal(first.payload.status, "ready");
    assert.equal(first.payload.cacheHit, false); assert.deepEqual(first.payload.narrative, narrative);
    assert.ok(!JSON.stringify(first).includes("/private/"));
    await f.delivery.request({ ...request, requestId: 2 });
    assert.equal(calls, 1); const cached = f.messages.at(-1)!; assert.ok(cached.type === "codeFlow/functionNarrativesLoaded"); assert.equal(cached.payload.cacheHit, true);
    f.state.language = "ko"; await f.delivery.request({ ...request, requestId: 3 }); assert.equal(calls, 2);
  } finally { f.delivery.clear(); }
});

test("LLM Host rejects an unauthorized function and malformed model evidence", async () => {
  let calls = 0;
  const f = fixture({ async generate() { calls += 1; return { modelName: "LLM", text: JSON.stringify({ ...narrative, scenarios: [{ ...narrative.scenarios[0], steps: [{ text: "invented", source: { snippetId: "root", startLine: 100, endLine: 100 } }] }] }) }; } });
  try {
    await f.delivery.request({ ...request, flowId: `code-flow:${"c".repeat(32)}` }); assert.equal(calls, 0);
    await f.delivery.request(request);
    const reply = f.messages.at(-1)!; assert.ok(reply.type === "codeFlow/functionNarrativesLoaded"); assert.equal(reply.payload.status, "invalid-response");
    assert.equal(f.locations.length, 0);
  } finally { f.delivery.clear(); }
});

test("LLM Host cancels a pending request and suppresses late output after root replacement", async () => {
  let release: (value: { modelName: string; text: string }) => void = () => {};
  let signal: AbortSignal | undefined;
  const f = fixture({ async generate(_context, _language, received) { signal = received; return new Promise((resolve) => { release = resolve; }); } });
  const pending = f.delivery.request(request);
  f.delivery.clear(); assert.equal(signal?.aborted, true);
  release({ modelName: "LLM", text: JSON.stringify(narrative) }); await pending;
  assert.equal(f.messages.length, 0);
});

test("LLM Host reports its 45-second deadline and releases pending work", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  const f = fixture({ async generate(_context, _language, received) { signal = received; return new Promise(() => {}); } });
  try {
    const pending = f.delivery.request(request); t.mock.timers.tick(45000); await pending;
    assert.equal(signal?.aborted, true);
    const reply = f.messages.at(-1)!; assert.ok(reply.type === "codeFlow/functionNarrativesLoaded"); assert.equal(reply.payload.status, "timeout");
  } finally { f.delivery.clear(); t.mock.timers.reset(); }
});

test("late registration from an expired graph cannot discard the current graph's LLM context", async () => {
  let calls = 0;
  const f = fixture({ async generate() { calls += 1; return { modelName: "LLM", text: JSON.stringify(narrative) }; } });
  try {
    f.state.active = "new-snapshot";
    f.delivery.register(request.flowId, "new-snapshot", context, "/private/Example.kt");
    f.delivery.register(request.flowId, "fixture", context, "/private/Example.kt");
    await f.delivery.request({ ...request, graphVersion: "new-snapshot" });
    assert.equal(calls, 1);
    const reply = f.messages.at(-1)!; assert.ok(reply.type === "codeFlow/functionNarrativesLoaded"); assert.equal(reply.payload.status, "ready");
  } finally { f.delivery.clear(); }
});

test("invalid LLM output permits model reselection and evicted contexts recover only after Host registration", async () => {
  const selections: boolean[] = [];
  const f = fixture({ async generate(_context, _language, _signal, options) {
    selections.push(Boolean(options?.reselectModel));
    return { modelName: "LLM", text: selections.length === 1 ? "invalid JSON" : JSON.stringify(narrative) };
  } });
  try {
    await f.delivery.request(request); await f.delivery.request({ ...request, requestId: 2 });
    assert.deepEqual(selections, [false, true]);
    for (let index = 0; index < 8; index += 1) f.delivery.register(`code-flow:${String(index).repeat(32)}`, "fixture", context, "/private/Example.kt");
    await f.delivery.request({ ...request, requestId: 3 });
    const expired = f.messages.at(-1)!; assert.ok(expired.type === "codeFlow/functionNarrativesLoaded"); assert.equal(expired.payload.status, "stale");
    assert.equal(selections.length, 2);
    f.delivery.register(request.flowId, "fixture", context, "/private/Example.kt");
    await f.delivery.request({ ...request, requestId: 4 });
    const refreshed = f.messages.at(-1)!; assert.ok(refreshed.type === "codeFlow/functionNarrativesLoaded"); assert.equal(refreshed.payload.status, "ready");
    assert.equal(selections.length, 3);
  } finally { f.delivery.clear(); }
});
