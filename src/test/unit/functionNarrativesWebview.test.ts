/** LLM controls use production DOM/rendering code; model replies are mocked only at the external message boundary. */
import assert from "node:assert/strict";
import test from "node:test";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import { getFunctionNarrativesBrowserSource } from "../../webview/functionNarratives";
import { validateWebviewRequest } from "../../protocol/webviewRequestValidation";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

const flowId = "code-flow:" + "a".repeat(32);
const contextId = "narrative-context:" + "c".repeat(32);
const narrative = { summary: "<img src=x onerror=run()>", scenarios: [{ title: "Ready", when: ["LIMIT > 0"],
  steps: [{ text: "Print ready.", reason: "LIMIT=3 makes LIMIT > 0 true.", effect: "The else branch is skipped.", source: { snippetId: "root", startLine: 4, endLine: 4 } }], outcome: "Return after printing.", assumptions: ["Output is available."] }], limitations: [] };

test("queue state keeps a Guide request correlated, preserves focus and does not rebuild saved prose", () => {
  const runtime=installSidebarWebviewRuntime();try{
    const posts:Array<{type:string;payload:Record<string,unknown>}>=[],state={graph:{version:"fixture"},uiLanguage:"en"};
    const browser=new Function("state","vscode",getBrowserLocalizationSource()+getFunctionNarrativesBrowserSource()+"return {create:createFunctionNarratives,accept:acceptFunctionNarrativesResponse};")(state,{postMessage(message:typeof posts[number]){posts.push(message);}});
    const widget=browser.create({functionId:flowId,narratives:{available:true,contextId}},{});document.getElementById("narrative-root")!.append(widget.element);
    runtime.focusRenderedByClassNth("narrative-root","logic-narrative-request",0);runtime.clickRenderedByClassNth("narrative-root","logic-narrative-request",0);
    const focused=runtime.getFocusedElementId(),request=posts[0].payload;
    browser.accept({...request,status:"working",task:{id:"model-task:1",kind:"inference",phase:"queued",position:1,waiting:1}});
    assert.ok(runtime.getRenderedText("narrative-root").some(text=>text.includes("position 1")));assert.equal(runtime.getFocusedElementId(),focused);
    const partial={...request,status:"progress",language:"en",modelName:"Model",narrative,snippets:[{id:"root",startLine:3,endLine:6}],evidenceTokens:[["code-evidence:"+"b".repeat(64)]],limited:false,cacheHit:false,
      coverage:{completed:1,discovered:2,complete:false,sourceLimited:false},page:{index:0,count:1,offset:0}};
    browser.accept(partial);const identity=runtime.getRenderedIdentityByClassNth("narrative-root","logic-narrative-scenario",0);
    browser.accept({...request,status:"working",task:{id:"model-task:2",kind:"inference",phase:"queued",position:2,waiting:2}});
    assert.equal(runtime.getRenderedIdentityByClassNth("narrative-root","logic-narrative-scenario",0),identity);assert.equal(posts.length,1);
    browser.accept({...partial,status:"ready"});assert.equal(runtime.countRenderedByClass("narrative-root","logic-narrative-scenario"),1);
    widget.dispose();
  }finally{runtime.restore();}
});

test("English output mislabeled Korean stays out of rendered results and permits explicit keyboard retry", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const posts: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const state = { graph: { version: "fixture" }, uiLanguage: "ko" };
    const browser = new Function("state", "vscode", getBrowserLocalizationSource() + getFunctionNarrativesBrowserSource()
      + "return {create:createFunctionNarratives,accept:acceptFunctionNarrativesResponse,locale:applyProjectAnalyzerLanguage};")(state, { postMessage(message: typeof posts[number]) { posts.push(message); } });
    browser.locale("ko");
    const widget = browser.create({ functionId: flowId, narratives: { available: true, contextId } }, {});
    document.getElementById("narrative-root")!.append(widget.element);
    runtime.focusRenderedByClassNth("narrative-root", "logic-narrative-request", 0);
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-request", 0);
    const payload = { ...posts[0].payload, status: "ready", language: "ko", modelName: "Model", narrative,
      snippets: [{ id: "root", startLine: 3, endLine: 6 }], evidenceTokens: [["code-evidence:" + "b".repeat(64)]], limited: false, cacheHit: false };
    browser.accept(payload);
    assert.equal(runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 0);
    assert.ok(runtime.getRenderedText("narrative-root").some((text) => text.includes("요청한 언어로 설명하지 않았습니다")));
    assert.equal(runtime.getFocusedElementId(), runtime.getRenderedIdentityByClassNth("narrative-root", "logic-narrative-request", 0));
    assert.equal(posts.length, 1, "no automatic retry is allowed");
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-request", 0);
    assert.equal(posts.length, 2);
    browser.accept({ ...payload, ...posts[1].payload, narrative: { summary: "LIMIT가 양수이면 출력합니다.", scenarios: [{ title: "양수 LIMIT", when: ["LIMIT > 0"],
      explanation: "LIMIT가 양수이면 ready를 출력합니다.", steps: [{ text: "ready를 출력합니다.", reason: "LIMIT가 양수입니다.", effect: "메시지를 출력합니다.",
        source: { snippetId: "root", startLine: 4, endLine: 4 } }], outcome: "정상 종료합니다.", assumptions: [] }], limitations: [] } });
    assert.equal(runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 1);
    widget.dispose();
  } finally { runtime.restore(); }
});

