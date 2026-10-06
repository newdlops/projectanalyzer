/** Production interpretation controls preserve user edits, join selected graph nodes and read saved pages without inference. */
import assert from "node:assert/strict";
import test from "node:test";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import { getFunctionNarrativesBrowserSource } from "../../webview/functionNarratives";
import { validateWebviewRequest } from "../../protocol/webviewRequestValidation";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

const flowId = "code-flow:" + "a".repeat(32), contextId = "narrative-context:" + "c".repeat(32);
const nodeId = (index: number) => "function-logic-block:" + index.toString(16).padStart(32, "0");

/** Only the Host reply/adapter ports are fixtures; widget lifecycle, validation and DOM handlers are shipped code. */
function fixture() {
  const runtime = installSidebarWebviewRuntime(), posts: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const state = { graph: { version: "fixture" }, uiLanguage: "en" };
  const browser = new Function("state", "vscode", getBrowserLocalizationSource() + getFunctionNarrativesBrowserSource()
    + "return {create:createFunctionNarratives,accept:acceptFunctionNarrativesResponse,locale:applyProjectAnalyzerLanguage};")
    (state, { postMessage(message: typeof posts[number]) { posts.push(message); } });
  const values = new Map<string, string>(), selections: string[] = [], opened: string[] = [], listeners = new Set<() => void>();
  let selected = nodeId(0);
  const notes: any[] = [];
  const widget = browser.create({ functionId: flowId, narratives: { available: true, contextId } }, {
    onNarrativeNotes(data: unknown) { notes.push(data); },
    readNarrativeNode: () => selected,
    subscribeNarrativeNode(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    onNarrativeScenario(scenario: { example: { inputs: Array<{ name: string; json: string }> } }, options: { apply: string }) {
      if (options.apply === "none") return;
      for (const input of scenario.example.inputs) if (options.apply !== "empty" || !values.get(input.name)) values.set(input.name, input.json);
    },
    onShowGraph(chapter: { primaryBlockId: string }) { selected = chapter.primaryBlockId; selections.push(selected); for (const listener of listeners) listener(); },
    onOpenNarrativeValues() { opened.push("values"); }
  });
  document.getElementById("narrative-root")!.append(widget.element);
  const click = (name: string, index = 0) => runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-" + name, index);
  const scenario = (index: number) => ({ title: "Source route " + index, when: ["value > 0 => " + Boolean(index)], outcome: "return value", assumptions: [],
    explanation: "The example input follows this source route.", example: { inputs: [{ name: "value", json: index ? "5" : "0" }], result: String(index ? 5 : 0) },
    analysis: { pathReason: "Substitute value into the comparison.", stateChange: "The result is returned without changing the input.", alternative: "Changing the input sign selects the other branch. <script>literal</script>" },
    steps: [{ text: "Return the value.", reason: "The input selects this route.", effect: "Return the selected example result.", source: { snippetId: "root", startLine: 4, endLine: 4 } }],
    graph: { nodeIds: [nodeId(0), nodeId(index + 1)], edgeIds: [] },
    nodeDetails: [0, index + 1].map((id, occurrence) => ({ nodeId: nodeId(id), occurrence, text: "Read source node " + id + ".",
      syntax: "Return ends the function and leaves the argument unchanged.",
      code: "return value; // <script>literal</script>",
      reason: "The same input selects this node.", effect: "Continue along this route.", values: [{ name: "value", before: "0", after: "<value>" }],
      source: { snippetId: "root", startLine: id + 1, endLine: id + 1 } })) });
  const response = (index = 0, status = "ready") => ({ ...posts.at(-1)!.payload, status, language: "en", modelName: "Model",
    narrative: { summary: "Return the selected example value.", scenarios: index ? [scenario(2)] : [scenario(0), scenario(1)], limitations: [] },
    snippets: [{ id: "root", startLine: 1, endLine: 8 }], evidenceTokens: Array.from({ length: index ? 1 : 2 }, () => ["code-evidence:" + "b".repeat(64)]),
    limited: false, cacheHit: true, page: { index, count: 2, offset: index ? 2 : 0 },
    coverage: { completed: 3, discovered: 3, total: 3, complete: true, sourceLimited: false } });
  return { runtime, posts, state, browser, widget, values, selections, opened, listeners, notes, click, response,
    selectNode(id: string) { selected = id; for (const listener of listeners) listener(); },
    dispose() { widget.dispose(); runtime.restore(); } };
}

test("model examples fill empty inputs once; explicit selection/apply works while progress, paging and locale preserve edits and focus", () => {
  const f = fixture();
  try {
    assert.equal(f.posts.length, 0); f.click("request"); const result = f.response(); f.browser.accept(result);
    assert.equal(f.values.get("value"), "0");
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "logic-narrative-analysis"), 2);
    assert.ok(f.runtime.getRenderedText("narrative-root").includes("What changes the path"));
    f.values.set("value", "99"); f.state.uiLanguage = "ko"; f.browser.locale("ko"); f.widget.refreshLanguage();
    assert.equal(f.values.get("value"), "99"); assert.equal(f.posts.length, 1);
    assert.ok(f.runtime.getRenderedText("narrative-root").includes("다른 경로로 바뀌는 조건"));
    f.runtime.focusRenderedByClassNth("narrative-root", "logic-narrative-select", 1); f.click("select", 1);
    assert.equal(f.values.get("value"), "5");
    assert.equal(f.runtime.getFocusedRenderedAttribute("aria-pressed"), "true");
    f.click("graph", 1); assert.equal(f.selections.at(-1), nodeId(0));
    f.click("apply", 1); assert.deepEqual(f.opened, ["values"]);
    f.values.set("value", "42"); f.click("next"); f.browser.accept(f.response(1));
    assert.equal(f.values.get("value"), "42", "cache navigation must not overwrite manual input");
    f.runtime.focusRenderedByClassNth("narrative-root", "logic-narrative-select", 0);
    assert.equal(f.runtime.getFocusedRenderedAttribute("aria-pressed"), "true", "the new page starts with its first scenario selected");
    assert.equal(f.posts.filter((post) => post.payload.pageIndex === undefined && post.payload.nodeId === undefined).length, 1);
  } finally { f.dispose(); }
});

