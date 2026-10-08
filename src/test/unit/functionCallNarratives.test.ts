/** Strict source binding, cross-file reading, bounded lifecycle and cache authority tests. */
import assert from "node:assert/strict";
import test from "node:test";
import { FunctionCallsHostDelivery } from "../../webview/functionCalls";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow";
import { exampleFunctionCallScenarios } from "../../shared/functionCalls";
import { buildFunctionCallNarrativePlan, buildFunctionCallNarrativePrompt, parseFunctionCallNarrative } from "../../application/functionCallNarratives";
import { validateWebviewRequest } from "../../protocol/webviewRequestValidation";
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionCallNarrativesRequest, FunctionCallNarrativesResponse } from "../../protocol/functionCallNarratives";
import { buildSourceFunctionNarrativeResponse, numberFunctionNarrativeContext, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import { loadFunctionCallReadingFixture, functionCallReadingReply } from "./helpers/functionCallReadingFixture";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { createFunctionCallSourceReader } from "../../analyzer/functionCalls";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { createConfiguredNarrativeProvider, type ConfiguredNarrativeApi } from "../../vscode/functionNarrativeSetup";
import { ModelTaskManager } from "../../shared/modelTasks";
import type { ManagedLocalModelCache } from "../../shared/localModels";

/** Owns real source tokens/registries while replacing only the external model boundary. */
async function harness(language: "typescript" | "kotlin" = "typescript", custom?: FunctionNarrativeProvider,
  onReply?: (reply: FunctionCallNarrativesResponse) => void, transform?: (name: string, source: string) => string) {
  const fixture = await loadFunctionCallReadingFixture(language, transform), graphDelivery = new WebviewGraphDelivery();
  const graphVersion = graphDelivery.activate(fixture.graph).snapshot.version;
  const sourceNodeTokens = new SourceNodeTokenRegistry(), evidenceTokens = new CodeFlowEvidenceTokenRegistry();
  sourceNodeTokens.activate(graphVersion, fixture.graph); evidenceTokens.activate(graphVersion, fixture.graph);
  const staticReplies: FunctionCallsResponse[] = [], replies: FunctionCallNarrativesResponse[] = [], contexts: FunctionNarrativeContext[] = [], reads: string[] = [];
  let preparations = 0;
  const provider = custom ?? { async prepare() { preparations++; }, async generate(context: FunctionNarrativeContext) { contexts.push(context); return functionCallReadingReply(context); } };
  const delivery = new FunctionCallsHostDelivery({ graphDelivery, sourceNodeTokens, evidenceTokens, provider, getLanguage: () => "en",
    async readSourceText(file) { reads.push(file); return fixture.files.find(candidate => candidate.path === file)?.content; },
    async postMessage(reply) { staticReplies.push(reply); }, async postNarratives(reply) { replies.push(reply); onReply?.(reply); await new Promise(resolve => setImmediate(resolve)); } });
  const request = { graphVersion, sourceToken: sourceNodeTokens.createToken(fixture.root.id)!, requestId: 1 };
  await delivery.load(request); const slice = staticReplies.at(-1)!;
  const explanation: FunctionCallNarrativesRequest = { ...request, contextId: slice.narratives!.contextId!, scope: "overview" };
  return { ...fixture, graphVersion, graphDelivery, sourceNodeTokens, evidenceTokens, delivery, slice, contexts, replies, reads, explanation, preparations: () => preparations };
}

for (const language of ["typescript", "kotlin"] as const) test(`${language} call reading uses real cross-file source and freezes static graph identities`, async () => {
  const h = await harness(language);
  try {
    assert.equal(h.contexts.length, 0); assert.equal(h.preparations(), 0);
    assert.deepEqual(h.slice.nodes.map(node => node.name).sort(), ["addFee", "checkout", "double", "zero"]);
    const before = JSON.stringify(h.slice);
    await h.delivery.explain(h.explanation);
    assert.equal(h.replies.at(-1)?.status, "ready"); assert.equal(h.preparations(), 1);
    assert.equal(h.contexts.length, 3); assert.equal(JSON.stringify(h.slice), before);
    assert.ok(h.contexts.at(-1)?.callTask?.calleeEvidence?.some(evidence=>evidence.code.includes("value * 2")));
    assert.ok(h.contexts.every(context => context.callTask!.targets.length <= 2 && context.snippets.length <= 5));
    assert.ok(h.contexts.some(context => context.snippets.some(snippet => snippet.role === "helper" && snippet.text.includes("value + 5"))));
    assert.ok(h.contexts.some(context => context.snippets.some(snippet => snippet.role === "helper" && snippet.text.includes("value * 2"))));
    const targets=h.contexts.flatMap(context=>context.callTask!.targets);
    assert.deepEqual(targets.find(target=>target.callee==="zero")?.arguments,[]);
    assert.deepEqual(targets.find(target=>target.callee==="addFee")?.arguments,["amount"]);
    assert.deepEqual(targets.find(target=>target.callee==="double")?.arguments,["adjusted"]);
    const zeroContext=h.contexts.find(context=>context.callTask!.targets.some(target=>target.callee==="zero"))!;
    const badInputs=JSON.parse(functionCallReadingReply(zeroContext).text);badInputs.calls[0].inputs="The enabled argument is passed to zero.";
    assert.throws(()=>parseFunctionCallNarrative(JSON.stringify(badInputs),zeroContext,"en"));
    assert.doesNotMatch(JSON.stringify(h.contexts), /\/workspace\/|source-node:|code-evidence:|function-call:/u);
    const calls = h.contexts.length;
    await h.delivery.explain({ ...h.explanation, requestId: 2, pageIndex: 0, pageLanguage: "en" });
    assert.equal(h.replies.at(-1)?.cacheHit, true); assert.equal(h.contexts.length, calls); assert.equal(h.preparations(), 1);
    await h.delivery.explain({ ...h.explanation, requestId: 3 }); assert.equal(h.contexts.length, calls);
    for (const reading of h.replies.flatMap(reply => reply.narrative?.calls ?? [])) {
      assert.ok(reading.callerEvidence && h.evidenceTokens.resolve(reading.callerEvidence));
      assert.ok(reading.calleeEvidence && h.evidenceTokens.resolve(reading.calleeEvidence));
    }
  } finally { h.delivery.reset(); }
});

test("assumed routes keep different guards, occurrences and separate cache identities", async () => {
  const h = await harness();
  try {
    const examples = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])));
    assert.equal(examples.length, 2);
    const plans = examples.map(example => buildFunctionCallNarrativePlan(h.slice, { ...h.explanation, scope: "scenario", choices: [...example.selection].map(([key,value]) => ({ key,value })) }));
    assert.deepEqual(plans.map(plan => plan.rows.length).sort(), [1,2]);
    for (let index = 0; index < examples.length; index++) await h.delivery.explain({ ...h.explanation, requestId: index + 2, scope: "scenario", choices: [...examples[index].selection].map(([key,value]) => ({ key,value })) });
    assert.equal(h.contexts.length, 2); assert.notDeepEqual(h.contexts[0].callTask?.conditions, h.contexts[1].callTask?.conditions);
    await h.delivery.explain({ ...h.explanation, requestId: 8, scope: "scenario", choices: [{ key: "foreign:branch:1", value: "true" }] });
    assert.equal(h.replies.at(-1)?.status, "invalid-response"); assert.equal(h.contexts.length, 2);
    await h.delivery.explain({ ...h.explanation, requestId: 9, scope: "call", connectionId: "function-call:" + "0".repeat(64) });
    assert.equal(h.replies.at(-1)?.status, "invalid-response"); assert.equal(h.contexts.length, 2);
  } finally { h.delivery.reset(); }
});

