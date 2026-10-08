/** Production-parser callee branch/local worksheets, external-model boundaries and source navigation integration. */
import assert from "node:assert/strict";
import test from "node:test";
import { FunctionCallsHostDelivery } from "../../webview/functionCalls";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow";
import { exampleFunctionCallScenarios } from "../../shared/functionCalls";
import { buildSourceFunctionNarrativeResponse, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import { createFunctionCallSourceReader, readFunctionCallSourceParameters, readFunctionCallSourceDeclaredParameters } from "../../analyzer/functionCalls";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { analyzeFunctionTutorDeclaration } from "../../analyzer/functionTutor";
import { readFunctionCallSourceExpression, readFunctionCallSourceObjectExpression } from "../../analyzer/functionCalls/sourceSyntax";
import { renderFunctionCallSourceEffects } from "../../application/functionCallNarratives/sourceBodyReading";
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

test("unproved call values/captures, cycles, implicit returns, parameter/immutable writes and body/prose limits retain model analysis", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const keyword = language === "kotlin" ? "var" : "let", immutable = language === "kotlin" ? "val" : "const";
    const invalid = ["captured += value; return value;", "return captured[getter()];", "captured.member = value; return value;", "value += 1; return value;",
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
    const repeated = reader.read(callee, source.replace(returned, "audit(value); audit(value); return value;"), site.range, "addFee(amount)")!;
    const calls = repeated.bodyPaths![0].filter(step => step.kind === "call");
    assert.equal(calls.length, 2); assert.notEqual(calls[0].key, calls[1].key);
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

test("opaque ignored primitive calls retain exact arguments, calculations, unknown effects and explicit completion assumptions", async () => {
  for (const language of ["typescript", "kotlin"] as const) for (const locale of ["en", "ko"] as const) {
    const body = `${language === "kotlin" ? "val" : "const"} n = value + 5; audit(n); return n + 3;`;
    const h = await harness(language, locale, body);
    try {
      await h.delivery.explain(h.explanation); assert.equal(h.models(), 0);
      const reply = h.replies.at(-1)!, call = reply.narrative!.calls[0], flow = reply.narrative!.flow!;
      assert.match(call.inputs, /`amount` → `value`/u); assert.match(call.output, /정상 복귀·지역 값 유지|normal calls preserve locals/u);
      assert.match(call.effects, /n = value \+ 5/u); assert.match(call.effects, /`audit\(n\)`/u);
      assert.match(call.effects, /미확인|unreviewed/u); assert.match(flow, /n = value \+ 5.*audit\(n\).*n \+ 3/su);
      assert.match(flow, /정상 복귀·지역 값 유지 가정|normal return\/local preservation/u);
      assert.doesNotMatch([call.role, call.output, call.effects, flow].join(" "), /감사 로그|검사 수행|수수료|금액|출입금|logging|recorded|\bfee\b|\bmoney\b|check performed/iu);
      assert.ok(h.evidenceTokens.resolve(call.callerEvidence!) && h.evidenceTokens.resolve(call.calleeEvidence!));
      await h.delivery.explain({ ...h.explanation, requestId: 2, pageIndex: 0, pageLanguage: locale });
      assert.equal(h.replies.at(-1)!.cacheHit, true); assert.equal(h.models(), 0);
    } finally { h.delivery.reset(); }
  }
});

test("opaque call values reject hidden writes/computed access, eval and deferred callbacks", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const invalid = ["eval(value); return value;", "Function(value); return value;", "audit(captured++); return value;", "return audit(captured[getter()]);",
      `${language === "kotlin" ? "val" : "const"} n = service?.audit(value); return n;`, "return outer(inner(captured++));"];
    if (language === "typescript") invalid.push("audit(() => value); return value;");
    for (const body of invalid) {
      const h = await harness(language, "en", body);
      try { await h.delivery.explain(h.explanation); assert.equal(h.models(), 1, body); }
      finally { h.delivery.reset(); }
    }
  }
});

test("nested call results retain complete source expressions, bindings, result uncertainty and navigation without a model", async () => {
  for (const language of ["typescript", "kotlin"] as const) for (const locale of ["en", "ko"] as const) {
    const keyword = language === "kotlin" ? "val" : "const";
    const bodies = [`${keyword} n = outer(inner(value), value + 1); return n + 3;`,
      "return outer(inner(value), value + 1) + 3;", "return audit(value);",
      `${language === "kotlin" ? "var" : "let"} n = value; n = audit(n); return n;`];
    for (const body of bodies) {
      const h = await harness(language, locale, body);
      try {
        const example = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])))[0];
        const requests: FunctionCallNarrativesRequest[] = [h.explanation,
          { ...h.explanation, requestId: 2, scope: "call", connectionId: h.slice.connections[0].id },
          { ...h.explanation, requestId: 3, scope: "scenario", choices: [...example.selection].map(([key, value]) => ({ key, value })) }];
        for (const request of requests) {
          await h.delivery.explain(request); assert.equal(h.models(), 0, `${language} ${locale}: ${body}`);
          const reply = h.replies.at(-1)!, call = reply.narrative!.calls[0], flow = reply.narrative!.flow!;
          assert.equal(reply.status, "ready"); assert.equal(reply.coverage!.complete, true);
          assert.match(call.effects, /결과 타입\/값|results\/types/u); assert.match(flow, /결과 타입·값|results\/types/u);
          assert.match(call.output, /정상 복귀·지역 값 유지|normal calls preserve locals/u);
          if (body.includes("outer")) {
            assert.ok(flow.includes("outer(inner(value), value + 1)")); assert.ok(call.effects.includes("inner(value)"));
          } else assert.ok(call.effects.includes("audit("));
          assert.doesNotMatch(flow, /\(0\)|감사 로그|수수료|logging|\bfee\b|\bmoney\b/iu);
          assert.match(call.inputs, /`amount` → `value`/u);
          assert.ok(h.evidenceTokens.resolve(call.callerEvidence!) && h.evidenceTokens.resolve(call.calleeEvidence!));
          await h.delivery.explain({ ...request, requestId: request.requestId + 10, pageIndex: 0, pageLanguage: locale });
          assert.equal(h.replies.at(-1)!.cacheHit, true); assert.equal(h.models(), 0);
        }
      } finally { h.delivery.reset(); }
    }
  }
});