test("graph notes follow explicit scenario/graph selection and saved paging; stale note actions cannot open another scenario", () => {
  const f = fixture();
  try {
    f.click("request"); f.browser.accept(f.response());
    const first = f.notes.at(-1); assert.equal(first.ordinal, 1);
    f.click("graph", 1); assert.equal(f.notes.at(-1).ordinal, 2);
    const count = f.posts.length; first.openSource(0); assert.equal(f.posts.length, count);
    f.notes.at(-1).openSource(1);
    assert.equal(f.posts.at(-1)!.payload.scenarioIndex, 1); assert.equal(f.posts.at(-1)!.payload.nodeIndex, 1);
    assert.equal(validateWebviewRequest(f.posts.at(-1)).ok, true);
    f.click("next"); f.browser.accept(f.response(1)); assert.equal(f.notes.at(-1).ordinal, 3);
    assert.equal(f.posts.filter(post => post.type === "codeFlow/requestFunctionNarratives" && post.payload.pageIndex === undefined).length, 1);
    f.widget.dispose(); assert.equal(f.notes.at(-1), undefined);
  } finally { f.dispose(); }
});

test("node selection reads literal value changes and out-of-page cached explanations with their own source identity", () => {
  const f = fixture();
  try {
    f.click("request"); f.browser.accept(f.response());
    f.runtime.selectRenderedByClassNth("narrative-root", "logic-narrative-node-select", 0, nodeId(1));
    assert.equal(f.selections.at(-1), nodeId(1));
    assert.ok(f.runtime.getRenderedText("narrative-root").includes("<value>"));
    assert.ok(f.runtime.getRenderedText("narrative-root").some((text) => text.includes("Return ends the function")));
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "logic-narrative-node-code"), 1);
    assert.ok(f.runtime.getRenderedText("narrative-root").some((text) => text.includes("<script>literal</script>")));
    f.selectNode(nodeId(3));
    const query = f.posts.at(-1)!; assert.equal(query.payload.nodeId, nodeId(3)); assert.equal(query.payload.pageIndex, undefined);
    assert.equal(validateWebviewRequest(query).ok, true);
    f.browser.accept(f.response(1));
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 2, "quiet lookup keeps the visible scenarios");
    assert.ok(f.runtime.getRenderedText("narrative-root").some((text) => text.includes("Explanation from scenario 3")));
    f.click("node-source");
    assert.deepEqual(f.posts.at(-1), { type: "codeFlow/openFunctionNarrativeSource", payload: { graphVersion: "fixture", flowId, contextId,
      language: "en", scenarioIndex: 0, stepIndex: 0, nodeIndex: 1, pageIndex: 1 } });
    assert.equal(validateWebviewRequest(f.posts.at(-1)).ok, true);
    const count = f.posts.length; f.selectNode(nodeId(1)); f.selectNode(nodeId(3)); assert.equal(f.posts.length, count);
    f.widget.dispose(); assert.equal(f.listeners.size, 0);
  } finally { f.dispose(); }
});

test("cache-only node and node-source protocols reject raw identities, conflicting page indices and unbounded references", () => {
  const query = { graphVersion: "fixture", flowId, requestId: 1, nodeId: nodeId(3), pageLanguage: "en" };
  assert.equal(validateWebviewRequest({ type: "codeFlow/requestFunctionNarratives", payload: query }).ok, true);
  for (const patch of [{ nodeId: "private:node" }, { nodeId: "../../secret.ts" }, { pageIndex: 0 }, { pageLanguage: "fr" }, { prompt: "do work" }])
    assert.equal(validateWebviewRequest({ type: "codeFlow/requestFunctionNarratives", payload: { ...query, ...patch } }).ok, false);
  const source = { graphVersion: "fixture", flowId, contextId, language: "en", scenarioIndex: 0, stepIndex: 0, nodeIndex: 899 };
  assert.equal(validateWebviewRequest({ type: "codeFlow/openFunctionNarrativeSource", payload: source }).ok, true);
  for (const nodeIndex of [-1, 0.5, 900, Number.MAX_SAFE_INTEGER])
    assert.equal(validateWebviewRequest({ type: "codeFlow/openFunctionNarrativeSource", payload: { ...source, nodeIndex } }).ok, false);
});
