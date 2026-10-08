/** Real class-method source readings preserve dispatch uncertainty and never grant concrete receiver/evaluator authority. */
import assert from "node:assert/strict";
import test from "node:test";
import { FunctionCallsHostDelivery } from "../../webview/functionCalls";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow";
import { exampleFunctionCallScenarios } from "../../shared/functionCalls";
import { buildSourceFunctionNarrativeResponse } from "../../application/functionNarratives";
import { createFunctionCallSourceReader, readFunctionCallSourceParameters, readFunctionCallSourceDeclaredParameters } from "../../analyzer/functionCalls";
import { readFunctionCallSourceExpression, readFunctionCallSourceObjectExpression } from "../../analyzer/functionCalls/sourceSyntax";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { analyzeFunctionTutorDeclaration } from "../../analyzer/functionTutor";
import { loadFunctionCallReadingFixture, functionCallReadingReply } from "./helpers/functionCallReadingFixture";
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionCallNarrativesRequest, FunctionCallNarrativesResponse } from "../../protocol/functionCallNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

/** The receiver is an input reference; class field initializers never become observed receiver values. */
function sources(language: "typescript" | "kotlin", body: string, methodRoot = false) {
  return (name: string) => name === "reading" ? methodRoot ? language === "kotlin"
    ? `class Runner(val bias: Int) { fun checkout(amount: Int): Int { return this.addFee(amount) } fun addFee(value: Int): Int { ${body} } }`
    : `export class Runner { bias: number = 5; checkout(amount: number): number { return this.addFee(amount); } addFee(value: number): number { ${body} } }`
    : language === "kotlin" ? "fun checkout(service: MathOps, amount: Int): Int { return service.addFee(amount) }"
      : 'import { type MathOps } from "./readingHelpers";\nexport function checkout(service: MathOps, amount: number): number { return service.addFee(amount); }'
    : methodRoot ? "// No additional callees." : language === "kotlin"
      ? `class MathOps(val bias: Int) { fun addFee(value: Int): Int { ${body} } }`
      : `export class MathOps { bias: number = 5; addFee(value: number): number { ${body} } }`;
}

/** Only the external reply is a model fixture; parser, graph, source tokens, dispatch metadata and cache use the production pipeline. */
async function harness(language: "typescript" | "kotlin", locale: "ko" | "en", body: string, methodRoot = false, headerExtent = false) {
  const fixture = await loadFunctionCallReadingFixture(language, sources(language, body, methodRoot));
  if (headerExtent) for (const node of fixture.graph.nodes.filter(node => node.kind === "method")) {
    // Native symbols retain the declaration anchor but may stop at its header.
    node.range = { ...node.range, endLine: node.selectionRange.startLine, endCharacter: node.selectionRange.endCharacter };
  }
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
  return { ...fixture, host, slice, replies, contexts, explanation, evidenceTokens, models: () => models };
}

