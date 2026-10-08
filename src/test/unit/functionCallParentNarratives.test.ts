/** Real parser/Host regressions for caller reads, source route assumptions, mutation boundaries and cache/evidence ownership. */
import assert from "node:assert/strict";
import test from "node:test";
import { FunctionCallsHostDelivery } from "../../webview/functionCalls";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow";
import { exampleFunctionCallScenarios } from "../../shared/functionCalls";
import { buildSourceFunctionNarrativeResponse } from "../../application/functionNarratives";
import { createFunctionCallSourceReader, readFunctionCallSourceExpression } from "../../analyzer/functionCalls";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { loadFunctionCallReadingFixture, functionCallReadingReply } from "./helpers/functionCallReadingFixture";
import type { FunctionCallNarrativesRequest, FunctionCallNarrativesResponse } from "../../protocol/functionCallNarratives";
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

/** Named source types provide declaration labels; fixture values and getter bodies are never executed. */
function sourceFixture(language: "typescript" | "kotlin", body: string) {
  return (name: string) => name === "reading" ? language === "kotlin"
    ? `fun checkout(amount: Payload): Int {\n ${body}\n}`
    : `import { addFee, type Payload } from "./readingHelpers";\nexport function checkout(amount: Payload): number {\n ${body}\n}`
    : language === "kotlin" ? "data class Payload(val bias: Int)\nfun addFee(value: Int): Int { return value + 5 }"
      : "export interface Payload { bias: number }\nexport function addFee(value: number): number { return value + 5; }";
}

/** The only test double is the external model reply; all syntax, graph, protocol, cache and source controls are real. */
async function harness(language: "typescript" | "kotlin", locale: "ko" | "en", body: string) {
  const fixture = await loadFunctionCallReadingFixture(language, sourceFixture(language, body));
  const graphDelivery = new WebviewGraphDelivery(), graphVersion = graphDelivery.activate(fixture.graph).snapshot.version;
  const sourceNodeTokens = new SourceNodeTokenRegistry(), evidenceTokens = new CodeFlowEvidenceTokenRegistry();
  sourceNodeTokens.activate(graphVersion, fixture.graph); evidenceTokens.activate(graphVersion, fixture.graph);
  const loaded: FunctionCallsResponse[] = [], replies: FunctionCallNarrativesResponse[] = [], contexts: FunctionNarrativeContext[] = [];
  let models = 0;
  const host = new FunctionCallsHostDelivery({ graphDelivery, sourceNodeTokens, evidenceTokens, getLanguage: () => locale,
    readSourceText: async path => fixture.files.find(file => file.path === path)?.content,
    postMessage: async reply => { loaded.push(reply); }, postNarratives: async reply => { replies.push(reply); },
    provider: { generate: async (context, language) => {
      contexts.push(context); const source = buildSourceFunctionNarrativeResponse(context, language);
      if (source) return source;
      models++; return functionCallReadingReply(context, language);
    } } });
  const request = { graphVersion, sourceToken: sourceNodeTokens.createToken(fixture.root.id)!, requestId: 1 };
  await host.load(request); const slice = loaded.at(-1)!;
  const explanation: FunctionCallNarrativesRequest = { ...request, contextId: slice.narratives!.contextId!, scope: "overview" };
  return { ...fixture, host, slice, explanation, replies, contexts, evidenceTokens, models: () => models };
}

test("caller property conditions and arguments retain both assumed branches, zero-call exits, complete fields and cache without model generation", async () => {
  for (const language of ["typescript", "kotlin"] as const) for (const locale of ["ko", "en"] as const) {
    const h = await harness(language, locale, "if (amount.bias < 0) return 0;\n return addFee(amount.bias + 1);");
    try {
      const examples = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])));
      assert.deepEqual(examples.map(example => example.trace.callIds.length).sort(), [0, 1]);
      const requests: FunctionCallNarrativesRequest[] = [h.explanation,
        { ...h.explanation, scope: "call", requestId: 2, connectionId: h.slice.connections[0].id },
        ...examples.map((example, index) => ({ ...h.explanation, scope: "scenario" as const, requestId: index + 3,
          choices: [...example.selection].map(([key, value]) => ({ key, value })) }))];
      const sliceBefore = JSON.stringify(h.slice);
      for (const request of requests) {
        await h.host.explain(request);
        const reply = h.replies.at(-1)!;
        assert.equal(reply.status, "ready"); assert.equal(reply.coverage!.complete, true);
        assert.equal(h.models(), 0, `${language} ${locale} ${request.scope}`);
        assert.equal(JSON.stringify(h.slice), sliceBefore, "source reading cannot change dispatch, control or graph identity");
        const flow = reply.narrative!.flow!;
        assert.match(flow, /getter.*상태\/효과 미확인.*정상 완료 가정|values\/operators\/getters\/dispatch\/state\/effects unknown; normal completion assumed|values\/operators\/getters\/state\/effects unknown; assume normal completion/u);
        assert.doesNotMatch(flow, /금액|수수료|결제|bias = -1|bias = 0|validated|\bfee\b|\bmoney\b/u);
        if (request.scope === "overview") {
          assert.match(flow, /amount\.bias < 0.*true.*반환식 `0`|amount\.bias < 0.*true.*Return expression `0`/su);
          assert.match(flow, /amount\.bias < 0.*false.*amount\.bias \+ 1.*value \+ 5/su);
        }
        for (const call of reply.narrative!.calls) {
          assert.match(call.inputs, /`amount\.bias \+ 1` → `value`/u);
          assert.match(call.output, /정상 완료 가정|Assuming normal completion/u);
          assert.match(call.effects, /호출부 읽기.*amount\.bias \+ 1.*getter.*대상: 명시적 쓰기|Caller reads.*amount\.bias \+ 1.*getters.*Callee: no explicit writes/u);
          assert.ok(h.evidenceTokens.resolve(call.callerEvidence!) && h.evidenceTokens.resolve(call.calleeEvidence!));
          for (const field of ["role", "inputs", "output", "effects", "reason"] as const) assert.ok(call[field].length);
        }
        await h.host.explain({ ...request, requestId: request.requestId + 20, pageIndex: 0, pageLanguage: locale });
        assert.equal(h.replies.at(-1)!.cacheHit, true); assert.equal(h.replies.at(-1)!.narrative!.flow, flow); assert.equal(h.models(), 0);
      }
    } finally { h.host.reset(); }
  }
});

