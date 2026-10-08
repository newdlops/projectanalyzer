/** Real asynchronous source readings distinguish call return, await fulfillment and suspend resumption without runtime evaluation. */
import assert from "node:assert/strict";
import test from "node:test";
import { FunctionCallsHostDelivery } from "../../webview/functionCalls";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow";
import { exampleFunctionCallScenarios } from "../../shared/functionCalls";
import { buildSourceFunctionNarrativeResponse } from "../../application/functionNarratives";
import { createFunctionCallSourceReader, readFunctionCallSourceObjectExpression, readFunctionCallSourceExpression } from "../../analyzer/functionCalls";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { loadFunctionCallReadingFixture, functionCallReadingReply } from "./helpers/functionCallReadingFixture";
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionCallNarrativesRequest, FunctionCallNarrativesResponse } from "../../protocol/functionCallNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

/** Private protocol/model boundaries are real except the explicit fallback model response. */
async function harness(language: "typescript" | "kotlin", locale: "ko" | "en", caller?: string, helper?: string) {
  const parent = caller ?? (language === "kotlin" ? "suspend fun checkout(amount: Int): Int { return addFee(amount) }"
    : 'import { addFee } from "./readingHelpers";\nexport async function checkout(amount: number): Promise<number> { return await addFee(amount); }');
  const callee = helper ?? (language === "kotlin" ? "suspend fun addFee(value: Int): Int { val n = service.read(value); return n + 3 }"
    : "export async function addFee(value: number): Promise<number> { const n = await service.read(value); return n + 3; }");
  const fixture = await loadFunctionCallReadingFixture(language, name => name === "reading" ? parent : callee);
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
      if (source) return source; models++; return functionCallReadingReply(context, language);
    } } });
  const request = { graphVersion, sourceToken: sourceNodeTokens.createToken(fixture.root.id)!, requestId: 1 };
  await host.load(request); const slice = loaded.at(-1)!;
  const explanation: FunctionCallNarrativesRequest = { ...request, contextId: slice.narratives!.contextId!, scope: "overview" };
  return { ...fixture, host, slice, replies, contexts, explanation, evidenceTokens, models: () => models };
}

test("TS async and Kotlin suspend keep every original operation, completion uncertainty, all fields, evidence and cache across scopes/locales", async () => {
  for (const language of ["typescript", "kotlin"] as const) for (const locale of ["ko", "en"] as const) {
    const h = await harness(language, locale);
    try {
      const before = JSON.stringify(h.slice), example = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])))[0];
      const requests: FunctionCallNarrativesRequest[] = [h.explanation,
        { ...h.explanation, requestId: 2, scope: "call", connectionId: h.slice.connections[0].id },
        { ...h.explanation, requestId: 3, scope: "scenario", choices: [...example.selection].map(([key, value]) => ({ key, value })) }];
      for (const request of requests) {
        await h.host.explain(request); const reply = h.replies.at(-1)!, call = reply.narrative!.calls[0];
        assert.equal(reply.status, "ready"); assert.equal(reply.coverage!.complete, true);
        assert.equal(h.models(), 0, `${language} ${locale} ${request.scope}`);
        assert.equal(JSON.stringify(h.slice), before, "completion syntax cannot upgrade graph dispatch or execution confidence");
        assert.ok(call.inputs.includes("`amount` → `value`"));
        assert.match(call.role, language === "kotlin" ? /suspend/u : /Promise/u);
        assert.match(call.output, /미확인|unknown/u); assert.ok(call.output.includes("n + 3"));
        assert.match(call.effects, /거부\/취소\/재개 미확인|throw\/cancel\/resume unknown/u);
        assert.ok(reply.narrative!.flow!.includes("service.read(value)"));
        assert.ok(reply.narrative!.flow!.includes("n + 3"));
        if (language === "typescript") assert.ok(reply.narrative!.flow!.includes("await"));
        for (const key of ["role", "inputs", "output", "effects", "reason"] as const) assert.ok(call[key].length);
        assert.ok(h.evidenceTokens.resolve(call.callerEvidence!) && h.evidenceTokens.resolve(call.calleeEvidence!));
        await h.host.explain({ ...request, requestId: request.requestId + 20, pageIndex: 0, pageLanguage: locale });
        assert.equal(h.replies.at(-1)!.cacheHit, true); assert.equal(h.models(), 0);
      }
      assert.ok(h.contexts.every(context => context.callTask!.targets[0].parameters?.[0].name === "value"));
    } finally { h.host.reset(); }
  }
});

