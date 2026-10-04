/** LLM controls use production DOM/rendering code; model replies are mocked only at the external message boundary. */
import assert from "node:assert/strict";
import test from "node:test";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import { getFunctionNarrativesBrowserSource } from "../../webview/functionNarratives";
import { validateWebviewRequest } from "../../protocol/webviewRequestValidation";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

const flowId = "code-flow:" + "a".repeat(32);
const narrative = { summary: "<img src=x onerror=run()>", scenarios: [{ title: "Ready", when: ["LIMIT > 0"],
  steps: [{ text: "Print ready.", source: { snippetId: "root", startLine: 4, endLine: 4 } }], outcome: "Return after printing.", assumptions: ["Output is available."] }], limitations: [] };

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

test("Kotlin LLM controls are inert until clicked and preserve literal output, source action and locale state", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const posts: Array<{ type: string; payload: Record<string, unknown> }> = []; const sources: string[] = [];
    const state = { graph: { version: "fixture" }, uiLanguage: "en" };
    const browser = new Function("state", "vscode", getBrowserLocalizationSource() + getFunctionNarrativesBrowserSource()
      + "return {create:createFunctionNarratives,accept:acceptFunctionNarrativesResponse,locale:applyProjectAnalyzerLanguage};")(state, { postMessage(message: typeof posts[number]) { posts.push(message); } });
    const widget = browser.create({ functionId: flowId, narratives: { available: true }, program: { evaluationMode: "symbolic-only" } }, { onOpenEvidence(token: string) { sources.push(token); } });
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
    assert.ok(runtime.getRenderedText("narrative-root").some((text) => text.includes("LLM inference · execution unverified")));
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-source", 0);
    assert.deepEqual(sources, ["code-evidence:" + "b".repeat(64)]);
    state.uiLanguage = "ko"; browser.locale("ko"); widget.refreshLanguage();
    assert.equal(posts.length, 1); assert.equal(runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 1);
    assert.ok(runtime.getRenderedText("narrative-root").some((text) => text.includes("LLM 추론 · 실제 실행 미검증")));
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
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-request", 0);
    browser.accept({ ...posts[0].payload, status: "stale" });
    runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-refresh", 0);
    assert.deepEqual(refreshes, [sourceToken]); assert.equal(posts.length, 1);
    widget.dispose();
  } finally { runtime.restore(); }
});
