/** Production-parser callee branch/local worksheets, external-model boundaries and source navigation integration. */
import assert from "node:assert/strict";
import test from "node:test";
import { FunctionCallsHostDelivery } from "../../webview/functionCalls";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow";
import { exampleFunctionCallScenarios } from "../../shared/functionCalls";
import { buildSourceFunctionNarrativeResponse, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import { createFunctionCallSourceReader } from "../../analyzer/functionCalls";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { loadFunctionCallReadingFixture, functionCallReadingReply } from "./helpers/functionCallReadingFixture";
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionCallNarrativesResponse, FunctionCallNarrativesRequest } from "../../protocol/functionCallNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

/** One cross-file helper deliberately has richer internals than the parent's single source call. */
function fixtureSource(language: "typescript" | "kotlin", name: string, source: string, body: string): string {
  if (name === "reading") return language === "kotlin" ? "fun checkout(amount: Int): Int { return addFee(amount) }"
    : 'import { addFee } from "./readingHelpers";\nexport function checkout(amount: number): number { return addFee(amount); }';
  return source.replace(language === "kotlin" ? "return value + 5" : "return value + 5;", body);
}

/** Uses actual graph/source authorities and model dispatch; only the external model reply is a named test double. */
async function harness(language: "typescript" | "kotlin", locale: "en" | "ko", body: string,
  transform?: (name: string, source: string) => string) {
  const fixture = await loadFunctionCallReadingFixture(language, transform ?? ((name, source) => fixtureSource(language, name, source, body)));
  const graphDelivery = new WebviewGraphDelivery(), graphVersion = graphDelivery.activate(fixture.graph).snapshot.version;
  const sourceNodeTokens = new SourceNodeTokenRegistry(), evidenceTokens = new CodeFlowEvidenceTokenRegistry();
  sourceNodeTokens.activate(graphVersion, fixture.graph); evidenceTokens.activate(graphVersion, fixture.graph);
  const staticReplies: FunctionCallsResponse[] = [], replies: FunctionCallNarrativesResponse[] = [], contexts: FunctionNarrativeContext[] = [];
  let models = 0;
  const provider: FunctionNarrativeProvider = { async generate(context, language) {
    contexts.push(context); const source = buildSourceFunctionNarrativeResponse(context, language);
    if (source) return source;
    models++; return functionCallReadingReply(context, language);
  } };
  const delivery = new FunctionCallsHostDelivery({ graphDelivery, sourceNodeTokens, evidenceTokens, provider, getLanguage: () => locale,
    async readSourceText(file) { return fixture.files.find(candidate => candidate.path === file)?.content; },
    async postMessage(reply) { staticReplies.push(reply); }, async postNarratives(reply) { replies.push(reply); } });
  const request = { graphVersion, sourceToken: sourceNodeTokens.createToken(fixture.root.id)!, requestId: 1 };
  await delivery.load(request); const slice = staticReplies.at(-1)!;
  const explanation: FunctionCallNarrativesRequest = { ...request, contextId: slice.narratives!.contextId!, scope: "overview" };
  return { ...fixture, slice, delivery, replies, contexts, explanation, evidenceTokens, models: () => models };
}

for (const language of ["typescript", "kotlin"] as const) for (const locale of ["en", "ko"] as const) {
  test(`${language} ${locale} callee worksheets retain every local calculation, guard, alternative return and source control`, async () => {
    const keyword = language === "kotlin" ? "var" : "let";
    const h = await harness(language, locale, `${keyword} n = value + 5; if (n < 0) return 0; n *= 2; return n + 3;`);
    try {
      const example = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])))[0];
      const requests: FunctionCallNarrativesRequest[] = [h.explanation,
        { ...h.explanation, scope: "call", connectionId: h.slice.connections[0].id, requestId: 2 },
        { ...h.explanation, scope: "scenario", choices: [...example.selection].map(([key, value]) => ({ key, value })), requestId: 3 }];
      for (const request of requests) {
        await h.delivery.explain(request);
        const reply = h.replies.at(-1)!; assert.equal(reply.status, "ready"); assert.equal(reply.coverage!.complete, true);
        assert.equal(reply.modelName, locale === "ko" ? "소스 분석" : "Source analysis");
        const call = reply.narrative!.calls[0], flow = reply.narrative!.flow!;
        assert.match(call.inputs, /`amount` → `value`/u); assert.match(call.inputs, language === "kotlin" ? /\(Int\)/u : /\(number\)/u);
        assert.match(call.role, /`n < 0` = true → `0`/u); assert.match(call.role, /`n < 0` = false → `n \+ 3`/u);
        assert.match(call.effects, new RegExp("`" + keyword + " n = value \\+ 5`", "u"));
        assert.match(call.effects, /`n < 0` = false: `n \*= 2`/u);
        assert.match(flow, /n = value \+ 5.*n < 0.*true.*`0`.*false.*n \*= 2.*n \+ 3/su);
        assert.match(call.output, locale === "ko" ? /부모 함수의 반환값/u : /directly from the parent/u);
        assert.ok(h.evidenceTokens.resolve(call.callerEvidence!)); assert.ok(h.evidenceTokens.resolve(call.calleeEvidence!));
        await h.delivery.explain({ ...request, requestId: request.requestId + 10, pageIndex: 0, pageLanguage: locale });
        assert.equal(h.replies.at(-1)!.cacheHit, true); assert.equal(h.replies.at(-1)!.narrative!.flow, flow);
      }
      assert.equal(h.models(), 0); assert.equal(h.contexts.length, 3);
    } finally { h.delivery.reset(); }
  });
}

