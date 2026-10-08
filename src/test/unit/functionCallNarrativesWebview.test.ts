/** Production call-mode UI integration with real static graphs and an explicitly synthetic model boundary. */
import assert from "node:assert/strict";
import test from "node:test";
import { loadFunctionCallReadingFixture, functionCallReadingReply } from "./helpers/functionCallReadingFixture";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";
import { FunctionCallsHostDelivery } from "../../webview/functionCalls";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow";
import { getFunctionVisualizerHtml } from "../../webview/functionVisualizer/functionVisualizerHtml";
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionCallNarrativesRequest, FunctionCallNarrativesResponse } from "../../protocol/functionCallNarratives";

test("call-mode generation, cached selection, source actions and locale retain the static choices", async () => {
  const f = await loadFunctionCallReadingFixture("kotlin"), graphDelivery = new WebviewGraphDelivery();
  const graphVersion = graphDelivery.activate(f.graph).snapshot.version;
  const sourceNodeTokens = new SourceNodeTokenRegistry(), evidenceTokens = new CodeFlowEvidenceTokenRegistry();
  sourceNodeTokens.activate(graphVersion,f.graph);evidenceTokens.activate(graphVersion,f.graph);
  const staticReplies:FunctionCallsResponse[]=[],replies:FunctionCallNarrativesResponse[]=[];let calls=0;
  const delivery=new FunctionCallsHostDelivery({graphDelivery,sourceNodeTokens,evidenceTokens,getLanguage:()=>"en",
    readSourceText:async file=>f.files.find(candidate=>candidate.path===file)?.content,
    postMessage:async reply=>{staticReplies.push(reply);},postNarratives:async reply=>{replies.push(reply);},
    provider:{async generate(context){calls++;return functionCallReadingReply(context);}}});
  const runtime=installSidebarWebviewRuntime();
  try{
    const script=getFunctionVisualizerHtml({webview:{cspSource:"vscode-webview:"} as never,nonce:"call-read-test",language:"en"}).match(/<script nonce="call-read-test">([\s\S]*)<\/script>/u)?.[1];assert.ok(script);new Function(script)();
    runtime.dispatchMessage({type:"functionVisualizer/sessionLoaded",payload:{graphVersion,root:{sourceToken:sourceNodeTokens.createToken(f.root.id)!,label:f.root.name}}});
    runtime.click("function-mode-calls");const load=runtime.messages.at(-1);assert.equal(load?.type,"functionCalls/load");
    await delivery.load(load!.payload as never);runtime.dispatchMessage({type:"functionCalls/loaded",payload:staticReplies.at(-1)!});
    assert.equal(calls,0);assert.equal(runtime.countRenderedByClass("function-calls","calls-reading"),1);
    const choices=runtime.getRenderedText("function-calls").filter(text=>text.includes("!enabled"));
    runtime.clickRenderedByClassNth("function-calls","calls-reading-request",0);
    const request=runtime.messages.at(-1);assert.equal(request?.type,"functionCalls/explain");assert.equal((request!.payload as FunctionCallNarrativesRequest).scope,"scenario");
    runtime.focusRenderedByClassNth("function-calls","calls-reading-cancel",0);
    const focused=runtime.getFocusedElementId();
    runtime.dispatchMessage({type:"functionCalls/explanationLoaded",payload:{...request!.payload as FunctionCallNarrativesRequest,status:"working",task:{id:"model-task:2",kind:"inference",phase:"queued",position:2,waiting:2}}});
    assert.ok(runtime.getRenderedText("function-calls").some(text=>text.includes("position 2")));assert.equal(runtime.getFocusedElementId(),focused);assert.equal(calls,0);
    runtime.dispatchMessage({type:"functionCalls/explanationLoaded",payload:{...request!.payload as FunctionCallNarrativesRequest,status:"working",task:{id:"model-task:1",kind:"inference",phase:"running",position:0,waiting:0}}});
    assert.ok(runtime.getRenderedText("function-calls").some(text=>text.includes("position 2")),"an older operation cannot replace the current queued state");
    await delivery.explain(request!.payload as FunctionCallNarrativesRequest);replies.forEach(payload=>runtime.dispatchMessage({type:"functionCalls/explanationLoaded",payload}));
    assert.equal(calls,1);assert.equal(runtime.countRenderedByClass("function-calls","calls-reading-facts"),1);
    assert.ok(runtime.getRenderedText("function-calls").some(text=>text.includes("Caller arguments bind")));
    const before=runtime.messages.filter(message=>message.type==="functionCalls/explain").length;
    runtime.selectRenderedByClassNth("function-calls","calls-reading-select",0,"1");assert.equal(calls,1);
    runtime.dispatchMessage({type:"ui/language",payload:{language:"ko"}});
    assert.ok(runtime.getRenderedText("function-calls").some(text=>text.includes("호출 흐름 읽기")));
    runtime.dispatchMessage({type:"ui/language",payload:{language:"en"}});
    assert.equal(runtime.messages.filter(message=>message.type==="functionCalls/explain").length,before);
    assert.deepEqual(runtime.getRenderedText("function-calls").filter(text=>text.includes("!enabled")),choices);
    runtime.click("function-mode-statements");assert.equal(calls,1);
    runtime.click("function-mode-calls");assert.ok(runtime.getRenderedText("function-calls").some(text=>text.includes("Caller arguments bind")));
  }finally{delivery.reset();runtime.restore();}
});