test("one callsite reads only its selected target and retains complete summary sentences",async()=>{
  const h=await harness();try{
    const edge=h.slice.connections.find(edge=>h.slice.nodes.find(node=>node.id===edge.to)?.name==="addFee")!;
    await h.delivery.explain({...h.explanation,requestId:2,scope:"call",connectionId:edge.id});
    assert.equal(h.contexts.length,1);assert.deepEqual(h.contexts[0].callTask?.targets.map(target=>target.callee),["addFee"]);
    assert.deepEqual(h.replies.at(-1)?.narrative?.calls.map(call=>call.connectionId),[edge.id]);
    const reply=JSON.parse(functionCallReadingReply(h.contexts[0]).text);
    reply.summary="The caller transfers its amount to the helper. This unfinished fragment";
    assert.equal(parseFunctionCallNarrative(JSON.stringify(reply),h.contexts[0],"en").summary,"The caller transfers its amount to the helper.");
  }finally{h.delivery.reset();}
});

test("cancelled call batches retain completed prose, allow cache reads and resume remaining targets", async () => {
  let invocation = 0, wait!: () => void;
  const provider: FunctionNarrativeProvider = { async generate(context,_language,signal) {
    invocation++;
    if (invocation === 2) { await new Promise<void>((resolve,reject) => { wait=resolve;signal.addEventListener("abort",()=>reject(new Error("stopped")),{once:true}); }); }
    return functionCallReadingReply(context);
  } };
  const h = await harness("typescript", provider);
  try {
    const pending = h.delivery.explain(h.explanation);
    for (let turn=0;turn<50&&!wait;turn++) await new Promise(resolve=>setImmediate(resolve));
    assert.ok(wait); assert.equal(h.replies.at(-1)?.status,"progress");
    await h.delivery.explain({ ...h.explanation, requestId: 2, pageIndex: 0, pageLanguage: "en" });
    assert.equal(invocation,2);h.delivery.cancelExplanation(h.explanation);await pending;
    assert.equal(h.replies.at(-1)?.coverage?.completed,2);
    await h.delivery.explain({ ...h.explanation, requestId: 3 });
    assert.equal(invocation,4);assert.equal(h.replies.at(-1)?.coverage?.complete,true);
  } finally { h.delivery.reset(); }
});

test("stale root and forged model slots cannot publish source-bound call readings", async () => {
  let release!: (reply: { modelName: string; text: string }) => void;
  const h = await harness("typescript", { async generate(context) { return new Promise(resolve=>{release=()=>resolve(functionCallReadingReply(context));}); } });
  const pending = h.delivery.explain(h.explanation);
  for (let turn=0;turn<50&&!release;turn++) await new Promise(resolve=>setImmediate(resolve));
  h.delivery.reset();release({modelName:"ignored",text:""});await pending;assert.equal(h.replies.length,0);
  await h.delivery.explain({...h.explanation,requestId:8});assert.equal(h.replies.at(-1)?.status,"stale");
  const bad = await harness("typescript", { async generate(context) {
    const reply=functionCallReadingReply(context),value=JSON.parse(reply.text);value.calls[0].callId="call-999";return {...reply,text:JSON.stringify(value)};
  } });
  try {await bad.delivery.explain(bad.explanation);assert.equal(bad.replies.at(-1)?.status,"invalid-response");}finally{bad.delivery.reset();}
});

test("call-reading protocol rejects source paths, unknown options and malformed cache intents", async () => {
  const h=await harness();try{
    assert.equal(validateWebviewRequest({type:"functionCalls/explain",payload:h.explanation}).ok,true);
    for(const payload of [{...h.explanation,path:"/secret"},{...h.explanation,contextId:"raw"},{...h.explanation,scope:"scenario",choices:[{key:"x",value:"true",expression:"injection"}]},
      {...h.explanation,pageLanguage:"ko"},{...h.explanation,pageIndex:128},{...h.explanation,scope:"call"}])assert.equal(validateWebviewRequest({type:"functionCalls/explain",payload}).ok,false);
    const context:FunctionNarrativeContext={functionName:"x",language:"typescript",snippets:[],limited:false,callTask:{scope:"overview",signature:"",includeSummary:true,sequence:[],conditions:[],routeStatus:"structure",sourceLimited:true,targets:[]}};
    const wrong=functionCallReadingReply(context,"ko");assert.throws(()=>parseFunctionCallNarrative(wrong.text,context,"en"));
  }finally{h.delivery.reset();}
});

