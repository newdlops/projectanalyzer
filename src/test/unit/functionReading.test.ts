/** Source outline invariants and retained Inspector interaction regression tests. */
import assert from "node:assert/strict";
import test from "node:test";
import { createFunctionReadingOutline, type FunctionReadingBlock } from "../../webview/codeFlow/reading";
import { getFunctionLogicInspectorBrowserSource } from "../../webview/codeFlow/inspector";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

/** Creates minimal source evidence without depending on an analyzer implementation. */
function block(id: string, kind: FunctionReadingBlock["kind"]): FunctionReadingBlock {
  return { id, kind, label: id, detail: id, depth: 0, confidence: "exact" };
}

test("outline keeps source order, opposite branches, opaque IDs and confidence", () => {
  const blocks = [block("entry", "entry"), block("if", "condition"), block("then", "return"),
    { ...block("else", "effect"), confidence: "inferred" as const }, block("exit", "exit")];
  const outline = createFunctionReadingOutline({ blocks, layout: { nodes: blocks.slice().reverse().map((b) => ({ blockId: b.id })) } });
  assert.deepEqual(outline.rows.map((r) => r.block.id), ["entry", "if", "then", "else", "exit"]);
  assert.deepEqual(outline.counts, { all: 5, decisions: 1, calls: 1, exits: 2 });
  assert.equal(outline.rows[3].block.confidence, "inferred");
  assert.equal(outline.rows[3].ordinal, 4);
});

test("outline omits stale layout references and duplicates without following parent cycles", () => {
  const first = { ...block("a", "condition"), parentBlockId: "b" };
  const second = { ...block("b", "loop"), parentBlockId: "a" };
  const outline = createFunctionReadingOutline({
    blocks: [first, second, first, block("missing", "return")],
    layout: { nodes: [{ blockId: "a" }, { blockId: "b" }, { blockId: "stale" }] }
  });
  assert.deepEqual(outline.rows.map((r) => r.block.id), ["a", "b"]);
  assert.equal(outline.counts.decisions, 2);
});

test("outline exposes its bound and counts only listed steps", () => {
  const blocks = Array.from({ length: 450 }, (_, i) => block(String(i), "call"));
  const outline = createFunctionReadingOutline({ blocks, layout: { nodes: blocks.map((b) => ({ blockId: b.id })) } });
  assert.equal(outline.rows.length, 400);
  assert.equal(outline.counts.calls, 400);
  assert.equal(outline.omittedCount, 50);
  assert.deepEqual(createFunctionReadingOutline({ blocks: [], layout: { nodes: [] } }).rows, []);
});

/** Mounts the production Inspector in the small event-aware runtime. */
function mountInspector() {
  const inspector = new Function(`${getBrowserLocalizationSource()}
    const formatLogicBlockLabel = (block) => block.label;
    ${getFunctionLogicInspectorBrowserSource()}
    return createFunctionLogicInspector("reading-test");`)();
  const host = Reflect.get(globalThis, "document").getElementById("flow-steps");
  assert.ok(host);
  host.append(inspector.workspace);
  return inspector;
}

test("Inspector tabs retain values and separate scroll positions across keyboard and locale changes", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const inspector = mountInspector();
    const input = Reflect.get(globalThis, "document").createElement("input");
    input.value = "120";
    input.title = "Amount";
    inspector.appendSectionsTo("values", input);
    const identity = runtime.getRenderedIdentityByTitle("flow-steps", "Amount");
    runtime.setRenderedScrollByClass("flow-steps", "logic-inspector-scroll", { left: 0, top: 80 });
    runtime.keydownByClass("flow-steps", "logic-inspector-tab", "ArrowRight");
    assert.equal(runtime.getFocusedRenderedAttribute("data-inspector-tab"), "values");
    assert.equal(runtime.getRenderedScrollByClass("flow-steps", "logic-inspector-scroll").top, 0);
    runtime.setRenderedScrollByClass("flow-steps", "logic-inspector-scroll", { left: 0, top: 240 });
    // Browsers clamp scroll when a tall panel is hidden. The prior position must
    // be captured before that layout change, which the fake DOM does not model.
    const valuesPanel = Reflect.get(globalThis, "document").getElementById("logic-inspector-1-panel-values");
    assert.ok(valuesPanel);
    let valuesHidden = valuesPanel.hidden;
    Object.defineProperty(valuesPanel, "hidden", {
      get: () => valuesHidden,
      set: (hidden: boolean) => {
        valuesHidden = hidden;
        if (hidden) runtime.setRenderedScrollByClass("flow-steps", "logic-inspector-scroll", { left: 0, top: 0 });
      }
    });
    inspector.openInspect("code");
    assert.equal(runtime.getRenderedScrollByClass("flow-steps", "logic-inspector-scroll").top, 80);
    inspector.openInspect("values");
    assert.equal(runtime.getRenderedScrollByClass("flow-steps", "logic-inspector-scroll").top, 240);
    Reflect.get(globalThis, "document").documentElement.lang = "ko";
    inspector.refreshLanguage();
    assert.equal(runtime.getRenderedIdentityByTitle("flow-steps", "Amount"), identity);
    assert.equal(runtime.getRenderedValueByTitle("flow-steps", "Amount"), "120");
    assert.equal(runtime.getRenderedScrollByClass("flow-steps", "logic-inspector-scroll").top, 240);
    assert.ok(runtime.getRenderedText("flow-steps").includes("값과 경로"));
    assert.equal(runtime.messages.length, 0);
  } finally { runtime.restore(); }
});

test("Inspector reports hidden Values, and direct code selection restores the code tab", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const inspector = mountInspector();
    const visible: boolean[] = [];
    inspector.onValuesVisibilityChange((next: boolean) => visible.push(next));
    inspector.openInspect("values");
    assert.equal(visible.at(-1), true);
    inspector.open();
    assert.equal(visible.at(-1), false);
    assert.equal(runtime.getRenderedAttributeByClass("flow-steps", "logic-inspector-tab", "aria-selected"), "true");
    runtime.keydownByClass("flow-steps", "logic-inspector-tab", "End");
    assert.equal(runtime.getFocusedRenderedAttribute("data-inspector-tab"), "info");
    runtime.keydownByClass("flow-steps", "logic-graph-workspace", "Escape");
    assert.equal(runtime.getRenderedAttributeByClass("flow-steps", "logic-inspector-drawer", "aria-hidden"), "true");
  } finally { runtime.restore(); }
});
