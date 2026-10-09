/** Fixed reaching facts preserve uncertainty and prevent model-added conditions without changing source-only readers. */
import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionCallFixedReason, type FunctionCallNarrativeTarget } from "../../shared/functionCallNarratives";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";
import { createLocalNarrativeWire } from "../../llm/functionNarratives/localWire";
import { parseFunctionCallNarrative } from "../../application/functionCallNarratives";

const target: FunctionCallNarrativeTarget = { callId: "call-1", caller: "inspect", callee: "other", language: "kotlin",
  expression: "other()", relation: "call", confidence: "exact", guards: [], loops: [], deferred: false, sourceLimited: false, arguments: [] };

for (const language of ["ko", "en"] as const) test(`${language} fixed reason describes supplied relationships without claiming actual reach`, () => {
  const reason = getFunctionCallFixedReason(target, language)!;
  assert.ok(reason.length <= 180);
  assert.match(reason, language === "ko" ? /실제 도달·실행은 관찰하지/u : /not an observed reach or execution/u);
  assert.doesNotMatch(reason, /always|반드시|무조건/iu);
  const guarded = getFunctionCallFixedReason({ ...target, guards: [{ expression: "enabled", outcome: "false" }], loops: ["while (ready)"] }, language)!;
  assert.ok(guarded.includes("`enabled` → false") && guarded.includes("`while (ready)`"));
});

test("candidate and deferred facts remain qualified; long/control-bearing source uses the original model field", () => {
  const qualified = getFunctionCallFixedReason({ ...target, sourceKind: "method", confidence: "inferred", deferred: true, relation: "event" }, "ko")!;
  assert.match(qualified, /즉시 실행을 뜻하지/u); assert.match(qualified, /dispatch는 미확인/u);
  assert.equal(getFunctionCallFixedReason({ ...target, guards: [{ expression: "condition".repeat(50), outcome: "true" }] }, "en"), undefined);
  assert.equal(getFunctionCallFixedReason({ ...target, guards: [{ expression: "\x00", outcome: "true" }] }, "ko"), undefined);
  for (const control of ["\n", "\r", "\t", "\x7F"]) {
    assert.equal(getFunctionCallFixedReason({ ...target, loops: ["while (" + control + "ready)"] }, "en"), undefined);
  }
});

test("escaped Kotlin identifiers retain the model field when the owned English wording would fail Host language validation", () => {
  const guarded = { ...target, guards: [{ expression: "settings.`호출 허용`", outcome: "true" }] };
  assert.equal(getFunctionCallFixedReason(guarded, "en"), undefined);
  assert.ok(getFunctionCallFixedReason(guarded, "ko")?.includes("settings.`호출 허용`"));
  assert.ok(getFunctionCallFixedReason({ ...target, guards: [{ expression: 'settings["허용"]', outcome: "true" }] }, "en"));
});

test("local transport restores all five fields and cannot replace an owned reason with a fabricated guard", () => {
  const context = { functionName: "inspect", language: "kotlin", limited: true, snippets: [], callTask: {
    scope: "call" as const, signature: "fun inspect()", includeSummary: false, sourceLimited: true, routeStatus: "structure" as const,
    conditions: [], sequence: [], targets: [target] } };
  const schema = createLocalNarrativeSchema(context, "ko"), wire = createLocalNarrativeWire(schema);
  const payload = { calls: [{ role: "대상 코드를 읽는 호출입니다.", output: "반환 값은 미확인입니다.", effects: "효과는 미확인입니다." }], limitations: [] };
  const parsed = parseFunctionCallNarrative(wire.decode(JSON.stringify(payload)), context, "ko");
  assert.equal(parsed.calls[0].reason, getFunctionCallFixedReason(target, "ko"));
  assert.equal(Object.keys(parsed.calls[0]).length, 6);
  assert.throws(() => wire.decode(JSON.stringify({ ...payload, calls: [{ ...payload.calls[0], reason: "입력이 양수인 경우 호출합니다." }] })), /invalid-response/u);
});
