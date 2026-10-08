/** Strict source binding, cross-file reading, bounded lifecycle and cache authority tests. */
import assert from "node:assert/strict";
import test from "node:test";
import { FunctionCallsHostDelivery } from "../../webview/functionCalls";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow";
import { exampleFunctionCallScenarios } from "../../shared/functionCalls";
import { buildFunctionCallNarrativePlan, parseFunctionCallNarrative } from "../../application/functionCallNarratives";
import { validateWebviewRequest } from "../../protocol/webviewRequestValidation";
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionCallNarrativesRequest, FunctionCallNarrativesResponse } from "../../protocol/functionCallNarratives";
import type { FunctionNarrativeProvider } from "../../application/functionNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import { loadFunctionCallReadingFixture, functionCallReadingReply } from "./helpers/functionCallReadingFixture";
import { FunctionNarrativeError } from "../../shared/functionNarratives";

/** Owns real source tokens/registries while replacing only the external model boundary. */
async function harness(language: "typescript" | "kotlin" = "typescript", custom?: FunctionNarrativeProvider,
  onReply?: (reply: FunctionCallNarrativesResponse) => void) {
  const fixture = await loadFunctionCallReadingFixture(language), graphDelivery = new WebviewGraphDelivery();
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