test("parser-owned nested and predicate calls retain duplicate occurrence order and reject hidden expression guards", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const fixture = await loadFunctionCallReadingFixture(language), callee = fixture.graph.nodes.find(node => node.name === "addFee")!;
    const reader = createFunctionCallSourceReader(fixture.root, fixture.source), source = fixture.files[1].content;
    const site = analyzeFunctionLogic({ functionNode: fixture.root, sourceText: fixture.source }).callsites.find(site => site.calleeName === "addFee")!;
    const returned = language === "kotlin" ? "return value + 5" : "return value + 5;";
    const nested = reader.read(callee, source.replace(returned, "return outer(inner(value), inner(value));"), site.range, "addFee(amount)")!;
    assert.deepEqual(nested.bodyPaths![0][0].calls, ["inner(value)", "inner(value)", "outer(inner(value), inner(value))"]);
    const guarded = reader.read(callee, source.replace(returned, "if (audit(value) > 0) return 1; return 0;"), site.range, "addFee(amount)")!;
    assert.equal(guarded.bodyPaths!.length, 2);
    assert.ok(guarded.bodyPaths!.every(path => path[0].kind === "condition" && path[0].calls?.[0] === "audit(value)"));
    for (const body of ["return outer(inner(captured++));", "return value && audit(value);", "return outer(eval(value));",
      "return service?.audit(value);", "return outer(captured[getter()]);", "return audit(...value);", "return outer(inner(value) value + 1);"])
      assert.equal(reader.read(callee, source.replace(returned, body), site.range, "addFee(amount)"), undefined, body);
  }
});