test("one explicit call action retains its provider across source/publication gaps and releases it before ready; cached pages acquire no scope", async () => {
  let active = false, scopes = 0, released = 0, generated = 0;
  const provider: FunctionNarrativeProvider = {
    async withRun(_language, _signal, operation) {
      active = true; scopes++;
      try { return await operation(); }
      finally { await new Promise(resolve => setImmediate(resolve)); active = false; released++; }
    }, async generate(context, language) {
      assert.equal(active, true); generated++;
      await new Promise(resolve => setImmediate(resolve)); return functionCallReadingReply(context, language);
    }
  };
  const h = await harness("typescript", provider, reply => {
    if (reply.status === "progress") assert.equal(active, true);
    if (reply.status === "ready") assert.equal(active, false, "ready includes resource teardown, not just the final inference");
  });
  try {
    await h.delivery.explain(h.explanation);
    assert.equal(scopes, 1); assert.equal(released, 1); assert.equal(generated, 3);
    // Publication errors are caught by the Host: assert its final status too,
    // so an observer assertion swallowed as a failed action cannot pass.
    assert.equal(h.replies.at(-1)!.status, "ready");
    assert.equal(h.replies.at(-1)!.coverage!.complete, true);
    await h.delivery.explain({ ...h.explanation, requestId: 2, pageIndex: 0, pageLanguage: "en" });
    assert.equal(scopes, 1); assert.equal(generated, 3); assert.equal(h.replies.at(-1)!.cacheHit, true);
  } finally { h.delivery.reset(); }
});

test("cancellation or a provider failure during final cleanup cannot publish a successful call action", async () => {
  for (const cancel of [false, true]) {
    let startCleanup!: () => void, release!: () => void;
    const cleaning = new Promise<void>(resolve => { startCleanup = resolve; });
    const provider: FunctionNarrativeProvider = { async withRun(_language, _signal, operation) {
      const result = await operation(); startCleanup(); await new Promise<void>(resolve => { release = resolve; });
      if (!cancel) throw new FunctionNarrativeError("unavailable", "scope-fixture");
      return result;
    }, async generate(context, language) { return functionCallReadingReply(context, language); } };
    const h = await harness("typescript", provider);
    try {
      const pending = h.delivery.explain(h.explanation); await cleaning;
      assert.equal(h.replies.some(reply => reply.status === "ready"), false);
      if (cancel) h.delivery.cancelExplanation(h.explanation);
      release(); await pending;
      assert.equal(h.replies.some(reply => reply.status === "ready"), false);
      assert.equal(h.replies.at(-1)!.status, cancel ? "cancelled" : "unavailable");
    } finally { h.delivery.reset(); }
  }
});

test("parser-bound TS/Kotlin call details and complete guarded flows remove model requests without losing transfers, uses, guards or authority", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const contexts: FunctionNarrativeContext[] = [], sourceReplies: string[] = []; let modelCalls = 0;
    const provider: FunctionNarrativeProvider = { async generate(context, locale) {
      contexts.push(context);
      const source = buildSourceFunctionNarrativeResponse(context, locale);
      if (source) { sourceReplies.push(source.text); return source; }
      modelCalls++; return functionCallReadingReply(context, locale);
    } };
    const h = await harness(language, provider);
    try {
      await h.delivery.explain(h.explanation);
      assert.equal(h.replies.at(-1)!.status, "ready"); assert.equal(modelCalls, 0); assert.equal(sourceReplies.length, 3);
      const calls = sourceReplies.flatMap(text => JSON.parse(text).calls);
      assert.deepEqual(calls.map(call => call.callId), ["call-1", "call-2", "call-3"]);
      assert.match(calls[0].output, /returns it directly from the parent/u);
      assert.match(calls[1].inputs, /`amount` → `value`/u); assert.match(calls[1].output, /`value \+ 5`.*local `adjusted`/u);
      assert.match(calls[1].output, /not the parent's final return/u);
      assert.match(calls[2].inputs, /`adjusted` → `value`/u); assert.match(calls[2].output, /`value \* 2`.*directly from the parent/u);
      assert.match(calls[0].reason, /`!enabled` = true/u); assert.match(calls[1].reason, /`!enabled` = false/u);
      assert.ok(calls.every(call => /no writes or explicit calls/u.test(call.effects)));
      for (const context of contexts.slice(0, 2)) {
        const ko = buildSourceFunctionNarrativeResponse(context, "ko")!;
        assert.ok(ko); assert.equal(ko.modelName, "소스 분석");
        assert.equal(numberFunctionNarrativeContext(context).sourceCallReadings, undefined);
        assert.doesNotMatch(buildFunctionCallNarrativePrompt(context, "en").join("\n"), /sourceCallReadings|sourceFingerprint/u);
        const source = context.snippets[0].text; context.snippets[0].text += "\nchanged";
        assert.equal(buildSourceFunctionNarrativeResponse(context, "en"), undefined); context.snippets[0].text = source;
      }
      const whole = JSON.parse(buildSourceFunctionNarrativeResponse(contexts.at(-1)!, "en")!.text);
      assert.match(whole.summary, /`!enabled`.*`zero\(\)`.*`addFee\(amount\)`.*`adjusted`.*`double\(adjusted\)`/u);
      assert.match(whole.flow, /`value \+ 5`.*`value \* 2`/u); assert.deepEqual(whole.limitations, []);
      assert.equal(numberFunctionNarrativeContext(contexts.at(-1)!).sourceCallFlowProof, undefined);
      await h.delivery.explain({ ...h.explanation, requestId: 2, pageIndex: 1, pageLanguage: "en" });
      assert.equal(modelCalls, 0); assert.equal(h.replies.at(-1)!.cacheHit, true);
      assert.ok(h.replies.at(-1)!.narrative!.calls.every(call => call.callerEvidence && call.calleeEvidence));
    } finally { h.delivery.reset(); }
  }
});