test("caller operands retain captured/reference and repeated read syntax without reusing getter results or acquiring primitive authority", async () => {
  assert.equal(readFunctionCallSourceExpression("amount.bias + 1", new Set(["amount"])), undefined);
  for (const language of ["typescript", "kotlin"] as const) {
    for (const argument of ["ambient", "amount.bias + amount.bias", "external.bias + 1"]) {
      const h = await harness(language, "ko", `return addFee(${argument});`);
      try {
        const callee = h.graph.nodes.find(node => node.name === "addFee")!, source = h.files[1].content;
        const site = analyzeFunctionLogic({ functionNode: h.root, sourceText: h.source }).callsites[0];
        const facts = createFunctionCallSourceReader(h.root, h.source).read(callee, source, site.range, `addFee(${argument})`)!;
        assert.deepEqual(facts.callerReads!.expressions, [argument]);
        if (argument === "ambient") assert.ok(facts.callerReads!.externalReads.includes("ambient"));
        if (argument.includes("amount.bias")) assert.deepEqual(facts.callerReads!.accesses, ["amount.bias", "amount.bias"]);
        await h.host.explain(h.explanation);
        assert.equal(h.replies.at(-1)!.status, "ready"); assert.equal(h.models(), 0);
        assert.ok(h.replies.at(-1)!.narrative!.flow!.includes(argument));
        assert.ok(h.replies.at(-1)!.narrative!.calls[0].effects.includes(argument));
      } finally { h.host.reset(); }
    }
  }
});

test("parent local reads and changes remain source-ordered, common prefixes are factored only by source identity, and both returns survive", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const keyword = language === "kotlin" ? "var" : "let";
    for (const body of [`${keyword} n = amount.bias; n += 1; return addFee(n);`,
      `${keyword} n = amount.bias; n += 1; if (n < 0) return 0; return addFee(n);`,
      `${keyword} n = ambient; n += 1; n += 1; return addFee(n);`]) {
      const h = await harness(language, "ko", body);
      try {
        await h.host.explain(h.explanation);
        const reply = h.replies.at(-1)!; assert.equal(reply.status, "ready"); assert.equal(h.models(), 0, body);
        const flow = reply.narrative!.flow!;
        assert.match(flow, /n = (?:amount\.bias|ambient).*n \+= 1.*addFee\(n\)/su);
        assert.match(flow, /getter.*상태\/효과 미확인/u);
        if (body.includes("if")) {
          assert.equal(flow.match(/n = amount\.bias/gu)?.length, 1, "one identical prefix source statement is shown once");
          assert.match(flow, /n < 0.*true.*`0`.*false.*addFee\(n\)/su);
        } else if (body.includes("ambient")) assert.equal(flow.match(/`n \+= 1`/gu)?.length, 2, "equal text at distinct source statements is not deduplicated");
      } finally { h.host.reset(); }
    }
  }
});

test("caller read support rejects optional/computed access, hidden calls/writes, cycles and parameter/captured/member/immutable writes", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const immutable = language === "kotlin" ? "val" : "const";
    for (const body of ["return addFee(amount?.bias);", "return addFee(amount[getter()]);", "return addFee(load(amount));",
      "return addFee(amount.bias++);", "amount.bias = 3; return addFee(amount.bias);", "ambient += 1; return addFee(ambient);",
      "amount += 1; return addFee(amount);", `${immutable} n = amount.bias; n += 1; return addFee(n);`,
      "while (amount.bias > 0) { audit(amount.bias); } return addFee(amount.bias);"]) {
      const h = await harness(language, "en", body);
      try {
        await h.host.explain(h.explanation); assert.equal(h.models(), 1, `${language}: ${body}`);
        assert.equal(h.replies.at(-1)!.status, "ready");
      } finally { h.host.reset(); }
    }
  }
});