test("receiver expressions keep local roots, exact reads/arguments and unknown state without assuming an unchanged object", async () => {
  for (const language of ["typescript", "kotlin"] as const) for (const locale of ["en", "ko"] as const) {
    const keyword = language === "kotlin" ? "val" : "const";
    for (const body of [`${keyword} s = connect(value); return s.read(value) + s.bias;`,
      `${keyword} s = connect(value); return s.bias;`, "return outer(value.member);"]) {
      const h = await harness(language, locale, body);
      try {
        const example = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])))[0];
        const requests: FunctionCallNarrativesRequest[] = [h.explanation,
          { ...h.explanation, requestId: 2, scope: "call", connectionId: h.slice.connections[0].id },
          { ...h.explanation, requestId: 3, scope: "scenario", choices: [...example.selection].map(([key, value]) => ({ key, value })) }];
        for (const request of requests) {
          await h.delivery.explain(request); assert.equal(h.models(), 0, `${language} ${locale}: ${body}`);
          const reply = h.replies.at(-1)!, call = reply.narrative!.calls[0], flow = reply.narrative!.flow!;
          assert.match(call.effects, /디스패치·getter·객체\/외부 상태 변화|Dispatch\/getters\/state/u);
          assert.match(call.output, /정상 완료 가정|Assuming normal completion/u);
          assert.match(flow, /디스패치·getter·상태 변화|dispatch\/getters\/state/u);
          assert.doesNotMatch([flow, call.output, call.effects].join(" "), /local preservation|preserve locals|지역 값 유지|객체.*유지/u);
          assert.ok(flow.includes(body.includes("s.read") ? "s.read(value) + s.bias" : body.includes("s.bias") ? "s.bias" : "outer(value.member)"));
          assert.ok(h.evidenceTokens.resolve(call.callerEvidence!) && h.evidenceTokens.resolve(call.calleeEvidence!));
          await h.delivery.explain({ ...request, requestId: request.requestId + 10, pageIndex: 0, pageLanguage: locale });
          assert.equal(h.replies.at(-1)!.cacheHit, true); assert.equal(h.models(), 0);
        }
      } finally { h.delivery.reset(); }
    }
  }
});

test("object syntax is opt-in and never resolves getters, quoted paths, captured roots, receiver writes or indirect dispatch", async () => {
  const names = new Set(["s", "value"]);
  assert.equal(readFunctionCallSourceExpression("s.bias + value", names), undefined);
  assert.deepEqual(readFunctionCallSourceObjectExpression("s.bias + value", names), { expression: "s.bias + value", accesses: ["s.bias"] });
  assert.deepEqual(readFunctionCallSourceObjectExpression('"s.bias"', names)?.accesses, []);
  assert.equal(readFunctionCallSourceObjectExpression("captured.bias", names), undefined);
  assert.equal(readFunctionCallSourceObjectExpression("s[getter()]", names), undefined);
  const chain = "s." + Array.from({ length: 16 }, () => "p").join(".");
  assert.ok(readFunctionCallSourceObjectExpression(chain, names));
  assert.equal(readFunctionCallSourceObjectExpression(chain + " + " + chain, names), undefined, "member paths consume every original identifier/dot token");
  assert.equal(readFunctionCallSourceObjectExpression(chain + ".p", names), undefined, "member depth remains bounded");
  for (const language of ["typescript", "kotlin"] as const) {
    const keyword = language === "kotlin" ? "val" : "const";
    for (const body of [`${keyword} s = connect(value); s.bias = value; return value;`,
      `${keyword} s = connect(value); return s.call(value);`, `${keyword} s = connect(value); return s?.read(value);`,
      `${keyword} s = connect(value); return s["bias"];`, "return external?.read(value);", "captured.bias = value; return value;"]) {
      const h = await harness(language, "en", body);
      try { await h.delivery.explain(h.explanation); assert.equal(h.models(), 1, body); }
      finally { h.delivery.reset(); }
    }
  }
});

