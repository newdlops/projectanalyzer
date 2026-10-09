/** Owned source output carries every lexical return and exact caller use while retaining unknown completion and model fallback. */
import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionCallFixedOutput, type FunctionCallNarrativeTarget } from "../../shared/functionCallNarratives";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";
import { createLocalNarrativeWire } from "../../llm/functionNarratives/localWire";
import { createFunctionCallNarrativeSchema } from "../../shared/functionCallNarratives";
import { parseFunctionCallNarrative, buildFunctionCallNarrativePrompt } from "../../application/functionCallNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

const target: FunctionCallNarrativeTarget = { callId: "call-1", caller: "parent", callee: "callee", language: "kotlin",
  expression: "callee(amount)", relation: "call", confidence: "exact", guards: [], loops: [], deferred: false, sourceLimited: false,
  resultUse: { kind: "return" }, returnSyntax: { syntaxOnly: true, limited: false, sites: [
    { code: "return value + 5", expression: "value + 5", range: { startLine: 1, startCharacter: 6, endLine: 1, endCharacter: 22 }, regions: [{ kind: "try" }] },
    { code: "return 0", expression: "0", range: { startLine: 2, startCharacter: 8, endLine: 2, endCharacter: 16 }, regions: [{ kind: "catch", label: "error" }] }
  ] } };
for (const locale of ["ko", "en"] as const) test(`${locale} owned source output retains catch 0, caller use and unknown final values`, () => {
  const value = getFunctionCallFixedOutput(target, locale)!;
  assert.ok(value.length <= 180 && value.includes("return value + 5") && value.includes("catch(error)") && value.includes("return 0"));
  assert.match(value, locale === "ko" ? /원문 반환|최종 값·완료는 미확인/u : /Source returns|Final values\/completion are unknown/u);
  assert.doesNotMatch(value, /observed|항상|반드시|always/iu);
});
test("binding/discard/await and candidate qualification remain source-owned", () => {
  assert.match(getFunctionCallFixedOutput({ ...target, resultUse: { kind: "binding", name: "answer" } }, "ko")!, /지역 `answer`/u);
  assert.match(getFunctionCallFixedOutput({ ...target, resultUse: { kind: "discard" } }, "en")!, /discards/u);
  assert.match(getFunctionCallFixedOutput({ ...target, resultUse: { kind: "return", awaited: true } }, "ko")!, /await한 결과/u);
  assert.match(getFunctionCallFixedOutput({ ...target, resultUse: { kind: "discard", awaited: true } }, "en")!, /awaited result/u);
  assert.match(getFunctionCallFixedOutput({ ...target, resultUse: { kind: "binding", name: "n", awaited: true } }, "ko")!, /await한 결과/u);
  assert.match(getFunctionCallFixedOutput({ ...target, confidence: "inferred" }, "ko")!, /후보 원문/u);
});
test("partial, deferred, absent use, overlong or control-bearing evidence retains the original model output", () => {
  assert.equal(getFunctionCallFixedOutput({ ...target, returnSyntax: { ...target.returnSyntax!, limited: true } }, "en"), undefined);
  assert.equal(getFunctionCallFixedOutput({ ...target, deferred: true }, "ko"), undefined);
  assert.equal(getFunctionCallFixedOutput({ ...target, resultUse: undefined }, "ko"), undefined);
  for (const code of ['return "' + "x".repeat(200) + '"', "return\n0"]) {
    assert.equal(getFunctionCallFixedOutput({ ...target, returnSyntax: { syntaxOnly: true, limited: false, sites: [{ ...target.returnSyntax!.sites[0], code }] } }, "en"), undefined);
  }
});

for (const locale of ["ko", "en"] as const) test(`${locale} local wire restores all five final fields and rejects model replacement while connected schemas stay variable`, () => {
  const context: FunctionNarrativeContext = { functionName: "parent", language: "kotlin", snippets: [], limited: false,
    callTask: { scope: "call", signature: "public-return-fixture", includeSummary: false, sequence: [], conditions: [],
      routeStatus: "structure", sourceLimited: false, targets: [target] } };
  const local = createLocalNarrativeSchema(context, locale) as any;
  assert.equal(local.properties.calls.items[0].properties.output.const, getFunctionCallFixedOutput(target, locale));
  const connected = createFunctionCallNarrativeSchema(context.callTask!, locale) as any;
  assert.equal(connected.properties.calls.items[0].properties.output.type, "string");
  const [, data] = buildFunctionCallNarrativePrompt(context, locale);
  const modelSyntax = JSON.parse(data).callTask.targets[0].returnSyntax;
  assert.deepEqual(modelSyntax.sites.map((site: { code: string }) => site.code), target.returnSyntax!.sites.map(site => site.code));
  assert.ok(modelSyntax.sites.every((site: object) => !Object.hasOwn(site, "range") && !Object.hasOwn(site, "expression")));
  assert.ok(target.returnSyntax!.sites.every(site => site.range && site.expression), "Host syntax facts are not mutated");
  const wire = createLocalNarrativeWire(local), slot = (wire.schema as any).properties.calls.items[0];
  assert.equal(Object.hasOwn(slot.properties, "output"), false);
  const generated = { calls: [{ role: locale === "ko" ? "대상 함수의 입력 계산과 예외 처리를 읽습니다." : "Read the callee calculation and catch handling.",
    inputs: locale === "ko" ? "대상 함수에 입력을 전달합니다." : "Pass the input to the callee.",
    effects: locale === "ko" ? "내부 호출의 효과는 미확인입니다." : "Inner-call effects are unknown." }], limitations: [] };
  const parsed = parseFunctionCallNarrative(wire.decode(JSON.stringify(generated)), context, locale);
  assert.equal(Object.keys(parsed.calls[0]).length, 6);
  assert.ok(parsed.calls[0].output.includes("return value + 5") && parsed.calls[0].output.includes("return 0"));
  assert.throws(() => wire.decode(JSON.stringify({ ...generated, calls: [{ ...generated.calls[0], output: "Forged result." }] })));
  const partial = { ...context, callTask: { ...context.callTask!, targets: [{ ...target, resultUse: undefined }] } };
  assert.equal((createLocalNarrativeSchema(partial, locale) as any).properties.calls.items[0].properties.output.type, "string");
});
