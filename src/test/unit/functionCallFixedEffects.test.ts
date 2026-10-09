/** Complete explicit effect syntax restores a source inventory, never successful I/O or actual mutation/completion proof. */
import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionCallFixedEffects, createFunctionCallNarrativeSchema, type FunctionCallNarrativeTarget } from "../../shared/functionCallNarratives";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";
import { createLocalNarrativeWire } from "../../llm/functionNarratives/localWire";
import { parseFunctionCallNarrative, buildFunctionCallNarrativePrompt } from "../../application/functionCallNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

const range = { startLine: 1, startCharacter: 4, endLine: 1, endCharacter: 16 };
const target: FunctionCallNarrativeTarget = { callId: "call-1", caller: "parent", callee: "child", language: "typescript",
  expression: "child(amount)", relation: "call", confidence: "exact", guards: [], loops: [], deferred: false, sourceLimited: false,
  effectSyntax: { syntaxOnly: true, limited: false, sites: [{ kind: "call", code: "audit(value)", range, regions: [{ kind: "finally" }] }] } };

for (const locale of ["ko", "en"] as const) test(`${locale} keeps exact cleanup arguments, lexical scope and unknown order/effects/completion`, () => {
  const text = getFunctionCallFixedEffects(target, locale)!;
  assert.ok(text.includes("audit(value)") && text.includes("finally") && text.length <= 180);
  assert.match(text, locale === "ko" ? /어휘적|미확인/u : /Lexical|unknown/u);
  assert.doesNotMatch(text, /logs|stores|로그|저장|observed/u);
  const empty = getFunctionCallFixedEffects({ ...target, effectSyntax: { ...target.effectSyntax!, sites: [] } }, locale)!;
  assert.match(empty, locale === "ko" ? /명시적|암묵적.*미확인/u : /explicit|Implicit.*unknown/u);
  assert.match(getFunctionCallFixedEffects({ ...target, sourceKind: "method" }, locale)!, locale === "ko" ? /후보/u : /Candidate/u);
});

test("missing/partial/deferred/long/control-bearing inventories retain the model field instead of truncating evidence", () => {
  for (const changed of [{ effectSyntax: undefined }, { deferred: true },
    { effectSyntax: { ...target.effectSyntax!, limited: true } },
    { effectSyntax: { ...target.effectSyntax!, sites: [{ ...target.effectSyntax!.sites[0], code: "audit(" + "x".repeat(180) + ")" }] } },
    { effectSyntax: { ...target.effectSyntax!, sites: [{ ...target.effectSyntax!.sites[0], code: "audit(\nvalue)" }] } }]) {
    assert.equal(getFunctionCallFixedEffects({ ...target, ...changed }, "en"), undefined);
  }
});

for (const locale of ["ko", "en"] as const) test(`${locale} local wire owns effects while every final field and connected-model generation remain available`, () => {
  const context: FunctionNarrativeContext = { functionName: "parent", language: "typescript", snippets: [], limited: false,
    callTask: { scope: "call", signature: "effect-fixture", includeSummary: false, sequence: [], conditions: [],
      routeStatus: "structure", sourceLimited: false, targets: [target] } };
  const local = createLocalNarrativeSchema(context, locale) as any;
  assert.equal(local.properties.calls.items[0].properties.effects.const, getFunctionCallFixedEffects(target, locale));
  assert.equal((createFunctionCallNarrativeSchema(context.callTask!, locale) as any).properties.calls.items[0].properties.effects.type, "string");
  const wire = createLocalNarrativeWire(local), generated = { calls: [{
    role: locale === "ko" ? "대상 함수의 입력 계산을 설명합니다." : "Describe the callee input calculation.",
    inputs: locale === "ko" ? "입력을 대상 함수로 전달합니다." : "Forward input to the callee.",
    output: locale === "ko" ? "실제 최종 결과는 미확인입니다." : "Actual final results are unknown."
  }], limitations: [] };
  const parsed = parseFunctionCallNarrative(wire.decode(JSON.stringify(generated)), context, locale);
  assert.equal(Object.keys(parsed.calls[0]).length, 6); assert.ok(parsed.calls[0].effects.includes("audit(value)"));
  assert.throws(() => wire.decode(JSON.stringify({ ...generated, calls: [{ ...generated.calls[0], effects: "Forged." }] })));
  const [, data] = buildFunctionCallNarrativePrompt(context, locale), evidence = JSON.parse(data).callTask.targets[0].effectSyntax;
  assert.equal(evidence.sites[0].code, "audit(value)"); assert.equal(Object.hasOwn(evidence.sites[0], "range"), false);
  assert.deepEqual(target.effectSyntax!.sites[0].range, range, "Host source ownership remains unchanged");
});