test("source call facts reject external writes, unsupported syntax and setup/default/rest parameters", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const fixture = await loadFunctionCallReadingFixture(language), callee = fixture.graph.nodes.find(node => node.name === "addFee")!;
    const helper = fixture.files.find(file => file.path === callee.filePath)!.content;
    const site = analyzeFunctionLogic({ functionNode: fixture.root, sourceText: fixture.source }).callsites.find(site => site.calleeName === "addFee")!;
    const reader = createFunctionCallSourceReader(fixture.root, fixture.source);
    assert.ok(reader.read(callee, helper, site.range, "addFee(amount)"));
    const returned = language === "kotlin" ? "return value + 5" : "return value + 5;";
    const variants = ["captured += value; return value", "return captured[getter()]", "return service?.helper(value)", "return ++value", "return [value]",
      "eval(value); return value", "Function(value); return value",
      language === "kotlin" ? "value += 1; return value" : "value += 1; return value;"];
    if (language === "kotlin") variants.push('return "${value++}"');
    for (const replacement of variants) assert.equal(reader.read(callee, helper.replace(returned, replacement), site.range, "addFee(amount)"), undefined, replacement);
    const type = language === "kotlin" ? "value: Int" : "value: number";
    assert.equal(reader.read(callee, helper.replace(type, type + " = 5"), site.range, "addFee(amount)"), undefined);
    assert.equal(reader.read(callee, helper.replace(type, language === "kotlin" ? "vararg value: Int" : "...value: number[]"), site.range, "addFee(amount)"), undefined);
    const nullable = reader.read(callee, helper.replace(type, language === "kotlin" ? "value: Int?" : "value: number | null"), site.range, "addFee(amount)")!;
    assert.deepEqual(nullable.opaqueParameters, ["value"]); assert.ok(nullable.bodyPaths);
    assert.equal(reader.read(callee, helper, site.range, "addFee(amount) + 1"), undefined, "a larger caller calculation is not a direct return/storage use");
    const shifted = fixture.source.replace(language === "kotlin" ? "fun checkout" : "export function checkout",
      language === "kotlin" ? "suspend fun checkout" : "export async function checkout");
    const shiftedSite = analyzeFunctionLogic({ functionNode: fixture.root, sourceText: shifted }).callsites.find(site => site.calleeName === "addFee")!;
    const asynchronous = createFunctionCallSourceReader(fixture.root, shifted).read(callee, helper, shiftedSite.range, "addFee(amount)")!;
    assert.equal(asynchronous.callerExecution, language === "kotlin" ? "suspend" : "promise");
    assert.equal(asynchronous.execution, undefined, "a synchronous callee retains its own return contract");
    assert.equal(reader.read(callee, helper, site.range, "new addFee(amount)"), undefined);
    assert.equal(reader.read(callee, helper, site.range, "addFee.call(null, amount)"), undefined);
  }
});

test("callee formal types bind model inputs even when optional receiver calls keep the reading with the model", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const body = language === "kotlin" ? "val n = service?.audit(value); return n + 3" : "const n = service?.audit(value); return n + 3;";
    const h = await harness(language, undefined, undefined, (name, source) => name === "readingHelpers"
      ? source.replace(language === "kotlin" ? "return value + 5" : "return value + 5;", body) : source);
    try {
      const edge = h.slice.connections.find(edge => h.slice.nodes.find(node => node.id === edge.to)?.name === "addFee")!;
      await h.delivery.explain({ ...h.explanation, requestId: 2, scope: "call", connectionId: edge.id });
      const context = h.contexts[0], target = context.callTask!.targets[0], call = h.replies.at(-1)!.narrative!.calls[0];
      assert.deepEqual(target.parameters, [{ name: "value", type: language === "kotlin" ? "Int" : "number" }]);
      assert.match(call.inputs, /`amount` → `value`/u); assert.equal(h.replies.at(-1)!.modelName, "External model fixture");
      assert.equal(buildSourceFunctionNarrativeResponse(context, "en"), undefined);
      const changed = JSON.parse(functionCallReadingReply(context).text); changed.calls[0].inputs = "Wrong parameter.";
      assert.throws(() => parseFunctionCallNarrative(JSON.stringify(changed), context, "en"), /invalid-response/u);
    } finally { h.delivery.reset(); }
  }
});

test("declaration-line graph extents retain parser-owned caller and callee bodies for source reading", async () => {
  let fallbackCalls = 0;
  const contexts: FunctionNarrativeContext[] = [];
  const provider: FunctionNarrativeProvider = { async generate(context, language) {
    contexts.push(context);
    const source = buildSourceFunctionNarrativeResponse(context, language);
    if (source) return source;
    fallbackCalls++; return functionCallReadingReply(context, language);
  } };
  const h = await harness("typescript", provider);
  try {
    // Reproduce the production native graph's declaration-header-only extents;
    // selection anchors and graph identities remain exact and unchanged.
    for (const node of h.graph.nodes.filter(node => node.kind === "function")) {
      const source = h.files.find(file => file.path === node.filePath)!.content;
      const header = source.split("\n")[node.range.startLine];
      node.range = { ...node.range, endLine: node.range.startLine, endCharacter: header.indexOf("{") + 1 };
    }
    await h.delivery.explain(h.explanation);
    assert.equal(h.replies.at(-1)!.status, "ready"); assert.equal(fallbackCalls, 0);
    assert.equal(contexts.length, 3);
    assert.match(contexts[0].snippets.find(snippet => snippet.role === "function")!.text, /return double\(adjusted\)/u);
    assert.match(contexts[0].snippets.find(snippet => snippet.id === "call-2-callee")!.text, /return value \+ 5/u);
    assert.match(h.replies.at(-1)!.narrative!.flow!, /`value \+ 5`.*`value \* 2`/u);
  } finally { h.delivery.reset(); }
});

