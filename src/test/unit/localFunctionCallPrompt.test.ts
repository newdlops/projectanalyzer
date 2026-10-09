/** One flat local output blueprint with complete source data and Host-owned typed argument transfer. */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";
import { createLocalNarrativeWire } from "../../llm/functionNarratives/localWire";
import { buildLocalNarrativePrompt } from "../../llm/functionNarratives/localPrompt";
import { buildFunctionCallNarrativePrompt } from "../../application/functionCallNarratives";
import { createFunctionCallNarrativeSchema, getFunctionCallFixedInputs } from "../../shared/functionCallNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

test("a local call gets one flat wire blueprint, all original source data and five restored detail fields", () => {
  for (const language of ["ko", "en"] as const) {
    const context: FunctionNarrativeContext = { functionName: "inspect", language: "typescript", limited: false,
      snippets: [{ id: "callee", role: "helper", startLine: 1, endLine: 4, truncated: false,
        text: "function adjust(value: number) { const n = value + 5; audit(n); return n + 3; }" }],
      callTask: { scope: "call", signature: "public", includeSummary: true, sequence: [], conditions: [], routeStatus: "structure", sourceLimited: false,
        targets: [{ callId: "call-1", caller: "inspect", callee: "adjust", language: "typescript", expression: "adjust(amount)", relation: "call", confidence: "inferred",
          guards: [], loops: [], deferred: false, sourceLimited: false, arguments: ["amount"], parameters: [{ name: "value", type: "number" }] }] } };
    const schema = createLocalNarrativeSchema(context, language), wire = createLocalNarrativeWire(schema), before = JSON.stringify(wire.schema);
    const [neutral, data] = buildFunctionCallNarrativePrompt(context, language), prompt = buildLocalNarrativePrompt(context, language, wire.schema);
    const [instructions, source] = prompt.split("\nSOURCE DATA:\n");
    assert.equal(source, data); assert.equal(prompt.match(/JSON schema:/gu)?.length, 1);
    assert.doesNotMatch(prompt, /OUTPUT JSON SCHEMA:|"\$ref"|"\$defs"/u);
    assert.equal(instructions.split("\nJSON schema:\n")[1].split("\n")[0], before);
    assert.ok(neutral.endsWith(JSON.stringify(createFunctionCallNarrativeSchema(context.callTask!, language))));
    assert.equal(JSON.stringify(wire.schema), before);
    assert.ok(prompt.includes("audit(n)")); assert.ok(prompt.includes("n + 3"));
    const payload = { summary: "Purpose.", flow: "Flow.", calls: [{ role: "Role.", output: "Return.", effects: "Unknown." }], limitations: [] };
    const decoded = JSON.parse(wire.decode(JSON.stringify(payload)));
    assert.equal(decoded.calls[0].inputs, getFunctionCallFixedInputs(context.callTask!.targets[0], language));
    assert.match(decoded.calls[0].inputs, /`amount` → `value` \(number\)/u);
    assert.equal(Object.keys(decoded.calls[0]).length, 6);
    assert.equal(decoded.calls[0].callId, "call-1");
    assert.throws(() => wire.decode(JSON.stringify({ ...payload, calls: [{ ...payload.calls[0], inputs: "wrong", callId: "foreign" }] })), /invalid-response/u);
  }
});

test("unknown, ambiguous and over-budget parameter transfers stay unmanufactured while empty lists remain fixed", () => {
  const target = { callId: "call-1", caller: "inspect", callee: "adjust", language: "typescript", expression: "adjust(amount)", relation: "call" as const,
    confidence: "exact" as const, guards: [], loops: [], deferred: false, sourceLimited: false, arguments: ["amount"] };
  assert.equal(getFunctionCallFixedInputs(target, "en"), undefined);
  assert.equal(getFunctionCallFixedInputs({ ...target, parameters: [] }, "en"), undefined);
  assert.equal(getFunctionCallFixedInputs({ ...target, arguments: ["x".repeat(160)], parameters: [{ name: "value", type: "number" }] }, "en"), undefined);
  assert.equal(getFunctionCallFixedInputs({ ...target, arguments: ['"\u0000"'], parameters: [{ name: "value", type: "string" }] }, "en"), undefined);
  assert.equal(getFunctionCallFixedInputs({ ...target, arguments: [], parameters: [] }, "en"), "No arguments are passed explicitly.");
});
