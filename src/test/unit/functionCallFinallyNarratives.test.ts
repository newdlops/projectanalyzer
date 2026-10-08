/** Real parser/Host fixtures prove saved-return cleanup ordering and conservative fallbacks without executing supplied source. */
import assert from "node:assert/strict";
import test from "node:test";
import { FunctionCallsHostDelivery } from "../../webview/functionCalls";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow";
import { exampleFunctionCallScenarios } from "../../shared/functionCalls";
import { buildSourceFunctionNarrativeResponse } from "../../application/functionNarratives";
import { createFunctionCallSourceReader } from "../../analyzer/functionCalls";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { loadFunctionCallReadingFixture, functionCallReadingReply } from "./helpers/functionCallReadingFixture";
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionCallNarrativesRequest, FunctionCallNarrativesResponse } from "../../protocol/functionCallNarratives";

/** The production protocol owns source/evidence IDs; only an explicitly counted fallback model is substituted. */
async function harness(language: "typescript" | "kotlin", locale: "ko" | "en", body?: string) {
  const caller = language === "kotlin" ? "fun checkout(amount: Int): Int { return addFee(amount) }"
    : 'import { addFee } from "./readingHelpers";\nexport function checkout(amount: number): number { return addFee(amount); }';
  const helper = (language === "kotlin" ? "fun addFee(value: Int): Int { " : "export function addFee(value: number): number { ")
    + (body ?? (language === "kotlin" ? "try { return value + 5 } finally { audit(value) }" : "try { return value + 5; } finally { audit(value); }")) + " }";
  const fixture = await loadFunctionCallReadingFixture(language, name => name === "reading" ? caller : helper);
  const graphDelivery = new WebviewGraphDelivery(), graphVersion = graphDelivery.activate(fixture.graph).snapshot.version;
  const sourceNodeTokens = new SourceNodeTokenRegistry(), evidenceTokens = new CodeFlowEvidenceTokenRegistry();
  sourceNodeTokens.activate(graphVersion, fixture.graph); evidenceTokens.activate(graphVersion, fixture.graph);
  const loaded: FunctionCallsResponse[] = [], replies: FunctionCallNarrativesResponse[] = [];
  let models = 0;
  const host = new FunctionCallsHostDelivery({ graphDelivery, sourceNodeTokens, evidenceTokens, getLanguage: () => locale,
    readSourceText: async path => fixture.files.find(file => file.path === path)?.content,
    postMessage: async reply => { loaded.push(reply); }, postNarratives: async reply => { replies.push(reply); },
    provider: { generate: async (context, language) => {
      const source = buildSourceFunctionNarrativeResponse(context, language);
      if (source) return source; models++; return functionCallReadingReply(context, language);
    } } });
  const request = { graphVersion, sourceToken: sourceNodeTokens.createToken(fixture.root.id)!, requestId: 1 };
  await host.load(request); const slice = loaded.at(-1)!;
  const explanation: FunctionCallNarrativesRequest = { ...request, contextId: slice.narratives!.contextId!, scope: "overview" };
  const facts = () => {
    const site = analyzeFunctionLogic({ functionNode: fixture.root, sourceText: fixture.source }).callsites[0];
    return createFunctionCallSourceReader(fixture.root, fixture.source).read(fixture.graph.nodes.find(node => node.name === "addFee")!, helper, site.range, "addFee(amount)");
  };
  return { ...fixture, host, slice, replies, explanation, evidenceTokens, facts, models: () => models };
}