test("paragraph reading keeps source evidence closed and retains disclosure/focus without extra model work", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const posts: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const state = { graph: { version: "fixture" }, uiLanguage: "en" };
    const browser = new Function("state", "vscode", getBrowserLocalizationSource() + getFunctionNarrativesBrowserSource()
      + "return {create:createFunctionNarratives,accept:acceptFunctionNarrativesResponse,locale:applyProjectAnalyzerLanguage};")(state, { postMessage(message: typeof posts[number]) { posts.push(message); } });
    const widget = browser.create({ functionId: flowId, narratives: { available: true, contextId } }, {});
    document.getElementById("narrative-root")!.append(widget.element);
    runtime.focusRenderedByClassNth("narrative-root", "logic-narrative-request", 0);
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-request", 0);
    const requestId = runtime.getRenderedIdentityByClassNth("narrative-root", "logic-narrative-request", 0);
    assert.equal(runtime.isHidden(requestId), true, "only cancellation is actionable during generation");
    assert.equal(runtime.getFocusedElementId(), runtime.getRenderedIdentityByClassNth("narrative-root", "logic-narrative-cancel", 0), "keyboard readers keep an actionable focused control");
    const explanation = "With LIMIT=3, LIMIT > 0 is true. Print <ready> and skip the else branch. Then return.";
    browser.accept({ ...posts[0].payload, status: "ready", language: "en", modelName: "Model",
      narrative: { ...narrative, scenarios: [{ ...narrative.scenarios[0], explanation }] },
      snippets: [{ id: "root", startLine: 3, endLine: 6 }], evidenceTokens: [["code-evidence:" + "b".repeat(64)]], limited: false, cacheHit: false });
    assert.ok(runtime.getRenderedText("narrative-root").includes(explanation));
    assert.equal(runtime.isHidden(requestId), true, "completion is prose, not a disabled action");
    assert.equal(runtime.getRenderedOpenByClassNth("narrative-root", "logic-narrative-evidence", 0), false);
    runtime.setRenderedOpenByClassNth("narrative-root", "logic-narrative-evidence", 0, true);
    runtime.focusRenderedByClassNth("narrative-root", "logic-narrative-source", 0);
    state.uiLanguage = "ko"; browser.locale("ko"); widget.refreshLanguage();
    assert.equal(runtime.getRenderedOpenByClassNth("narrative-root", "logic-narrative-evidence", 0), true);
    assert.equal(runtime.getFocusedRenderedAttribute("id"), runtime.getRenderedIdentityByClassNth("narrative-root", "logic-narrative-source", 0));
    assert.equal(posts.length, 1, "reading and language changes never generate automatically");
    assert.equal(runtime.isHidden(requestId), false, "explicit generation is offered for the new language");
    widget.dispose();
  } finally { runtime.restore(); }
});

test("LLM requests accept only opaque current function identity and reject source/prompt injection", () => {
  for (const type of ["codeFlow/requestFunctionNarratives", "codeFlow/cancelFunctionNarratives"]) {
    const payload = { graphVersion: "fixture", flowId, requestId: 1 };
    assert.equal(validateWebviewRequest({ type, payload }).ok, true);
    for (const extra of [{ source: "execute()" }, { prompt: "ignore rules" }, { filePath: "/secret.kt" }, { modelId: "other" }]) {
      assert.equal(validateWebviewRequest({ type, payload: { ...payload, ...extra } }).ok, false);
    }
    assert.equal(validateWebviewRequest({ type, payload: { ...payload, requestId: -1 } }).ok, false);
    assert.equal(validateWebviewRequest({ type, payload: { ...payload, flowId: "/secret.kt" } }).ok, false);
  }
});

