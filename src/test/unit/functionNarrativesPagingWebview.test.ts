/** Production browser lifecycle checks streaming coverage, cache-only paging, resume and source identity. */
import assert from "node:assert/strict";
import test from "node:test";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import { getFunctionNarrativesBrowserSource } from "../../webview/functionNarratives";
import { validateWebviewRequest } from "../../protocol/webviewRequestValidation";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

const flowId = "code-flow:" + "a".repeat(32), contextId = "narrative-context:" + "c".repeat(32);
const scenario = { title: "Source condition", when: ["flag => true"], outcome: "return total", assumptions: [], explanation: "The selected branch returns the total.",
  steps: [{ text: "Return the total.", source: { snippetId: "root", startLine: 4, endLine: 4 } }] };

/** External Host messages are mocked; DOM state and messages use the actual shipped browser program. */
function fixture() {
  const runtime = installSidebarWebviewRuntime();
  const posts: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const state = { graph: { version: "fixture" }, uiLanguage: "en" };
  const browser = new Function("state", "vscode", getBrowserLocalizationSource() + getFunctionNarrativesBrowserSource()
    + "return {create:createFunctionNarratives,accept:acceptFunctionNarrativesResponse,locale:applyProjectAnalyzerLanguage};")(state, { postMessage(message: typeof posts[number]) { posts.push(message); } });
  const widget = browser.create({ functionId: flowId, narratives: { available: true, contextId } }, {});
  document.getElementById("narrative-root")!.append(widget.element);
  const click = (name: string) => runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-" + name, 0);
  const focus = (name: string) => runtime.focusRenderedByClassNth("narrative-root", "logic-narrative-" + name, 0);
  const disabled = (name: string) => runtime.isDisabled(runtime.getRenderedIdentityByClassNth("narrative-root", "logic-narrative-" + name, 0));
  const response = (status = "ready", index = 0, complete = true) => ({ ...posts.at(-1)!.payload, requestId: posts.at(-1)!.payload.requestId, status, language: "en", modelName: "Model",
    narrative: { summary: "The function returns a total for the selected source decisions.", scenarios: [scenario, scenario], limitations: [] },
    snippets: [{ id: "root", startLine: 1, endLine: 8 }], evidenceTokens: [["code-evidence:" + "b".repeat(64)], ["code-evidence:" + "b".repeat(64)]],
    limited: false, cacheHit: status === "ready", page: { index, count: 3, offset: index * 2 },
    coverage: complete ? { completed: 6, discovered: 6, total: 6, complete, sourceLimited: false }
      : { completed: 2, discovered: 3, complete, sourceLimited: false } });
  return { runtime, posts, state, browser, widget, click, focus, disabled, response,
    dispose() { widget.dispose(); runtime.restore(); } };
}

test("progress keeps one active request until every scenario is complete, then pages stay bounded and cache-only", () => {
  const f = fixture();
  try {
    f.focus("request"); f.click("request"); const streaming = f.response("progress", 0, false);
    f.browser.accept(streaming);
    assert.equal(f.posts.length, 1);
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 2);
    assert.equal(f.disabled("next"), true);
    assert.ok(f.runtime.getRenderedText("narrative-root").some((text) => text.includes("Analyzed 2 scenarios")));
    f.browser.accept({ ...streaming, ...f.response(), requestId: streaming.requestId });
    assert.equal(f.disabled("next"), false);
    assert.ok(f.runtime.getRenderedText("narrative-root").includes("Generated 6 behavior scenarios."));
    f.focus("next"); f.click("next");
    assert.deepEqual(f.posts.at(-1)!.payload, { graphVersion: "fixture", flowId, requestId: 2, pageIndex: 1, pageLanguage: "en" });
    assert.equal(f.disabled("next"), true);
    f.browser.accept(f.response("ready", 1));
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 2);
    assert.ok(f.runtime.getRenderedText("narrative-root").includes("3. Source condition"));
    assert.equal(f.runtime.getFocusedElementId(), f.runtime.getRenderedIdentityByClassNth("narrative-root", "logic-narrative-next", 0));
    f.click("source");
    assert.deepEqual(f.posts.at(-1), { type: "codeFlow/openFunctionNarrativeSource", payload: { graphVersion: "fixture", flowId, contextId,
      language: "en", scenarioIndex: 0, stepIndex: 0, pageIndex: 1 } });
    f.state.uiLanguage = "ko"; f.browser.locale("ko"); f.widget.refreshLanguage();
    assert.equal(f.posts.length, 3, "locale switching is inert");
    f.focus("next"); f.click("next");
    assert.equal(f.posts.at(-1)!.payload.pageLanguage, "en", "saved English pages remain readable in Korean UI");
    f.browser.accept(f.response("ready", 2));
    assert.ok(f.runtime.getRenderedText("narrative-root").includes("5. Source condition"));
    assert.equal(f.runtime.getFocusedElementId(), f.runtime.getRenderedIdentityByClassNth("narrative-root", "logic-narrative-previous", 0));
    assert.equal(f.disabled("next"), true);
  } finally { f.dispose(); }
});