test("raw Promise storage/return differs from await fulfillment; async parents preserve local continuation and their own return contract", async () => {
  for (const locale of ["ko", "en"] as const) for (const awaited of [false, true]) {
    const caller = 'import { addFee } from "./readingHelpers";\nexport async function checkout(amount: number): Promise<number> {'
      + ` const n = ${awaited ? "await " : ""}addFee(amount); return n; }`;
    const h = await harness("typescript", locale, caller, "export async function addFee(value: number): Promise<number> { return value + 3; }");
    try {
      await h.host.explain(h.explanation); assert.equal(h.models(), 0);
      const call = h.replies.at(-1)!.narrative!.calls[0];
      assert.match(call.output, awaited ? /await/u : /Promise/u); assert.ok(call.output.includes("`n`"));
      assert.match(h.replies.at(-1)!.narrative!.flow!, /Promise/u);
      const site = analyzeFunctionLogic({ functionNode: h.root, sourceText: h.source }).callsites[0];
      const facts = createFunctionCallSourceReader(h.root, h.source).read(h.graph.nodes.find(node => node.name === "addFee")!, h.files[1].content, site.range, "addFee(amount)")!;
      assert.equal(facts.execution, "promise"); assert.equal(facts.callerExecution, "promise");
      assert.equal(facts.use.awaited, awaited ? true : undefined); assert.ok(facts.bodyPaths);
    } finally { h.host.reset(); }
  }
});

test("await syntax requires an explicit source-only opt-in and never acquires primitive authority or drops source spelling", () => {
  const names = new Set(["value", "await"]);
  assert.equal(readFunctionCallSourceExpression("await value", names), undefined);
  assert.equal(readFunctionCallSourceObjectExpression("await value", names, { externalReads: true }), undefined);
  // Kotlin can declare a binding named await. Default readers retain that
  // identifier but cannot interpret an await-prefix expression as a value.
  assert.deepEqual(readFunctionCallSourceObjectExpression("await", names), { expression: "await", accesses: [] });
  assert.deepEqual(readFunctionCallSourceObjectExpression("await value + 1", names, { asyncAwait: true }),
    { expression: "await value + 1", accesses: [], awaits: 1 });
  for (const value of ["await", "value await value", "await value++", "await value[0]", "await (() => value)", "yield value", "await value = 1"])
    assert.equal(readFunctionCallSourceObjectExpression(value, names, { externalReads: true, asyncAwait: true }), undefined, value);
});

test("async conditions retain both whole-source branches and zero-call Promise returns without reusing another route's prose", async () => {
  const parent = 'import { addFee } from "./readingHelpers";\nexport async function checkout(amount: number): Promise<number> {'
    + " if (amount < 0) return 0; return await addFee(amount); }";
  const h = await harness("typescript", "ko", parent, "export async function addFee(value: number): Promise<number> { return value + 3; }");
  try {
    const examples = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])));
    assert.equal(examples.length, 2); await h.host.explain(h.explanation); assert.equal(h.models(), 0);
    assert.match(h.replies.at(-1)!.narrative!.flow!, /반환(?:식)? `0`|return `0`/u);
    const replies = new Map<number, string>();
    for (const [index, example] of examples.entries()) {
      const request = { ...h.explanation, requestId: index + 2, scope: "scenario" as const,
        choices: [...example.selection].map(([key, value]) => ({ key, value })) };
      await h.host.explain(request); const reply = h.replies.at(-1)!;
      assert.equal(reply.status, "ready"); assert.equal(h.models(), 0);
      assert.equal(reply.narrative!.calls.length, example.trace.callIds.length);
      assert.match(reply.narrative!.flow!, /Promise.*가정.*미확인/u);
      replies.set(reply.narrative!.calls.length, reply.narrative!.flow!);
      await h.host.explain({ ...request, requestId: index + 12, pageIndex: 0, pageLanguage: "ko" });
      assert.equal(h.replies.at(-1)!.cacheHit, true); assert.equal(h.replies.at(-1)!.narrative!.flow, reply.narrative!.flow);
    }
    assert.notEqual(replies.get(0), replies.get(1));
  } finally { h.host.reset(); }
});