test("callee source paths preserve distinct repeated updates and do not turn local writes into a write-free claim", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const h = await harness(language, "en", `${language === "kotlin" ? "var" : "let"} n = value; n += 1; n += 1; return n;`);
    try {
      await h.delivery.explain(h.explanation);
      const reply = h.replies.at(-1)!; assert.equal(h.models(), 0);
      assert.equal(reply.narrative!.calls[0].effects.match(/`n \+= 1`/gu)?.length, 2);
      assert.equal(reply.narrative!.flow!.match(/`n \+= 1`/gu)?.length, 2);
      assert.doesNotMatch(reply.narrative!.calls[0].effects, /no writes or explicit calls beyond/u);
    } finally { h.delivery.reset(); }
  }
});

test("unproved external work, cycles, implicit returns, parameter/immutable writes and body/prose limits retain model analysis", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const keyword = language === "kotlin" ? "var" : "let", immutable = language === "kotlin" ? "val" : "const";
    const invalid = ["audit(value); return value;", "return captured;", "return value.member;", "value += 1; return value;",
      `${immutable} n = value; n += 1; return n;`, `${keyword} n = value; while (n > 0) n -= 1; return n;`,
      "if (value < 0) return 0;", "return value; audit(value);",
      `${keyword} n = value; ${Array.from({ length: 34 }, () => "n += 1;").join(" ")} return n;`];
    if (language === "kotlin") invalid.push('return "${value++}";');
    for (const body of invalid) {
      const h = await harness(language, "en", body);
      try {
        await h.delivery.explain(h.explanation); assert.equal(h.models(), 1, body);
        assert.equal(h.replies.at(-1)!.status, "ready");
      } finally { h.delivery.reset(); }
    }
    // A complete path proof can still exceed the fixed prose limit. Every
    // operation must remain; falling back is preferable to silently truncating it.
    const h = await harness(language, "en", `${keyword} n = value; ${Array.from({ length: 12 }, () => "n += 1;").join(" ")} return n;`);
    try { await h.delivery.explain(h.explanation); assert.equal(h.models(), 1); }
    finally { h.delivery.reset(); }
  }
});

test("closed callee proof covers both early-return arms and immutable local initialization independently of prose", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const fixture = await loadFunctionCallReadingFixture(language), callee = fixture.graph.nodes.find(node => node.name === "addFee")!;
    const source = fixture.files[1].content, returned = language === "kotlin" ? "return value + 5" : "return value + 5;";
    const site = analyzeFunctionLogic({ functionNode: fixture.root, sourceText: fixture.source }).callsites.find(site => site.calleeName === "addFee")!;
    const reader = createFunctionCallSourceReader(fixture.root, fixture.source);
    const local = reader.read(callee, source.replace(returned, `${language === "kotlin" ? "val" : "const"} n = value + 5; return n;`), site.range, "addFee(amount)")!;
    assert.equal(local.bodyPaths!.length, 1); assert.deepEqual(local.bodyPaths![0].map(step => step.kind), ["change", "return"]);
    const guarded = reader.read(callee, source.replace(returned, "if (value < 0) return 0; return value + 5;"), site.range, "addFee(amount)")!;
    assert.equal(guarded.bodyPaths!.length, 2);
    assert.deepEqual(guarded.bodyPaths!.map(path => path.filter(step => step.kind === "condition").map(step => step.outcome)), [["true"], ["false"]]);
    assert.deepEqual(guarded.bodyPaths!.map(path => path.at(-1)!.source), ["0", "value + 5"]);
    assert.equal(createFunctionCallSourceReader(fixture.root, fixture.source, { maxCalleeDepth: 3 })
      .read(callee, source.replace(returned, "if (value < 0) return 0; return value + 5;"), site.range, "addFee(amount)"), undefined);
  }
});

test("certified cross-batch summaries retain an extended callee's local calculation and every call page", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const serial = language === "kotlin" ? "fun checkout(amount: Int): Int { val a = addFee(amount); val b = double(a); return addFee(b) }"
      : 'import { addFee, double } from "./readingHelpers";\nexport function checkout(amount: number): number { const a = addFee(amount); const b = double(a); return addFee(b); }';
    const local = language === "kotlin" ? "val n = value * 2; return n" : "const n = value * 2; return n;";
    const h = await harness(language, "en", "", (name, source) => name === "reading" ? serial
      : source.replace(language === "kotlin" ? "return value * 2" : "return value * 2;", local));
    try {
      await h.delivery.explain(h.explanation); assert.equal(h.models(), 0); assert.equal(h.contexts.length, 3);
      const reply = h.replies.at(-1)!; assert.equal(reply.coverage!.completed, 3); assert.equal(reply.page!.count, 2);
      const flow = reply.narrative!.flow!; assert.match(flow, /n = value \* 2.*return `n`.*local `b`/u);
      const calls = [];
      for (let pageIndex = 0; pageIndex < 2; pageIndex++) {
        await h.delivery.explain({ ...h.explanation, requestId: pageIndex + 2, pageIndex, pageLanguage: "en" });
        assert.equal(h.replies.at(-1)!.cacheHit, true); assert.equal(h.replies.at(-1)!.narrative!.flow, flow);
        calls.push(...h.replies.at(-1)!.narrative!.calls);
      }
      assert.equal(calls.length, 3); assert.match(calls[1].effects, /n = value \* 2/u);
      assert.ok(calls.every(call => h.evidenceTokens.resolve(call.callerEvidence!) && h.evidenceTokens.resolve(call.calleeEvidence!)));
    } finally { h.delivery.reset(); }
  }
});