test("candidate TS/Kotlin methods preserve original receiver/return syntax, formal transfers, all fields and conditional dispatch across scopes/locales", async () => {
  for (const language of ["typescript", "kotlin"] as const) for (const locale of ["ko", "en"] as const) {
    const h = await harness(language, locale, "return this.bias + value;");
    try {
      const before = JSON.stringify(h.slice), example = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])))[0];
      const requests: FunctionCallNarrativesRequest[] = [h.explanation,
        { ...h.explanation, requestId: 2, scope: "call", connectionId: h.slice.connections[0].id },
        { ...h.explanation, requestId: 3, scope: "scenario", choices: [...example.selection].map(([key, value]) => ({ key, value })) }];
      for (const request of requests) {
        await h.host.explain(request);
        const reply = h.replies.at(-1)!, call = reply.narrative!.calls[0], flow = reply.narrative!.flow!;
        assert.equal(reply.status, "ready"); assert.equal(reply.coverage!.complete, true); assert.equal(h.models(), 0, `${language} ${locale} ${request.scope}`);
        assert.equal(JSON.stringify(h.slice), before, "candidate source does not upgrade graph confidence or resolve runtime dispatch");
        assert.match(call.inputs, /이 후보가 실제 대상이라면|If this candidate is selected/u);
        assert.match(call.inputs, /`amount` → `value`/u);
        assert.match(call.role, /추정 대상의 원문|Candidate source/u);
        assert.match(call.output, /이 후보가 실제 대상이라면|If this candidate is selected/u);
        assert.match(call.effects, /수신자.*getter\/디스패치.*상태\/효과 미확인|Receiver\/values\/types\/ops\/getters\/dispatch\/state\/effects unknown/u);
        assert.match(call.reason, /호출 대상은 추정입니다|The target is inferred/u);
        assert.ok(flow.includes("service.addFee(amount)") && flow.includes("this.bias + value"));
        assert.match(flow, /추정 후보가 실제 대상이라면|If the inferred candidates are selected/u);
        assert.doesNotMatch([flow, call.role, call.output, call.effects].join(" "), /`5 \+ value`|`value \+ 5`|지역 값 유지|local preservation|수수료|금액.*검증|validated|\bfee\b/u);
        assert.ok(h.evidenceTokens.resolve(call.callerEvidence!) && h.evidenceTokens.resolve(call.calleeEvidence!));
        for (const key of ["role", "inputs", "output", "effects", "reason"] as const) assert.ok(call[key].length);
        await h.host.explain({ ...request, requestId: request.requestId + 20, pageIndex: 0, pageLanguage: locale });
        assert.equal(h.replies.at(-1)!.cacheHit, true); assert.equal(h.replies.at(-1)!.narrative!.flow, flow); assert.equal(h.models(), 0);
      }
      assert.ok(h.contexts.every(context => context.callTask!.targets[0].sourceKind === "method"));
    } finally { h.host.reset(); }
  }
});

test("method evidence opens the same parser-owned declaration used by readings when native extents stop at the header", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const h = await harness(language, "en", "return this.bias + value;", false, true);
    try {
      const before = JSON.stringify(h.graph); await h.host.explain(h.explanation);
      assert.equal(h.replies.at(-1)!.status, "ready"); assert.equal(h.models(), 0);
      const token = h.replies.at(-1)!.narrative!.calls[0].calleeEvidence!;
      const location = h.evidenceTokens.resolve(token)!;
      const lines = h.files[1].content.split("\n");
      const selected = lines.slice(location.range.startLine, location.range.endLine + 1).map((line, index, all) =>
        line.slice(index === 0 ? location.range.startCharacter : 0, index === all.length - 1 ? location.range.endCharacter : undefined)).join("\n");
      assert.ok(selected.includes("addFee(value:")); assert.ok(selected.includes("return this.bias + value;"));
      assert.equal(JSON.stringify(h.graph), before, "evidence must not mutate graph ranges or identities");
      await h.host.explain({ ...h.explanation, requestId: 2, pageIndex: 0, pageLanguage: "en" });
      assert.equal(h.replies.at(-1)!.cacheHit, true); assert.equal(h.replies.at(-1)!.narrative!.calls[0].calleeEvidence, token);
    } finally { h.host.reset(); }
  }
});

