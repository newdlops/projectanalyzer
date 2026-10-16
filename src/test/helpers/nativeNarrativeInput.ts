/** Explicit serialization fixtures only: complete source strings and prior fields are authored data, never executable source or neural heldouts. */
import { factorNativeSchema } from "../../llm/nativeNarrativeCodec";
import type { NativeCallSourceContext } from "../../llm/nativeNarrativeCodec";

/** A canonical source-step schema exercises every macro while preserving long CR/LF/Unicode source and all six prior fields. */
export function nativeInputFixture(): { schema: Record<string, any>; sourceData: Record<string, any>; roles: Record<string, unknown> } {
  const completeCode = "function fixture(input) {\r\n  // whole 😀 source, never executed\r  return input;\n}" + "\n// supplied source line".repeat(40);
  const operations = [1, 2, 3].map(ordinal => ({ ordinal, kind: ordinal === 1 ? "loop" : ordinal === 3 ? "return" : "write", code: completeCode + "\n// operation " + ordinal, ...(ordinal === 1 ? { predicateResult: true } : {}) }));
  const prose = () => ({ type: "string", minLength: 1, maxLength: 180, pattern: '^[가-힣][^"\\\\\\x00-\\x1F]{0,179}$' });
  const list = (domain: string) => ({ type: "array", minItems: 3, maxItems: 3, items: operations.map(operation => ({
    type: "array", items: [{ type: domain }, prose(), prose(), prose(), prose()], minItems: 5, maxItems: 5, additionalItems: false,
    description: "이 steps 슬롯의 소스 데이터: " + JSON.stringify({ kind: operation.kind, code: operation.code, ...(Object.hasOwn(operation, "predicateResult") ? { predicateResult: String(operation.predicateResult) } : {}) })
      + ". 현재 구문이 앞 상태를 어떻게 사용하는지 설명합니다. Object fields in order: [\"values\",\"syntax\",\"text\",\"reason\",\"effect\"]."
  })) });
  const literal = JSON.parse('{"raw":{"@": ["S",999]},"sourceStep":912,"__proto__":{"literal":"exact"}}');
  const original = { type: "object", additionalProperties: false, required: ["first", "second", "literal"], properties: { first: list("number"), second: list("boolean"), literal: { const: literal } } };
  const prior = (index: number) => Object.fromEntries(["callId", "role", "inputs", "output", "effects", "reason"].map(field => [field, field === "callId" ? "prior-" + index : "Complete prior " + index + " " + field + ": " + "whole model-written fixture sentence with no clipping. ".repeat(6)]));
  const sourceData = { functionName: "fixture", language: "typescript", fullSource: completeCode, snippets: [{ id: "parent", role: "function", text: completeCode, truncated: false }, { id: "helper", role: "helper", text: completeCode, truncated: false }],
    selectedRoutes: [{ operations }], earlierModelReadings: Array.from({ length: 20 }, (_, index) => prior(index)), confidence: "resolved", unknown: null, flags: [false, true, 0, ""], literal };
  const owned = JSON.parse(JSON.stringify({ schema: original, sourceData, roles: { parent: { role: "function", code: completeCode }, helper: { role: "helper", code: completeCode } } }));
  return { ...owned, schema: factorNativeSchema(owned.schema).schema };
}

/** Full call-source DTO with long independent prior fields and every callee record, never an actual neural prior or meaning oracle. */
export function nativeCallInputFixture(includeSummary = false, emptyTargets = false): NativeCallSourceContext {
  const body = "function parent(input: number) {\r\n" + "  helper(input);\r\n".repeat(20) + "  const a = helper(input);\r\n  return helper(a);\r\n}", helper = "function helper(v: number) { return v; }";
  const earlierModelReadings = Array.from({ length: 20 }, (_, index) => ({ callId: "prior-" + index, role: "Prior fixture purpose " + index + ": " + "complete sentence; ".repeat(20), inputs: "Whole argument transfer " + index + ": " + "input to formal v; ".repeat(20), output: "Prior fixture return " + index + ": " + "complete sentence; ".repeat(20), effects: "Prior fixture effects " + index + ": " + "complete sentence; ".repeat(20), reason: "Prior fixture reaching " + index + ": " + "complete sentence; ".repeat(20) }));
  const targets = emptyTargets ? [] : ["input", "a"].map((argument, index) => ({ callId: "current-" + index, caller: "parent", callee: "helper", language: "typescript", expression: "helper(" + argument + ")", relation: "call" as const, confidence: "exact" as const, guards: [], loops: [], deferred: false, arguments: [argument], parameters: [{ name: "v", type: "number" }], sourceLimited: false, callerSnippet: body, calleeSnippet: helper }));
  return { functionName: "parent", language: "typescript", limited: false,
    snippets: [{ id: "parent", role: "function", startLine: 2, endLine: 26, text: body, truncated: false }, { id: "helper", role: "helper", startLine: 40, endLine: 40, text: helper, truncated: false }],
    callTask: { scope: "overview", signature: "complete source signature ".repeat(30), includeSummary, sequence: [...earlierModelReadings.map(call => ({ callId: call.callId, expression: "helper(input)", callee: "helper", deferred: false })), ...targets.map(target => ({ callId: target.callId, expression: target.expression, callee: target.callee, deferred: false }))], conditions: [], routeStatus: "structure", sourceLimited: false, targets, earlierModelReadings,
      calleeEvidence: [...earlierModelReadings.map(call => ({ callId: call.callId, callee: "helper", code: helper, truncated: false })), ...targets.map(target => ({ callId: target.callId, callee: target.callee, code: helper, truncated: false }))] } };
}