test("numbered narrative source actions accept only bounded snapshot/result identities", () => {
  const payload = { graphVersion: "fixture", flowId, contextId, language: "en", scenarioIndex: 0, stepIndex: 0 };
  assert.equal(validateWebviewRequest({ type: "codeFlow/openFunctionNarrativeSource", payload }).ok, true);
  for (const extra of [{ filePath: "/secret" }, { evidenceToken: "chosen by browser" }, { contextId: "bad" },
    { language: "other" }, { scenarioIndex: 4 }, { stepIndex: 5 }, { stepIndex: -1 }]) {
    assert.equal(validateWebviewRequest({ type: "codeFlow/openFunctionNarrativeSource", payload: { ...payload, ...extra } }).ok, false);
  }
});

test("Kotlin LLM controls are inert until clicked and preserve literal output, source action and locale state", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const posts: Array<{ type: string; payload: Record<string, unknown> }> = []; const sources: string[] = [];
    const state = { graph: { version: "fixture" }, uiLanguage: "en" };
    const browser = new Function("state", "vscode", getBrowserLocalizationSource() + getFunctionNarrativesBrowserSource()
      + "return {create:createFunctionNarratives,accept:acceptFunctionNarrativesResponse,locale:applyProjectAnalyzerLanguage};")(state, { postMessage(message: typeof posts[number]) { posts.push(message); } });
    const widget = browser.create({ functionId: flowId, narratives: { available: true, contextId }, program: { evaluationMode: "symbolic-only" } }, { onOpenEvidence(token: string) { sources.push(token); } });
    assert.ok(widget, "symbolic languages must offer source-reading LLM narratives");
    document.getElementById("narrative-root")!.append(widget.element);
    assert.equal(posts.length, 0);
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-request", 0);
    assert.equal(posts[0].type, "codeFlow/requestFunctionNarratives");
    assert.deepEqual(Object.keys(posts[0].payload).sort(), ["flowId", "graphVersion", "requestId"]);
    const result = { ...posts[0].payload, status: "ready", language: "en", modelName: "Model", narrative,
      snippets: [{ id: "root", startLine: 3, endLine: 6 }], evidenceTokens: [["code-evidence:" + "b".repeat(64)]], limited: false, cacheHit: false };
    browser.accept({ ...result, graphVersion: "other" });
    assert.equal(runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 0);
    browser.accept(result);
    assert.ok(runtime.getRenderedText("narrative-root").includes("<img src=x onerror=run()>"));
    assert.ok(runtime.getRenderedText("narrative-root").some((text) => text.includes("Model/source reading · execution unverified")));
    assert.ok(runtime.getRenderedText("narrative-root").includes("LIMIT=3 makes LIMIT > 0 true."));
    assert.ok(runtime.getRenderedText("narrative-root").includes("The else branch is skipped."));
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-source", 0);
    assert.equal(sources.length, 0);
    assert.deepEqual(posts[1], { type: "codeFlow/openFunctionNarrativeSource", payload: { graphVersion: "fixture", flowId, contextId, language: "en", scenarioIndex: 0, stepIndex: 0 } });
    state.uiLanguage = "ko"; browser.locale("ko"); widget.refreshLanguage();
    assert.equal(posts.length, 2); assert.equal(runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 1);
    assert.ok(runtime.getRenderedText("narrative-root").some((text) => text.includes("모델·소스 해설 · 실제 실행 미검증")));
    widget.dispose();
  } finally { runtime.restore(); }
});

