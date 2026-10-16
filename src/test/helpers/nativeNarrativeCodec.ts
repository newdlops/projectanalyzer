/** Explicit codec authoring fixtures, never model outputs or executable source/heldout examples. */
import type { NativeNarrativeSchema, NativeRootCodecInput } from "../../llm/nativeNarrativeCodec";

const own = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Complete root fields and independently supplied calculation domains; strings/values are authored test data only. */
export function nativeCodecFixture(locale: "ko" | "en" = "en", knownNull = false): {
  input: NativeRootCodecInput; reading: Record<string, any>; sentence: string; callSchema: NativeNarrativeSchema; callReading: Record<string, unknown>;
} {
  const ko = locale === "ko", sentence = ko ? "이 문장은 시험 응답이 작성한 완전한 해설이며 원래 문자열을 그대로 보존합니다." : "This complete sentence was authored in the fixture response and must remain exactly unchanged.";
  const prose = (maximum: number) => ({ type: "string", minLength: 1, maxLength: maximum,
    ...(ko ? { pattern: `^[가-힣][^"\\\\\\x00-\\x1F]{0,${maximum - 1}}$` } : {}) });
  const closed = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
  const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };
  const values = [{ name: "result", before: ko ? "반환 전" : "not returned", after: 42 }, { name: "kept", before: 3, after: 7 }];
  const step = closed({ code: { const: "return fixtureValue; // 😀\r\nwhole source" }, syntax: prose(160), text: prose(120), reason: prose(180), effect: prose(160),
    source: { const: { snippetId: "source-0", startLine: 1, endLine: 3 } }, values: { const: values } });
  const last = closed({ code: { const: "source phase" }, syntax: prose(160), text: prose(120), reason: prose(180), effect: prose(160),
    source: { const: { snippetId: "source-0", startLine: 4, endLine: 4 } }, values: { type: "array", minItems: 1, maxItems: 1,
      items: [closed({ name: { const: "nullable" }, before: { const: null }, after: { const: ko ? "미확인" : "unconfirmed" } })] } });
  const schema = closed({ summary: prose(240), scenarios: { type: "array", minItems: 1, maxItems: 1, items: [closed({
    exampleInputs: { type: "array", minItems: 1, maxItems: 1, items: [closed({ name: { const: "input" }, value: { type: "number" } })] },
    title: prose(64), when: { const: ["fixed source predicate"] }, explanation: prose(600),
    analysis: closed({ pathReason: prose(220), stateChange: prose(220), alternative: prose(220) }),
    steps: { type: "array", minItems: 2, maxItems: 2, items: [step, last] }, outcome: { const: "fixed source outcome" },
    assumptions: { type: "array", maxItems: 2, items: prose(160) }, exampleResult: { const: 42 }
  })] }, limitations: { type: "array", maxItems: 2, items: prose(160) } });
  const reading = { summary: sentence, scenarios: [{ exampleInputs: [{ name: "input", value: 6 }], title: ko ? "시험 해설" : "Fixture reading", when: ["fixed source predicate"], explanation: sentence,
    analysis: { pathReason: sentence, stateChange: sentence, alternative: sentence }, steps: [
      { code: "return fixtureValue; // 😀\r\nwhole source", syntax: sentence, text: sentence, reason: sentence, effect: sentence, source: { snippetId: "source-0", startLine: 1, endLine: 3 }, values },
      { code: "source phase", syntax: sentence, text: sentence, reason: sentence, effect: sentence, source: { snippetId: "source-0", startLine: 4, endLine: 4 }, values: [{ name: "nullable", before: null, after: ko ? "미확인" : "unconfirmed" }] }
    ], outcome: "fixed source outcome", assumptions: [], exampleResult: 42 }], limitations: [] };
  const domains: Record<string, NativeNarrativeSchema> = {
    "$.scenarios[0].exampleResult": nullableNumber, "$.scenarios[0].steps[0].values[0].after": nullableNumber,
    "$.scenarios[0].steps[0].values[1].before": nullableNumber, "$.scenarios[0].steps[0].values[1].after": nullableNumber
  };
  if (knownNull) domains["$.scenarios[0].steps[1].values[0].before"] = nullableNumber;
  const callSchema = closed({ summary: prose(240), flow: prose(600), calls: { type: "array", minItems: 1, maxItems: 1, items: [closed({
    callId: { const: "call-0" }, role: prose(160), inputs: { const: "Given source argument transfer" }, output: prose(180), effects: prose(180), reason: prose(180)
  })] }, limitations: { type: "array", maxItems: 2, items: prose(180) } });
  const callReading = { summary: sentence, flow: sentence, calls: [{ callId: "call-0", role: sentence, inputs: "Given source argument transfer", output: sentence, effects: sentence, reason: sentence }], limitations: [] };
  return own({ input: { readingSchema: schema, calculatedValueDomains: domains, knownNullPaths: knownNull ? ["$.scenarios[0].steps[1].values[0].before"] : [], loopOperationOrdinals: [1] }, reading, sentence, callSchema, callReading });
}

/** Honest unavailable values are explicit authored fixture fields; construction does not infer applicability. */
export function unavailableCodecReading(reading: Record<string, any>, sentence: string): Record<string, any> {
  const value = own(reading), unavailable = () => ({ kind: "not-evaluated", reason: sentence });
  for (const scenario of value.scenarios) {
    for (const input of scenario.exampleInputs) input.value = unavailable(); scenario.exampleResult = unavailable();
    for (const [index, step] of scenario.steps.entries()) for (const cell of step.values) {
      if (index === 0 && !["not returned", "반환 전"].includes(cell.before)) cell.before = unavailable(); cell.after = unavailable();
    }
  }
  return value;
}