test("async method parents preserve candidate dispatch, this source and Promise/suspend contracts without receiver construction", async () => {
  for (const language of ["typescript", "kotlin"] as const) for (const locale of ["ko", "en"] as const) {
    const parent = language === "kotlin" ? "class Runner(val bias: Int) { suspend fun checkout(amount: Int): Int { return this.addFee(amount) } suspend fun addFee(value: Int): Int { return this.bias + value } }"
      : "export class Runner { bias: number = 5; async checkout(amount: number): Promise<number> { return await this.addFee(amount); } async addFee(value: number): Promise<number> { return this.bias + value; } }";
    const h = await harness(language, locale, parent, "// No other callees.");
    try {
      await h.host.explain(h.explanation); assert.equal(h.models(), 0, `${language} ${locale}`);
      const call = h.replies.at(-1)!.narrative!.calls[0];
      assert.match(call.role, /추정 대상의 원문|Candidate source/u);
      assert.match(call.inputs, /이 후보가 실제 대상이라면|If this candidate is selected/u);
      assert.match(call.output, /이 후보가 실제 대상이라면|If this candidate is selected/u);
      assert.ok(call.output.includes("this.bias + value")); assert.doesNotMatch(call.output, /`5 \+ value`/u);
      assert.match(call.effects, /거부\/취소\/재개 미확인|throw\/cancel\/resume unknown/u);
    } finally { h.host.reset(); }
  }
});

test("nested awaited invocations retain postorder and await occurrences while never becoming primitive leaves", async () => {
  const h = await harness("typescript", "ko", undefined,
    "export async function addFee(value: number): Promise<number> { return await outer(await inner(value)); }");
  try {
    const logic = analyzeFunctionLogic({ functionNode: h.root, sourceText: h.source }), site = logic.callsites[0];
    const callee = h.graph.nodes.find(node => node.name === "addFee")!;
    const facts = createFunctionCallSourceReader(h.root, h.source).read(callee, h.files[1].content, site.range, "addFee(amount)")!;
    assert.equal(facts.execution, "promise"); assert.equal(facts.bodyPaths![0][0].awaits, 2);
    assert.deepEqual(facts.bodyPaths![0][0].calls, ["inner(value)", "outer(await inner(value))"]);
    assert.equal(facts.returnExpression, "await outer(await inner(value))");
    assert.equal(createFunctionCallSourceReader(h.root, h.source, { maxCalleeDepth: 1 }).read(callee, h.files[1].content, site.range, "addFee(amount)"), undefined);
    await h.host.explain(h.explanation); assert.equal(h.models(), 0);
    assert.ok(h.replies.at(-1)!.narrative!.flow!.includes("await outer(await inner(value))"));
  } finally { h.host.reset(); }
  const ignored = await harness("typescript", "en",
    'import { addFee } from "./readingHelpers";\nexport async function checkout(amount: number): Promise<number> { await addFee(amount); return amount + 1; }',
    "export async function addFee(value: number): Promise<number> { await audit(value); return value + 3; }");
  try {
    await ignored.host.explain(ignored.explanation); assert.equal(ignored.models(), 0);
    const call = ignored.replies.at(-1)!.narrative!.calls[0];
    assert.match(call.output, /await fulfillment.*discard without storage or return/u);
    assert.ok(ignored.replies.at(-1)!.narrative!.flow!.includes("await audit(value)"));
    assert.match(ignored.replies.at(-1)!.narrative!.flow!, /amount \+ 1/u);
  } finally { ignored.host.reset(); }
});

test("async source support retains generators, try/finally, writes, optional/computed dispatch, callbacks and coroutine modifiers as model work", async () => {
  const rejected = [
    "export async function* addFee(value: number) { yield value; }",
    "export async function addFee(value: number) { try { return await remote(value); } finally { audit(value); } }",
    "export async function addFee(value: number) { value += 1; return value; }",
    "export async function addFee(value: number) { return await service?.read(value); }",
    "export async function addFee(value: number) { return await service[getName()](value); }",
    "export async function addFee(value: number) { return await remote(() => value); }",
    "export async function addFee(value: number) { while (value < 3) value += 1; return value; }"
  ];
  for (const helper of rejected) {
    const h = await harness("typescript", "en", undefined, helper);
    try { await h.host.explain(h.explanation); assert.equal(h.models(), 1, helper); }
    finally { h.host.reset(); }
  }
  for (const modifier of ["inline", "operator", "external", "expect"]) {
    const helper = `${modifier} suspend fun addFee(value: Int): Int { return value + 3 }`;
    const h = await harness("kotlin", "en", undefined, helper);
    try { await h.host.explain(h.explanation); assert.equal(h.models(), 1, helper); }
    finally { h.host.reset(); }
  }
});