test("method declarations and this reads are explicit source-only opt-ins and cannot acquire primitive/evaluator authority", async () => {
  const names = new Set(["value", "this"]);
  assert.equal(readFunctionCallSourceExpression("this", names), undefined);
  assert.equal(readFunctionCallSourceExpression("this.bias + value", names), undefined);
  assert.equal(readFunctionCallSourceObjectExpression("this.bias + value", names, { externalReads: true }), undefined);
  assert.deepEqual(readFunctionCallSourceObjectExpression("this.bias + value", names, { externalReads: true, methodReceiver: true }),
    { expression: "this.bias + value", accesses: ["this.bias"] });
  for (const expression of ["super.bias", "this?.bias", "this[getter()]", "this.bias = value", "this.bias++"])
    assert.equal(readFunctionCallSourceObjectExpression(expression, names, { externalReads: true, methodReceiver: true }), undefined, expression);
  for (const language of ["typescript", "kotlin"] as const) {
    const f = await loadFunctionCallReadingFixture(language, sources(language, "return value + 5;"));
    const node = f.graph.nodes.find(node => node.name === "addFee")!, source = f.files[1].content;
    const logic = analyzeFunctionLogic({ functionNode: node, sourceText: source });
    const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText: source, functionLogic: logic });
    if (language === "typescript") {
      assert.equal(declaration.inputSummarySafe, false);
      assert.equal(readFunctionCallSourceDeclaredParameters(declaration), undefined);
    }
    assert.deepEqual(readFunctionCallSourceParameters(node, source), [{ name: "value", type: language === "kotlin" ? "Int" : "number" }]);
    assert.ok(readFunctionCallSourceDeclaredParameters(declaration, { sourceOnlyMethod: true }));
    const rejected = { ...declaration, functionNode: { ...node, kind: "function" as const }, inputSummarySafe: false };
    assert.equal(readFunctionCallSourceDeclaredParameters(rejected, { sourceOnlyMethod: true }), undefined, "a method flag cannot bypass an unstable ordinary function");
    const site = analyzeFunctionLogic({ functionNode: f.root, sourceText: f.source }).callsites[0];
    const facts = createFunctionCallSourceReader(f.root, f.source).read(node, source, site.range, "service.addFee(amount)")!;
    assert.equal(facts.methodSource, true); assert.ok(facts.bodyPaths, "even a primitive-looking method must not become a primitive leaf");
    if (language === "typescript") assert.equal(declaration.inputSummarySafe, false, "reading must not mutate the evaluator's safety flag");
  }
});

test("method parents preserve this call syntax and candidate uncertainty without creating receiver objects", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const h = await harness(language, "ko", "return this.bias + value;", true);
    try {
      assert.equal(h.root.kind, "method"); await h.host.explain(h.explanation);
      assert.equal(h.replies.at(-1)!.status, "ready"); assert.equal(h.models(), 0);
      assert.match(h.replies.at(-1)!.narrative!.flow!, /this\.addFee\(amount\).*this\.bias \+ value/su);
      assert.match(h.replies.at(-1)!.narrative!.calls[0].effects, /수신자.*미확인/u);
    } finally { h.host.reset(); }
  }
});

test("method source support keeps constructor/accessor, indirect, receiver-write, optional/computed, deferred and execution boundaries", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    for (const body of ["this.bias = value; return value;", "this.bias++; return value;", "return super.bias + value;",
      "return this?.bias;", "return this[getter()];", "return this.read(() => value);", "while (value > 0) value -= 1; return value;"]) {
      const h = await harness(language, "en", body);
      try { await h.host.explain(h.explanation); assert.equal(h.models(), 1, `${language}: ${body}`); }
      finally { h.host.reset(); }
    }
    const f = await loadFunctionCallReadingFixture(language, sources(language, "return this.bias + value;"));
    const node = f.graph.nodes.find(node => node.name === "addFee")!, source = f.files[1].content;
    const site = analyzeFunctionLogic({ functionNode: f.root, sourceText: f.source }).callsites[0];
    const reader = createFunctionCallSourceReader(f.root, f.source);
    const modified = source.replace(language === "kotlin" ? "fun addFee" : "addFee(value", language === "kotlin" ? "inline suspend fun addFee" : "async *addFee(value");
    assert.equal(reader.read(node, modified, site.range, "service.addFee(amount)"), undefined);
    assert.equal(reader.read({ ...node, kind: "constructor" }, source, site.range, "service.addFee(amount)"), undefined);
    assert.equal(reader.read(node, source, site.range, "service.addFee.call(service, amount)"), undefined);
    assert.equal(reader.read(node, source, site.range, "service?.addFee(amount)"), undefined);
    if (language === "typescript") {
      const accessor = source.replace("addFee(value: number): number", "get addFee(): number").replace("this.bias + value", "this.bias");
      assert.equal(readFunctionCallSourceParameters(node, accessor), undefined);
      assert.equal(reader.read(node, accessor, site.range, "service.addFee(amount)"), undefined);
      assert.equal(readFunctionCallSourceParameters(node, source.replace("value: number", "this: MathOps, value: number")), undefined);
    } else {
      for (const modifier of ["inline", "operator", "external", "expect"]) {
        const altered = source.replace("fun addFee", modifier + " fun addFee");
        assert.equal(reader.read(node, altered, site.range, "service.addFee(amount)"), undefined, modifier);
      }
    }
  }
});