test("complete native call source recipes need no runtime, weights, download, factory, notification or model task", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const manager = new ModelTaskManager(); let downloads = 0, factories = 0, notifications = 0;
    const config: Record<string, string> = { provider: "local", localBinary: "/missing/llama-completion", localModel: "/missing/model.gguf" };
    const api = { workspace: { getConfiguration() { return { get(key: string, fallback: string) { return config[key] ?? fallback; } }; } },
      ProgressLocation: { Notification: 15 }, window: { async withProgress() { notifications++; throw new Error("unexpected-notification"); },
        async showErrorMessage() { notifications++; }, async showQuickPick() { throw new Error("unexpected-selection"); } },
      lm: { async selectChatModels() { throw new Error("unexpected-selection"); } },
      LanguageModelChatMessage: { User(content: string) { return { content }; } } } as unknown as ConfiguredNarrativeApi;
    const models: ManagedLocalModelCache = { model: { id: "fixture", name: "Fixture", fileName: "fixture.gguf", url: "https://example.invalid",
      bytes: 1, sha256: "a".repeat(64) }, async ensure() { downloads++; throw new Error("unexpected-download"); }, dispose() {} };
    const provider = createConfiguredNarrativeProvider(api, models, () => { factories++; throw new Error("unexpected-factory"); }, manager);
    const h = await harness(language, provider);
    try {
      await h.delivery.explain(h.explanation);
      assert.equal(h.replies.at(-1)!.status, "ready"); assert.equal(h.replies.at(-1)!.modelName, "Source analysis");
      assert.equal(h.replies.at(-1)!.coverage!.complete, true);
      await h.delivery.explain({ ...h.explanation, requestId: 2, pageIndex: 1, pageLanguage: "en" });
      assert.equal(h.replies.at(-1)!.cacheHit, true);
      let requestId = 10;
      for (const connection of h.slice.connections) await h.delivery.explain({ ...h.explanation, requestId: requestId++, scope: "call", connectionId: connection.id });
      for (const example of exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])))) {
        await h.delivery.explain({ ...h.explanation, requestId: requestId++, scope: "scenario",
          choices: [...example.selection].map(([key, value]) => ({ key, value })) });
        assert.equal(h.replies.at(-1)!.modelName, "Source analysis");
      }
      const serial = language === "kotlin" ? "fun checkout(amount: Int): Int { val a = addFee(amount); val b = double(a); return addFee(b) }"
        : 'import { addFee, double } from "./readingHelpers";\nexport function checkout(amount: number): number { const a = addFee(amount); const b = double(a); return addFee(b); }';
      const more = await harness(language, provider, undefined, (name, original) => name === "reading" ? serial : original);
      try {
        await more.delivery.explain(more.explanation);
        assert.equal(more.replies.at(-1)!.modelName, "Source analysis");
        assert.equal(more.replies.at(-1)!.coverage!.completed, 3);
        assert.match(more.replies.at(-1)!.narrative!.flow!, /`value \+ 5`.*`value \* 2`.*`value \+ 5`/u);
      } finally { more.delivery.reset(); }
      assert.equal(downloads, 0); assert.equal(factories, 0); assert.equal(notifications, 0);
      assert.deepEqual(manager.snapshot().history, []);
    } finally { h.delivery.reset(); await manager.dispose(); }
  }
});

for (const language of ["typescript", "kotlin"] as const) test(`${language} source summaries cover all isolated calls and complete selected routes in both languages`, async () => {
  let modelCalls = 0;
  const contexts: FunctionNarrativeContext[] = [];
  const provider: FunctionNarrativeProvider = { async generate(context, locale) {
    contexts.push(context); const source = buildSourceFunctionNarrativeResponse(context, locale);
    if (source) return source; modelCalls++; return functionCallReadingReply(context, locale);
  } };
  const h = await harness(language, provider);
  try {
    const graph = JSON.stringify(h.slice);
    let requestId = 1;
    for (const connection of h.slice.connections) {
      await h.delivery.explain({ ...h.explanation, requestId: ++requestId, scope: "call", connectionId: connection.id });
      const ready = h.replies.at(-1)!;
      assert.equal(ready.status, "ready"); assert.equal(ready.modelName, "Source analysis");
      assert.equal(ready.narrative!.calls.length, 1);
      assert.match(ready.narrative!.summary!, /Selected callsite:/u);
      assert.equal(Object.keys(ready.narrative!.calls[0]).filter(key => ["role", "inputs", "output", "effects", "reason"].includes(key)).length, 5);
      assert.ok(ready.narrative!.calls[0].callerEvidence && ready.narrative!.calls[0].calleeEvidence);
      const context = contexts.at(-1)!;
      const ko = JSON.parse(buildSourceFunctionNarrativeResponse(context, "ko")!.text);
      assert.match(ko.summary, /선택한 호출부/u); assert.match(ko.flow, /실제 실행 효과는 관찰하지 않았/u);
      const original = context.callTask!.scope; context.callTask!.scope = "overview";
      assert.equal(buildSourceFunctionNarrativeResponse(context, "en"), undefined, "changing scope cannot reuse source authority");
      context.callTask!.scope = original;
      const before = contexts.length;
      await h.delivery.explain({ ...h.explanation, requestId: ++requestId, scope: "call", connectionId: connection.id, pageIndex: 0, pageLanguage: "en" });
      assert.equal(contexts.length, before); assert.equal(h.replies.at(-1)!.cacheHit, true);
    }
    const examples = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])));
    assert.equal(examples.length, 2);
    for (const example of examples) {
      const selected = { ...h.explanation, requestId: ++requestId, scope: "scenario" as const,
        choices: [...example.selection].map(([key, value]) => ({ key, value })) };
      await h.delivery.explain(selected);
      const ready = h.replies.at(-1)!;
      assert.equal(ready.status, "ready"); assert.equal(ready.modelName, "Source analysis");
      assert.equal(ready.narrative!.calls.length, example.trace.callIds.length);
      assert.match(ready.narrative!.summary!, /Selected source route:/u);
      assert.match(ready.narrative!.flow!, /source-route assumptions; runtime effects are unobserved/u);
      if (example.trace.callIds.length === 2) {
        assert.match(ready.narrative!.flow!, /`amount` → `value`.*`value \+ 5`.*local `adjusted`.*`adjusted` → `value`.*`value \* 2`.*parent return/u);
        assert.doesNotMatch(ready.narrative!.summary!, /zero\(\)/u);
      } else assert.match(ready.narrative!.flow!, /`!enabled` = true.*`zero\(\)`.*`0`.*parent return/u);
      assert.ok(buildSourceFunctionNarrativeResponse(contexts.at(-1)!, "ko"));
    }
    assert.equal(modelCalls, 0); assert.equal(JSON.stringify(h.slice), graph);
  } finally { h.delivery.reset(); }
});