test("receiver syntax preserves Kotlin inferred dispatch and attaches predicate reads before their assumed outcomes", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const fixture = await loadFunctionCallReadingFixture(language), callee = fixture.graph.nodes.find(node => node.name === "addFee")!;
    const reader = createFunctionCallSourceReader(fixture.root, fixture.source), source = fixture.files[1].content;
    const site = analyzeFunctionLogic({ functionNode: fixture.root, sourceText: fixture.source }).callsites.find(site => site.calleeName === "addFee")!;
    const returned = language === "kotlin" ? "return value + 5" : "return value + 5;", keyword = language === "kotlin" ? "val" : "const";
    const body = `${keyword} s = connect(value); if (s.ready) return s.read(value); return s.bias;`;
    const facts = reader.read(callee, source.replace(returned, body), site.range, "addFee(amount)")!;
    assert.equal(facts.bodyPaths!.length, 2);
    assert.ok(facts.bodyPaths!.every(path => path[1].kind === "condition" && path[1].accesses?.[0] === "s.ready"));
    const method = facts.bodyPaths!.flat().find(step => step.calls?.includes("s.read(value)"))!;
    assert.deepEqual(method.inferredCalls, language === "kotlin" ? ["s.read(value)"] : undefined);
    assert.ok(method.accesses?.includes("s.read"));
    const ordered = reader.read(callee, source.replace(returned, `${keyword} s = connect(value); s.peek(value); ${keyword} n = s.bias; return n;`), site.range, "addFee(amount)")!;
    const effects = renderFunctionCallSourceEffects(ordered, false)!;
    assert.ok(effects.indexOf("s.peek(value)") < effects.indexOf(`${keyword} n = s.bias`), "effects preserve call-before-read order, not grouped mutations before calls");
  }
});

test("captured and external reads preserve exact operations and unknown values/state instead of inventing business or validation effects", async () => {
  for (const language of ["typescript", "kotlin"] as const) for (const locale of ["en", "ko"] as const) {
    const keyword = language === "kotlin" ? "val" : "const";
    for (const body of [`${keyword} n = service.audit(value); return n + 3;`,
      "return captured + value;", "return external.bias + value;", "return outer(inner(captured));"]) {
      const h = await harness(language, locale, body);
      try {
        const example = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])))[0];
        const requests: FunctionCallNarrativesRequest[] = [h.explanation,
          { ...h.explanation, requestId: 2, scope: "call", connectionId: h.slice.connections[0].id },
          { ...h.explanation, requestId: 3, scope: "scenario", choices: [...example.selection].map(([key, value]) => ({ key, value })) }];
        for (const request of requests) {
          await h.delivery.explain(request); assert.equal(h.models(), 0, `${language} ${locale}: ${body}`);
          const reply = h.replies.at(-1)!, call = reply.narrative!.calls[0], flow = reply.narrative!.flow!;
          assert.equal(reply.status, "ready"); assert.equal(reply.coverage!.complete, true);
          assert.match(call.effects, /외부 읽기.*상태 변화.*결과 타입\/값.*미확인|External reads.*types\/values\/effects unknown/u);
          assert.match(flow, /외부 값\/상태.*미확인|external values\/state.*unknown/u);
          assert.match(call.output, /정상 완료 가정|Assuming normal completion/u);
          assert.ok(flow.includes(body.includes("service.audit") ? "service.audit(value)" : body.includes("external.bias") ? "external.bias + value" : body.includes("outer") ? "outer(inner(captured))" : "captured + value"));
          if (body.includes("service.audit")) assert.match(flow, /n = service\.audit\(value\).*n \+ 3/su);
          assert.doesNotMatch([flow, call.role, call.effects].join(" "), /수수료|감사 로그|금액.*검증|검증된 금액|local preservation|지역 값 유지|\bfee\b|\bmoney\b|\blogging\b|validated amount/iu);
          assert.match(call.inputs, /`amount` → `value`/u);
          assert.ok(h.evidenceTokens.resolve(call.callerEvidence!) && h.evidenceTokens.resolve(call.calleeEvidence!));
          await h.delivery.explain({ ...request, requestId: request.requestId + 10, pageIndex: 0, pageLanguage: locale });
          assert.equal(h.replies.at(-1)!.cacheHit, true); assert.equal(h.models(), 0);
        }
      } finally { h.delivery.reset(); }
    }
  }
});