test("plain TS/Kotlin try-return cleanup preserves saved expression, normal-return condition, unknown effects, five fields and cache in every scope/locale", async () => {
  for (const language of ["typescript", "kotlin"] as const) for (const locale of ["ko", "en"] as const) {
    const h = await harness(language, locale);
    try {
      const facts = h.facts(); assert.ok(facts?.finalizers); assert.ok(facts.bodyPaths);
      assert.equal(facts.returnExpression, "value + 5"); assert.equal(facts.finalizers[0].source, "audit(value)");
      const before = JSON.stringify(h.slice), example = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])))[0];
      const requests: FunctionCallNarrativesRequest[] = [h.explanation,
        { ...h.explanation, requestId: 2, scope: "call", connectionId: h.slice.connections[0].id },
        { ...h.explanation, requestId: 3, scope: "scenario", choices: [...example.selection].map(([key, value]) => ({ key, value })) }];
      for (const request of requests) {
        await h.host.explain(request); const reply = h.replies.at(-1)!;
        assert.equal(reply.status, "ready"); assert.equal(reply.coverage!.complete, true);
        assert.equal(h.models(), 0, `${language}/${locale}/${request.scope}`);
        const call = reply.narrative!.calls[0];
        for (const key of ["role", "inputs", "output", "effects", "reason"] as const) assert.ok(call[key]);
        assert.ok(call.inputs.includes("`amount` → `value`"));
        assert.match(call.output, /finally/u); assert.match(call.output, /정상|normally/u); assert.match(call.output, /미확인|unknown/u);
        assert.ok(call.output.includes("value + 5")); assert.ok(call.effects.includes("audit(value)"));
        assert.match(call.effects, /예외|throws/u);
        assert.doesNotMatch(JSON.stringify(reply.narrative), /요금|감사 로그|fee calculation|audit log/iu);
        const flow = reply.narrative!.flow!;
        assert.ok(flow.indexOf("value + 5") < flow.indexOf("audit(value)"));
        assert.match(flow, /보관 결과|saved result/u);
        assert.equal(JSON.stringify(h.slice), before, "cleanup reading cannot repair or upgrade the simplified graph");
        assert.ok(h.evidenceTokens.resolve(call.callerEvidence!) && h.evidenceTokens.resolve(call.calleeEvidence!));
        await h.host.explain({ ...request, requestId: request.requestId + 20, pageIndex: 0, pageLanguage: locale });
        assert.equal(h.replies.at(-1)!.cacheHit, true); assert.equal(h.models(), 0);
      }
    } finally { h.host.reset(); }
  }
});

test("cleanup preserves two equal-text source occurrences and can never become a primitive leaf", async () => {
  for (const language of ["typescript", "kotlin"] as const) for (const locale of ["ko", "en"] as const) {
    const h = await harness(language, locale, "try { return value + 5; } finally { audit(value); audit(value); }");
    try {
      const facts = h.facts(); assert.ok(facts?.finalizers); assert.equal(facts.finalizers.length, 2);
      assert.notEqual(facts.finalizers[0].key, facts.finalizers[1].key);
      assert.ok(facts.bodyPaths, "return-only projection must not grant legacy leaf authority");
      await h.host.explain(h.explanation); assert.equal(h.models(), 0);
      assert.equal((h.replies.at(-1)!.narrative!.calls[0].effects.match(/audit\(value\)/gu) ?? []).length, 2);
    } finally { h.host.reset(); }
  }
});

test("catch, return override, throws, writes, nested control, missing work and unsupported cleanup syntax retain model fallback", async () => {
  const bodies = [
    "try { return value + 5; } catch (error) { return 0; } finally { audit(value); }",
    "try { return value + 5; } finally { return 0; }",
    "try { return value + 5; } finally { throw value; }",
    "try { return value + 5; } finally { value += 1; }",
    "try { return value + 5; } finally { service.value = value; }",
    "audit(value); try { return value + 5; } finally { audit(value); }",
    "try { const n = value + 5; return n; } finally { audit(value); }",
    "try { if (value > 0) return value; return 0; } finally { audit(value); }",
    "try { return other(value); } finally { audit(value); }",
    "try { return value + 5; } finally { audit(value); audit(value); audit(value); }",
    "try { try { return value; } finally { audit(value); } } finally { audit(value); }",
    "try { return value + 5; } finally {}",
    "try { return value + 5; } finally { audit(() => value); }",
    "try { return value + 5; } finally { audit(value[0]); }",
    "try { return value + 5; } finally { audit(other(value)); }",
    "try { return shared + 5; } finally { audit(value); }",
    "try { return value + 5; } finally { service.audit(value); }"
  ];
  for (const language of ["typescript", "kotlin"] as const) for (const body of bodies) {
    // Grammar-owned Kotlin catch requires its explicit type. Other invalid
    // language syntax is intentionally retained as a recovery rejection case.
    const source = language === "kotlin" ? body.replace("catch (error)", "catch (error: Exception)").replace("const n", "val n") : body;
    const h = await harness(language, "en", source);
    try { assert.equal(h.facts(), undefined, `${language}: ${source}`); }
    finally { h.host.reset(); }
  }
});