for (const language of ["typescript", "kotlin"] as const) test(`${language} small source structures retain every local change and branches including routes without calls`, async () => {
  let modelCalls = 0;
  const provider: FunctionNarrativeProvider = { async generate(context, locale) {
    const source = buildSourceFunctionNarrativeResponse(context, locale);
    if (source) return source; modelCalls++; return functionCallReadingReply(context, locale);
  } };
  const ko = language === "kotlin", prefix = ko ? "" : 'import { addFee, double } from "./readingHelpers";\n';
  const signature = ko ? "fun checkout(enabled: Boolean, amount: Int): Int" : "export function checkout(enabled: boolean, amount: number): number";
  const source = prefix + signature + " {\n  if (!enabled) return 0" + (ko ? "" : ";") + "\n  "
    + (ko ? "val" : "const") + " adjusted = addFee(amount)" + (ko ? "" : ";") + "\n  return adjusted" + (ko ? "" : ";") + "\n}";
  const h = await harness(language, provider, undefined, (name, original) => name === "reading" ? source : original);
  try {
    await h.delivery.explain(h.explanation);
    assert.equal(h.replies.at(-1)!.modelName, "Source analysis");
    assert.match(h.replies.at(-1)!.narrative!.summary!, /`!enabled` = true.*return `0`.*`!enabled` = false.*local `adjusted`.*return `adjusted`/u);
    const examples = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])));
    const empty = examples.find(example => example.trace.callIds.length === 0)!; assert.ok(empty);
    await h.delivery.explain({ ...h.explanation, requestId: 2, scope: "scenario", choices: [...empty.selection].map(([key, value]) => ({ key, value })) });
    assert.equal(h.replies.at(-1)!.modelName, "Source analysis"); assert.equal(h.replies.at(-1)!.narrative!.calls.length, 0);
    assert.match(h.replies.at(-1)!.narrative!.flow!, /`!enabled` = true.*Return expression `0`/u);
    assert.equal(modelCalls, 0);
  } finally { h.delivery.reset(); }
});

test("source call summaries keep hidden argument effects, unproved parent work and loops with the model", async () => {
  const bodies = [
    "const adjusted = addFee(readAmount()); return adjusted;",
    "const adjusted = addFee(amount++); return adjusted;",
    "audit(amount); const adjusted = addFee(amount); return adjusted;",
    "while (amount > 0) { const adjusted = addFee(amount); } return amount;"
  ];
  for (const body of bodies) {
    let models = 0;
    const provider: FunctionNarrativeProvider = { async generate(context, locale) {
      const source = buildSourceFunctionNarrativeResponse(context, locale);
      if (source) return source; models++; return functionCallReadingReply(context, locale);
    } };
    const h = await harness("typescript", provider, undefined, (name, original) => name === "reading"
      ? 'import { addFee } from "./readingHelpers";\nexport function checkout(amount: number): number { ' + body + " }" : original);
    try { await h.delivery.explain(h.explanation); assert.ok(models > 0, body); assert.equal(h.replies.at(-1)!.status, "ready"); }
    finally { h.delivery.reset(); }
  }
});

test("Kotlin CFG predicate spans suppress duplicate guards without conflating equal text at different source positions", async () => {
  const bodies = [
    "if (enabled && amount > 0) return zero(); val adjusted = addFee(amount); return double(adjusted)",
    "var result = 0; if (enabled) result = addFee(amount); if (enabled) result = double(result); return result"
  ];
  for (const [index, body] of bodies.entries()) {
    const source = "fun checkout(enabled: Boolean, amount: Int): Int { " + body + " }\nfun zero(): Int { return 0 }\n";
    const h = await harness("kotlin", undefined, undefined, (name, original) => name === "reading" ? source : original);
    try {
      assert.ok(h.slice.control!.blocks.flatMap(block => block.calls).every(call => call.guards.length === 0));
      const examples = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])));
      assert.equal(examples.length, index === 0 ? 3 : 4);
      assert.ok(examples.every(example => example.trace.decisions.length <= 2));
      if (index === 1) {
        const two = examples.find(example => example.trace.callIds.length === 2)!;
        assert.equal(two.trace.decisions.length, 2);
        assert.notEqual(two.trace.decisions[0].key, two.trace.decisions[1].key);
      }
    } finally { h.delivery.reset(); }
  }
});