test("external reads require a separate opt-in, retain names/provenance and cannot turn writes or syntax keywords into values", async () => {
  const names = new Set(["value"]);
  assert.equal(readFunctionCallSourceExpression("captured + value", names), undefined);
  assert.equal(readFunctionCallSourceObjectExpression("captured + value", names), undefined);
  assert.deepEqual(readFunctionCallSourceObjectExpression("captured + value", names, { externalReads: true }),
    { expression: "captured + value", accesses: [], externalReads: ["captured"] });
  for (const text of ["captured = value", "captured++", "await", "yield", "new", "this.bias", "external[getter()]", "external?.bias"])
    assert.equal(readFunctionCallSourceObjectExpression(text, names, { externalReads: true }), undefined, text);
  for (const language of ["typescript", "kotlin"] as const) {
    const fixture = await loadFunctionCallReadingFixture(language), callee = fixture.graph.nodes.find(node => node.name === "addFee")!;
    const reader = createFunctionCallSourceReader(fixture.root, fixture.source), source = fixture.files[1].content;
    const site = analyzeFunctionLogic({ functionNode: fixture.root, sourceText: fixture.source }).callsites.find(site => site.calleeName === "addFee")!;
    const returned = language === "kotlin" ? "return value + 5" : "return value + 5;";
    const facts = reader.read(callee, source.replace(returned, "return service.audit(value) + captured;"), site.range, "addFee(amount)")!;
    assert.ok(facts.bodyPaths![0][0].externalReads?.includes("service"));
    assert.ok(facts.bodyPaths![0][0].externalReads?.includes("captured"));
    assert.deepEqual(facts.bodyPaths![0][0].inferredCalls, language === "kotlin" ? ["service.audit(value)"] : undefined);
  }
});

/** Authored reference types are retained without creating objects or resolving imported runtime implementations. */
function typedInputFixture(language: "typescript" | "kotlin", type: string, body: string) {
  return (name: string) => name === "reading" ? language === "kotlin"
    ? `fun checkout(amount: ${type}): Int { return addFee(amount) }`
    : `import { addFee, type Payload } from "./readingHelpers";\nexport function checkout(amount: ${type}): number { return addFee(amount); }`
    : language === "kotlin" ? `data class Payload(val bias: Int)\nfun addFee(value: ${type}): Int { ${body} }`
      : `export interface Payload { bias: number }\nexport function addFee(value: ${type}): number { ${body} }`;
}

test("declared reference inputs keep five detailed fields, exact source operations, uncertainty, evidence and cache without model requests", async () => {
  for (const language of ["typescript", "kotlin"] as const) for (const locale of ["en", "ko"] as const) {
    const keyword = language === "kotlin" ? "val" : "const";
    const h = await harness(language, locale, "", typedInputFixture(language, "Payload", `${keyword} n = value.bias; return n + 3;`));
    try {
      const example = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])))[0];
      const requests: FunctionCallNarrativesRequest[] = [h.explanation,
        { ...h.explanation, requestId: 2, scope: "call", connectionId: h.slice.connections[0].id },
        { ...h.explanation, requestId: 3, scope: "scenario", choices: [...example.selection].map(([key, value]) => ({ key, value })) }];
      for (const request of requests) {
        await h.delivery.explain(request);
        const reply = h.replies.at(-1)!, call = reply.narrative!.calls[0], flow = reply.narrative!.flow!;
        assert.equal(reply.status, "ready"); assert.equal(reply.coverage!.complete, true); assert.equal(h.models(), 0, `${language} ${locale} ${request.scope}`);
        assert.match(call.inputs, /`amount` → `value` \(`Payload`\)/u);
        assert.match(flow, /n = value\.bias.*n \+ 3/su);
        assert.match(call.effects, /선언 타입만 확인.*런타임 타입.*getter.*외부 상태\/효과 미확인|Declared types.*getters\/dispatch\/state\/effects unknown/u);
        assert.match(flow, /선언 타입만 확인|declared types only/u);
        assert.match(call.output, /정상 완료 가정|Assuming normal completion/u);
        assert.doesNotMatch([flow, call.role, call.effects].join(" "), /수수료|검증된|local preservation|지역 값 유지|\bfee\b|\bmoney\b|validated|3 =|bias = 0/iu);
        assert.ok(h.evidenceTokens.resolve(call.callerEvidence!) && h.evidenceTokens.resolve(call.calleeEvidence!));
        for (const field of ["role", "inputs", "output", "effects", "reason"] as const) assert.ok(call[field].length);
        await h.delivery.explain({ ...request, requestId: request.requestId + 10, pageIndex: 0, pageLanguage: locale });
        assert.equal(h.replies.at(-1)!.cacheHit, true); assert.equal(h.replies.at(-1)!.narrative!.flow, flow); assert.equal(h.models(), 0);
      }
    } finally { h.delivery.reset(); }
  }
});