for (const language of ["typescript", "kotlin"] as const) test(`${language} final whole-flow prose reaches the visible and cached earlier call page`, async () => {
  const f = await loadFunctionCallReadingFixture(language), graphDelivery = new WebviewGraphDelivery();
  const graphVersion = graphDelivery.activate(f.graph).snapshot.version;
  const sourceNodeTokens = new SourceNodeTokenRegistry(), evidenceTokens = new CodeFlowEvidenceTokenRegistry();
  sourceNodeTokens.activate(graphVersion, f.graph); evidenceTokens.activate(graphVersion, f.graph);
  const staticReplies: FunctionCallsResponse[] = [], replies: FunctionCallNarrativesResponse[] = [];
  let generations = 0;
  const delivery = new FunctionCallsHostDelivery({ graphDelivery, sourceNodeTokens, evidenceTokens, getLanguage: () => "en",
    readSourceText: async file => f.files.find(candidate => candidate.path === file)?.content,
    postMessage: async reply => { staticReplies.push(reply); }, postNarratives: async reply => { replies.push(reply); },
    provider: { async generate(context) { generations++; return functionCallReadingReply(context); } } });
  const runtime = installSidebarWebviewRuntime();
  try {
    const script = getFunctionVisualizerHtml({ webview: { cspSource: "vscode-webview:" } as never, nonce: "paged-call-test", language: "en" })
      .match(/<script nonce="paged-call-test">([\s\S]*)<\/script>/u)?.[1];
    assert.ok(script); new Function(script)();
    runtime.dispatchMessage({ type: "functionVisualizer/sessionLoaded", payload: { graphVersion,
      root: { sourceToken: sourceNodeTokens.createToken(f.root.id)!, label: f.root.name } } });
    runtime.click("function-mode-calls");
    await delivery.load(runtime.messages.at(-1)!.payload as never);
    runtime.dispatchMessage({ type: "functionCalls/loaded", payload: staticReplies.at(-1)! });
    // Select the existing relations toggle through its actual attached button.
    const views = document.getElementById(runtime.getRenderedIdentityByClassNth("function-calls", "calls-view-switch", 0))!;
    runtime.click(views.children[1].id);
    runtime.clickRenderedByClassNth("function-calls", "calls-reading-request", 0);
    const request = runtime.messages.at(-1)!.payload as FunctionCallNarrativesRequest;
    assert.equal(request.scope, "overview");
    await delivery.explain(request);
    assert.equal(generations, 3);
    assert.equal(replies.at(-1)!.page!.index, 1, "completion is delivered on the last generated page");
    for (const payload of replies) runtime.dispatchMessage({ type: "functionCalls/explanationLoaded", payload });
    const assertWhole = () => {
      const text = runtime.getRenderedText("function-calls");
      assert.ok(text.includes("Read the selected source calls."));
      assert.ok(text.includes("Follow the source conditions, transfer arguments and read the return expression."));
      assert.equal(runtime.countRenderedByClass("function-calls", "calls-reading-facts"), 1);
    };
    assertWhole();
    assert.ok(runtime.getRenderedText("function-calls").includes("Calls page 1/2"));
    const messageCount = runtime.messages.length;
    // Cached next/previous controls must retain the final summary without Host traffic.
    for (const childIndex of [2, 1]) {
      const pager = document.getElementById(runtime.getRenderedIdentityByClassNth("function-calls", "calls-reading-pager", 0))!;
      runtime.click(pager.children[childIndex].id); assertWhole();
    }
    assert.equal(runtime.messages.length, messageCount); assert.equal(generations, 3);
    runtime.click("function-mode-statements"); runtime.click("function-mode-calls"); assertWhole();
  } finally { delivery.reset(); runtime.restore(); }
});