test("source summaries retain inferred target qualifications in isolated call and connected flow", async () => {
  const provider: FunctionNarrativeProvider = { async generate(context, language) {
    const source = buildSourceFunctionNarrativeResponse(context, language); assert.ok(source); return source;
  } };
  const h = await harness("typescript", provider);
  try {
    const edge = h.slice.connections.find(connection => h.slice.nodes.find(node => node.id === connection.to)?.name === "addFee")!;
    edge.confidence = "inferred";
    await h.delivery.explain({ ...h.explanation, scope: "call", connectionId: edge.id });
    const ready = h.replies.at(-1)!;
    assert.match(ready.narrative!.summary!, /^If the inferred candidates are selected,/u);
    assert.match(ready.narrative!.flow!, /^If the inferred candidates are selected,/u);
    assert.equal(ready.narrative!.calls[0].confidence, "inferred");
    assert.match(ready.narrative!.calls[0].output, /If this candidate is selected/u);
  } finally { h.delivery.reset(); }
});

test("complete source routes preserve ordinary local initialization and updates before a call", async () => {
  const provider: FunctionNarrativeProvider = { async generate(context, language) {
    const source = buildSourceFunctionNarrativeResponse(context, language); assert.ok(source); return source;
  } };
  const source = 'import { addFee } from "./readingHelpers";\nexport function checkout(amount: number): number { let input = amount + 1; input *= 2; return addFee(input); }';
  const h = await harness("typescript", provider, undefined, (name, original) => name === "reading" ? source : original);
  try {
    await h.delivery.explain(h.explanation);
    const ready = h.replies.at(-1)!;
    assert.equal(ready.modelName, "Source analysis");
    assert.match(ready.narrative!.flow!, /Local change `let input = amount \+ 1`.*Local change `input \*= 2`.*`input` → `value`.*`value \+ 5`.*parent return/u);
  } finally { h.delivery.reset(); }
});

test("complete symbolic source summaries without calls retain Promise and suspend contracts without model generation", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    let models = 0;
    const provider: FunctionNarrativeProvider = { async generate(context, locale) {
      const source = buildSourceFunctionNarrativeResponse(context, locale);
      if (source) return source; models++; return functionCallReadingReply(context, locale);
    } };
    const source = language === "kotlin" ? "suspend fun checkout(): Int { return 0 }" : "export async function checkout(): Promise<number> { return 0; }";
    const h = await harness(language, provider, undefined, (name, original) => name === "reading" ? source : original);
    try {
      await h.delivery.explain(h.explanation); assert.equal(models, 0); assert.equal(h.replies.at(-1)!.status, "ready");
      assert.match(h.replies.at(-1)!.narrative!.flow!, language === "kotlin" ? /suspend.*completion.*cancel.*unknown/iu : /Promise.*fulfillment.*throw.*unknown/u);
    }
    finally { h.delivery.reset(); }
  }
});

for (const language of ["typescript", "kotlin"] as const) test(`${language} three-call serial structure and selected route reuse certified batches without dropping fields`, async () => {
  let models = 0;
  const contexts: FunctionNarrativeContext[] = [];
  const provider: FunctionNarrativeProvider = { async generate(context, locale) {
    contexts.push(context); const source = buildSourceFunctionNarrativeResponse(context, locale);
    if (source) return source; models++; return functionCallReadingReply(context, locale);
  } };
  const body = language === "kotlin" ? "fun checkout(amount: Int): Int { val a = addFee(amount); val b = double(a); return addFee(b) }"
    : 'import { addFee, double } from "./readingHelpers";\nexport function checkout(amount: number): number { const a = addFee(amount); const b = double(a); return addFee(b); }';
  const h = await harness(language, provider, undefined, (name, original) => name === "reading" ? body : original);
  try {
    const staticGraph = JSON.stringify(h.slice);
    const examples = exampleFunctionCallScenarios(h.slice.control, new Map(h.slice.connections.map(edge => [edge.id, edge])));
    const selected = { ...h.explanation, requestId: 10, scope: "scenario" as const, choices: [...examples[0].selection].map(([key, value]) => ({ key, value })) };
    for (const request of [h.explanation, selected]) {
      await h.delivery.explain(request);
      const ready = h.replies.at(-1)!;
      assert.equal(ready.status, "ready"); assert.equal(ready.modelName, "Source analysis"); assert.equal(ready.coverage!.completed, 3);
      assert.match(ready.narrative!.flow!, /`amount` → `value`.*`value \+ 5`.*local `a`.*`a` → `value`.*`value \* 2`.*local `b`.*`b` → `value`.*`value \+ 5`.*parent return/u);
      const final = contexts.at(-1)!;
      assert.equal(final.sourceCallFlowProof!.batches!.length, 2);
      assert.ok(buildSourceFunctionNarrativeResponse(final, "ko"));
      assert.equal(numberFunctionNarrativeContext(final).sourceCallFlowProof, undefined);
      assert.doesNotMatch(buildFunctionCallNarrativePrompt(final, "en").join("\n"), /sourceCallFlowProof|"batches"|function-call-source-proof/u);
      const batches = final.sourceCallFlowProof!.batches!;
      final.sourceCallFlowProof!.batches = batches.map(() => ({ kind: "function-call-source-proof" as const }));
      assert.equal(buildSourceFunctionNarrativeResponse(final, "en"), undefined, "a serialized-looking record is not proof identity");
      final.sourceCallFlowProof!.batches = [batches[0], batches[0]];
      assert.equal(buildSourceFunctionNarrativeResponse(final, "en"), undefined, "duplicate proof coverage is rejected");
      final.sourceCallFlowProof!.batches = batches;
      const generated = contexts.length;
      const calls = [];
      for (let pageIndex = 0; pageIndex < 2; pageIndex++) {
        await h.delivery.explain({ ...request, requestId: 20 + pageIndex, pageIndex, pageLanguage: "en" });
        calls.push(...h.replies.at(-1)!.narrative!.calls);
      }
      assert.equal(contexts.length, generated); assert.equal(calls.length, 3);
      assert.ok(calls.every(call => [call.role, call.inputs, call.output, call.effects, call.reason].every(field => field.length > 0)));
      assert.ok(calls.every(call => call.callerEvidence && call.calleeEvidence));
    }
    assert.equal(models, 0); assert.equal(JSON.stringify(h.slice), staticGraph);
    const overview = contexts.find(context => context.sourceCallFlowProof && context.callTask!.scope === "overview")!;
    const scenario = contexts.find(context => context.sourceCallFlowProof && context.callTask!.scope === "scenario")!;
    const old = scenario.sourceCallFlowProof!.batches;
    scenario.sourceCallFlowProof!.batches = overview.sourceCallFlowProof!.batches;
    assert.equal(buildSourceFunctionNarrativeResponse(scenario, "en"), undefined, "different scopes cannot lend proof");
    scenario.sourceCallFlowProof!.batches = old;
    const detail = contexts.find(context => context.callTask!.targets.length > 0)!;
    detail.callTask!.targets[0].arguments![0] = "changed-after-capture";
    assert.ok(buildSourceFunctionNarrativeResponse(scenario, "en"), "later context mutation cannot modify captured symbolic facts");
  } finally { h.delivery.reset(); }
});