test("opaque identity, operator, array and structural inputs remain source references rather than primitive leaf proofs", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const inputs = [["Payload", "return value;"], ["Payload", "return value + 3;"], ["자료", "return value;"],
      [language === "kotlin" ? "List<Int>" : "number[]", language === "kotlin" ? "return value.size;" : "return value.length;"]];
    if (language === "typescript") inputs.push(["{ bias: number }", "return value.bias + 3;"]);
    else inputs.push(["Payload?", "return value;"]);
    for (const [type, body] of inputs) {
      const h = await harness(language, "en", "", typedInputFixture(language, type, body));
      try {
        const callee = h.graph.nodes.find(node => node.name === "addFee")!, source = h.files[1].content;
        const site = analyzeFunctionLogic({ functionNode: h.root, sourceText: h.source }).callsites[0];
        const facts = createFunctionCallSourceReader(h.root, h.source).read(callee, source, site.range, "addFee(amount)")!;
        assert.deepEqual(facts.opaqueParameters, ["value"]); assert.equal(facts.parameterTypes[0], type);
        assert.ok(facts.bodyPaths, "identity returns cannot enter the primitive leaf recipe");
        assert.deepEqual(readFunctionCallSourceParameters(callee, source), [{ name: "value", type }]);
        await h.delivery.explain(h.explanation);
        assert.equal(h.replies.at(-1)!.status, "ready"); assert.equal(h.models(), 0);
        assert.match(h.replies.at(-1)!.narrative!.calls[0].effects, /Declared types.*unknown/u);
        assert.ok(h.replies.at(-1)!.narrative!.flow!.includes(body.replace(/^return\s+/u, "").replace(/;$/u, "")));
      } finally { h.delivery.reset(); }
    }
  }
});

test("declaration reading cannot use missing/forged type evidence, callbacks, destructuring, defaults or writes to widen source authority", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const f = await loadFunctionCallReadingFixture(language, typedInputFixture(language, "Payload", "return value;"));
    const callee = f.graph.nodes.find(node => node.name === "addFee")!, source = f.files[1].content;
    const logic = analyzeFunctionLogic({ functionNode: callee, sourceText: source });
    const tutor = analyzeFunctionTutorDeclaration({ functionNode: callee, sourceText: source, functionLogic: logic });
    assert.ok(readFunctionCallSourceDeclaredParameters(tutor));
    for (const patch of [{ declarationEvidence: [] }, { name: "{ bias }" }, { optional: true }, { rest: true },
      { typeText: "x".repeat(121) }, { typeText: "Payload`" }, { callingMode: "keyword-only" as const }]) {
      const altered = { ...tutor, parameters: [{ ...tutor.parameters[0], ...patch }] };
      assert.equal(readFunctionCallSourceDeclaredParameters(altered), undefined);
    }
    const callback = language === "kotlin" ? "(Int) -> Int" : "(n: number) => number";
    assert.equal(readFunctionCallSourceParameters(callee, source.replace("value: Payload", "value: " + callback)), undefined);
    assert.equal(readFunctionCallSourceParameters(callee, source.replace("value: Payload", "value: Payload = makePayload()")), undefined);
    for (const body of ["value = external; return value;", "value.bias = 3; return value;", "return value[getter()];", "return value?.bias;"]) {
      const h = await harness(language, "en", "", typedInputFixture(language, "Payload", body));
      try { await h.delivery.explain(h.explanation); assert.equal(h.models(), 1, body); }
      finally { h.delivery.reset(); }
    }
  }
});