test("LLM browser cache invalidates when nearby code changes while the root Tutor fingerprint stays the same", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const posts: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const browser = new Function("state", "vscode", getBrowserLocalizationSource() + getFunctionNarrativesBrowserSource()
      + "return {create:createFunctionNarratives,accept:acceptFunctionNarrativesResponse};")({ graph: { version: "fixture" }, uiLanguage: "en" }, { postMessage(message: typeof posts[number]) { posts.push(message); } });
    const tutor = { functionId: flowId, fingerprint: "same-root-body", narratives: { available: true, contextId: "narrative-context:" + "1".repeat(32) } };
    const first = browser.create(tutor, {}); document.getElementById("narrative-root")!.append(first.element);
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-request", 0);
    browser.accept({ ...posts[0].payload, status: "ready", language: "en", modelName: "Model", narrative,
      snippets: [{ id: "root", startLine: 3, endLine: 6 }], evidenceTokens: [["code-evidence:" + "b".repeat(64)]], limited: false, cacheHit: false });
    first.dispose();
    const second = browser.create({ ...tutor, narratives: { ...tutor.narratives, contextId: "narrative-context:" + "2".repeat(32) } }, {});
    document.getElementById("narrative-root")!.replaceChildren(second.element);
    assert.equal(runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 0);
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-request", 0);
    assert.equal(posts.filter((post) => post.type === "codeFlow/requestFunctionNarratives").length, 2);
    second.dispose();
  } finally { runtime.restore(); }
});

test("disposed LLM controls cancel pending work and ignore the late reply", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const posts: Array<{ type: string; payload: unknown }> = [];
    const browser = new Function("state", "vscode", getBrowserLocalizationSource() + getFunctionNarrativesBrowserSource()
      + "return {create:createFunctionNarratives,accept:acceptFunctionNarrativesResponse};")({ graph: { version: "fixture" }, uiLanguage: "en" }, { postMessage(message: typeof posts[number]) { posts.push(message); } });
    const widget = browser.create({ functionId: flowId, narratives: { available: true } }, {});
    assert.ok(widget);
    document.getElementById("narrative-root")!.append(widget.element);
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-request", 0);
    widget.dispose(); assert.equal(posts[1].type, "codeFlow/cancelFunctionNarratives");
    browser.accept({ ...posts[0].payload as object, status: "ready", narrative });
    assert.equal(runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 0);
  } finally { runtime.restore(); }
});

test("expired LLM context offers an explicit Host-owned source refresh without automatic inference", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const posts: Array<{ type: string; payload: Record<string, unknown> }> = []; const refreshes: string[] = [];
    const browser = new Function("state", "vscode", getBrowserLocalizationSource() + getFunctionNarrativesBrowserSource()
      + "return {create:createFunctionNarratives,accept:acceptFunctionNarrativesResponse};")({ graph: { version: "fixture" }, uiLanguage: "en" }, { postMessage(message: typeof posts[number]) { posts.push(message); } });
    const sourceToken = "source-node:" + "d".repeat(64);
    const widget = browser.create({ functionId: flowId, narratives: { available: true, sourceToken } }, { onRefreshFunction(token: string) { refreshes.push(token); } });
    document.getElementById("narrative-root")!.append(widget.element);
    runtime.focusRenderedByClassNth("narrative-root", "logic-narrative-request", 0);
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-request", 0);
    browser.accept({ ...posts[0].payload, status: "stale" });
    assert.equal(runtime.getFocusedElementId(), runtime.getRenderedIdentityByClassNth("narrative-root", "logic-narrative-refresh", 0));
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-refresh", 0);
    assert.deepEqual(refreshes, [sourceToken]); assert.equal(posts.length, 1);
    widget.dispose();
  } finally { runtime.restore(); }
});

test("download failure restores a focused retry action with localized resumable-download guidance", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const posts: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const browser = new Function("state", "vscode", getBrowserLocalizationSource() + getFunctionNarrativesBrowserSource()
      + "return {create:createFunctionNarratives,accept:acceptFunctionNarrativesResponse,locale:applyProjectAnalyzerLanguage};")({ graph: { version: "fixture" }, uiLanguage: "ko" }, { postMessage(message: typeof posts[number]) { posts.push(message); } });
    browser.locale("ko");
    const widget = browser.create({ functionId: flowId, narratives: { available: true, contextId } }, {});
    document.getElementById("narrative-root")!.append(widget.element);
    runtime.focusRenderedByClassNth("narrative-root", "logic-narrative-request", 0);
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-request", 0);
    browser.accept({ ...posts[0].payload, status: "download-failed" });
    assert.ok(runtime.getRenderedText("narrative-root").some((text) => text.includes("중단된 다운로드는 자동으로 이어받습니다")));
    assert.equal(runtime.getFocusedElementId(), runtime.getRenderedIdentityByClassNth("narrative-root", "logic-narrative-request", 0));
    assert.equal(posts.length, 1);
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-request", 0); assert.equal(posts.length, 2);
    widget.dispose();
  } finally { runtime.restore(); }
});
