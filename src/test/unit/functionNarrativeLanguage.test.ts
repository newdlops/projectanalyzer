/** Regressions for English output mislabeled as Korean, including decoder guidance, source literals and Host ownership. */
import assert from "node:assert/strict";
import test from "node:test";
import { isFunctionNarrativeLanguage, type FunctionNarrative, type FunctionNarrativeContext } from "../../shared/functionNarratives";
import { parseFunctionNarrative } from "../../application/functionNarratives";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";
import { FunctionNarrativesHostDelivery } from "../../webview/codeFlow/functionNarrativesHostDelivery";
import type { ExtensionResponse } from "../../protocol/messages";

const context: FunctionNarrativeContext = { functionName: "describe", language: "kotlin", limited: false,
  snippets: [{ id: "root", role: "function", startLine: 1, endLine: 3, text: 'fun describe() {\n if (LIMIT > 0) println("ready")\n}', truncated: false }] };
const english: FunctionNarrative = { summary: "Print a message when LIMIT is positive.", scenarios: [{ title: "Positive LIMIT", when: ["LIMIT > 0"],
  explanation: "A positive LIMIT prints ready.", steps: [{ text: "Print ready.", reason: "LIMIT is positive.", effect: "The message is printed.",
    source: { snippetId: "root", startLine: 2, endLine: 2 } }], outcome: "Finish normally.", assumptions: [] }], limitations: [] };
const korean: FunctionNarrative = { summary: "LIMIT가 양수이면 메시지를 출력합니다.", scenarios: [{ title: "양수 LIMIT", when: ["LIMIT > 0"],
  explanation: "LIMIT가 양수이면 ready를 출력합니다.", steps: [{ text: 'println("ready")', reason: "LIMIT가 양수이므로 조건을 통과합니다.", effect: "메시지를 출력합니다.",
    source: { snippetId: "root", startLine: 2, endLine: 2 } }], outcome: "정상 종료합니다.", assumptions: [] }], limitations: [] };

test("requested prose language ignores quoted code but rejects English-only and mixed detailed explanations", () => {
  assert.equal(isFunctionNarrativeLanguage(english, "ko"), false);
  assert.equal(isFunctionNarrativeLanguage(korean, "ko"), true);
  const mixed = structuredClone(korean); mixed.scenarios[0].steps[0].effect = "The else branch is skipped.";
  assert.equal(isFunctionNarrativeLanguage(mixed, "ko"), false);
  const quoted = structuredClone(english); quoted.summary = 'Return "완료" from `설명` when the input is valid.';
  assert.equal(isFunctionNarrativeLanguage(quoted, "en"), true);
  quoted.summary = 'The result is "한국어".';
  assert.equal(isFunctionNarrativeLanguage(quoted, "ko"), false, "a quoted Korean literal cannot pass an English explanation");
});

test("Host parsing checks language after source validation and preserves actual code conditions and operations", () => {
  assert.throws(() => parseFunctionNarrative(JSON.stringify(english), context, "ko"), { message: "language-mismatch" });
  assert.deepEqual(parseFunctionNarrative(JSON.stringify(korean), context, "ko"), korean);
  const wrong = structuredClone(korean); wrong.scenarios[0].when = ["The input is valid."];
  assert.throws(() => parseFunctionNarrative(JSON.stringify(wrong), context, "ko"), { message: "language-mismatch" });
});

test("Korean decoding constrains free descriptions without translating source frame constants", () => {
  const ko = createLocalNarrativeSchema(context, "ko") as any;
  const en = createLocalNarrativeSchema(context, "en") as any;
  assert.ok(new RegExp(ko.properties.summary.pattern, "u").test("이 함수는 LIMIT가 양수이면 메시지를 출력합니다."));
  assert.equal(new RegExp(ko.properties.summary.pattern, "u").test(english.summary), false);
  assert.equal(new RegExp(ko.properties.summary.pattern, "u").test("가".repeat(1201)), false);
  assert.equal(en.properties.summary.pattern, undefined);
});

test("an English response to Korean is neither cached nor decorated and retries require a new explicit request", async () => {
  let calls = 0; const shown: unknown[] = []; const messages: ExtensionResponse[] = [];
  const delivery = new FunctionNarrativesHostDelivery({ getLanguage: () => "ko", isActive: () => true,
    createEvidence: () => `code-evidence:${"a".repeat(64)}`, sourcePresenter: { show(value) { shown.push(value); }, clear() {} },
    async postMessage(message) { messages.push(message); }, provider: { async generate() {
      calls++; return { modelName: "Local", text: JSON.stringify(calls === 1 ? english : korean) };
    } } });
  const request = { graphVersion: "fixture", flowId: `code-flow:${"a".repeat(32)}` as const, requestId: 1 };
  delivery.register(request.flowId, request.graphVersion, context, "/private/Example.kt", "a".repeat(64));
  try {
    await delivery.request(request);
    const rejected = messages.at(-1)!; assert.ok(rejected.type === "codeFlow/functionNarrativesLoaded");
    assert.equal(rejected.payload.status, "language-mismatch"); assert.equal(rejected.payload.narrative, undefined);
    assert.equal(calls, 1); assert.equal(shown.length, 0);
    await delivery.request({ ...request, requestId: 2 });
    const accepted = messages.at(-1)!; assert.ok(accepted.type === "codeFlow/functionNarrativesLoaded");
    assert.equal(accepted.payload.status, "ready"); assert.equal(accepted.payload.language, "ko"); assert.equal(shown.length, 1);
    await delivery.request({ ...request, requestId: 3 }); assert.equal(calls, 2);
    const cached = messages.at(-1)!; assert.ok(cached.type === "codeFlow/functionNarrativesLoaded"); assert.equal(cached.payload.cacheHit, true);
  } finally { delivery.clear(); }
});