test("multi-batch source proof keeps full callee knowledge when the separate model excerpt is truncated", async () => {
  let models = 0;
  const contexts: FunctionNarrativeContext[] = [];
  const provider: FunctionNarrativeProvider = { async generate(context, language) {
    contexts.push(context); const source = buildSourceFunctionNarrativeResponse(context, language);
    if (source) return source; models++; return functionCallReadingReply(context, language);
  } };
  const body = 'import { addFee, double } from "./readingHelpers";\nexport function checkout(amount: number): number { const a = addFee(amount); const b = double(a); return addFee(b); }';
  const h = await harness("typescript", provider, undefined, (name, original) => name === "reading" ? body
    : original.replace("return value + 5;", " ".repeat(500) + "return value + 5;"));
  try {
    await h.delivery.explain(h.explanation);
    const final = contexts.at(-1)!;
    assert.ok(final.callTask!.calleeEvidence!.some(evidence => evidence.truncated));
    assert.equal(h.replies.at(-1)!.modelName, "Source analysis"); assert.equal(models, 0);
    assert.match(h.replies.at(-1)!.narrative!.flow!, /`value \+ 5`.*`value \* 2`.*`value \+ 5`/u);
    assert.equal(h.replies.at(-1)!.coverage!.sourceLimited, true, "existing excerpt/graph limitation metadata remains explicit");
  } finally { h.delivery.reset(); }
});

test("model-looking source prose and unproved parent effects cannot authorize the multi-batch final source summary", async () => {
  for (const parentEffect of [false, true]) {
    let models = 0;
    const contexts: FunctionNarrativeContext[] = [];
    const provider: FunctionNarrativeProvider = { async generate(context, language) {
      contexts.push(context); const source = buildSourceFunctionNarrativeResponse(context, language);
      if (!context.callTask!.includeSummary && source) {
        if (parentEffect) return source;
        const data = JSON.parse(source.text); data.calls[0].role += " Changed by the model.";
        return { modelName: "Source analysis", text: JSON.stringify(data) };
      }
      if (source) return source; models++; return functionCallReadingReply(context, language);
    } };
    const body = 'import { addFee, double } from "./readingHelpers";\nexport function checkout(amount: number): number { '
      + (parentEffect ? "audit(amount); " : "") + "const a = addFee(amount); const b = double(a); return addFee(b); }";
    const h = await harness("typescript", provider, undefined, (name, original) => name === "reading" ? body : original);
    try {
      await h.delivery.explain(h.explanation);
      assert.equal(models, 1); assert.equal(h.replies.at(-1)!.status, "ready");
      const final = contexts.at(-1)!;
      assert.equal(buildSourceFunctionNarrativeResponse(final, "en"), undefined);
      if (!parentEffect) assert.equal(final.sourceCallFlowProof, undefined);
    } finally { h.delivery.reset(); }
  }
});

test("large certified call structures keep every detail and use the model when summary budgets or proof limits are exceeded", async () => {
  for (const count of [8, 10]) {
    let models = 0;
    const contexts: FunctionNarrativeContext[] = [];
    const provider: FunctionNarrativeProvider = { async generate(context, language) {
      contexts.push(context); const source = buildSourceFunctionNarrativeResponse(context, language);
      if (source) return source; models++; return functionCallReadingReply(context, language);
    } };
    const statements = Array.from({ length: count - 1 }, (_, index) => `const v${index} = addFee(${index ? "v" + (index - 1) : "amount"});`).join(" ");
    const body = 'import { addFee } from "./readingHelpers";\nexport function checkout(amount: number): number { '
      + statements + ` return addFee(v${count - 2}); }`;
    const h = await harness("typescript", provider, undefined, (name, original) => name === "reading" ? body : original);
    try {
      await h.delivery.explain(h.explanation);
      assert.equal(h.replies.at(-1)!.status, "ready"); assert.equal(models, 1);
      assert.ok(contexts.at(-1)!.sourceCallFlowProof!.batches!.length <= 4);
      const calls = [];
      for (let pageIndex = 0; pageIndex < Math.ceil(count / 2); pageIndex++) {
        await h.delivery.explain({ ...h.explanation, requestId: 2 + pageIndex, pageIndex, pageLanguage: "en" });
        calls.push(...h.replies.at(-1)!.narrative!.calls);
      }
      assert.equal(calls.length, count);
      assert.ok(calls.every(call => /`value \+ 5`/u.test(call.output)));
      assert.ok(calls.every(call => call.callerEvidence && call.calleeEvidence));
    } finally { h.delivery.reset(); }
  }
});