test("cancel retains completed prose and permits explicit resume without accepting the old streaming reply", () => {
  const f = fixture();
  try {
    f.focus("request"); f.click("request"); const progress = f.response("progress", 0, false);
    f.browser.accept(progress); f.click("cancel");
    assert.equal(f.posts.at(-1)!.type, "codeFlow/cancelFunctionNarratives");
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 2);
    assert.ok(f.runtime.getRenderedText("narrative-root").includes("Continue scenario analysis"));
    assert.equal(f.disabled("request"), false);
    f.browser.accept({ ...progress, status: "ready", coverage: { completed: 6, discovered: 6, total: 6, complete: true, sourceLimited: false } });
    assert.equal(f.disabled("request"), false, "cancelled request cannot overwrite partial coverage");
    f.click("request"); assert.equal(f.posts.at(-1)!.type, "codeFlow/requestFunctionNarratives");
    assert.equal(f.posts.at(-1)!.payload.pageIndex, undefined, "resume requests remaining analysis, not a page");
    f.browser.accept(f.response());
    assert.ok(f.runtime.getRenderedText("narrative-root").includes("Generated 6 behavior scenarios."));
  } finally { f.dispose(); }
});

test("invalid progress coverage revokes inference and never claims all paths were analyzed", () => {
  const f = fixture();
  try {
    f.click("request");
    f.browser.accept({ ...f.response("progress", 0, false), coverage: { completed: 2, discovered: 9, total: 9, complete: true, sourceLimited: false } });
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 0);
    assert.equal(f.posts.at(-1)!.type, "codeFlow/cancelFunctionNarratives");
    assert.equal(f.disabled("request"), false);
  } finally { f.dispose(); }
});

test("page protocols accept safe cache identities and reject excess, negative and unsafe indices", () => {
  const request = { graphVersion: "fixture", flowId, requestId: 1, pageIndex: 4, pageLanguage: "en" };
  assert.equal(validateWebviewRequest({ type: "codeFlow/requestFunctionNarratives", payload: request }).ok, true);
  for (const patch of [{ pageIndex: -1 }, { pageIndex: 0.5 }, { pageIndex: Number.MAX_SAFE_INTEGER + 1 }, { pageLanguage: "fr" }, { pageIndex: undefined }, { narrative: scenario }]) {
    assert.equal(validateWebviewRequest({ type: "codeFlow/requestFunctionNarratives", payload: { ...request, ...patch } }).ok, false);
  }
  const source = { graphVersion: "fixture", flowId, contextId, language: "ko", pageIndex: 100, scenarioIndex: 1, stepIndex: 0 };
  assert.equal(validateWebviewRequest({ type: "codeFlow/openFunctionNarrativeSource", payload: source }).ok, true);
  for (const pageIndex of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validateWebviewRequest({ type: "codeFlow/openFunctionNarrativeSource", payload: { ...source, pageIndex } }).ok, false);
  }
});
