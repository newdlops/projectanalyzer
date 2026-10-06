/** Scenario graph notes preserve source identity, repeated visits and bounded visibility without inference. */
import assert from "node:assert/strict";
import test from "node:test";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import { getNarrativeGraphNotesBrowserSource, projectNarrativeGraphNotes, layoutNarrativeGraphNotes, type NarrativeNoteNode } from "../../webview/codeFlow/narrativeNotes";
import type { FunctionNarrativeScenario } from "../../shared/functionNarratives";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

const id = (index: number) => "function-logic-block:" + index.toString(16).padStart(32, "0");
const nodes: NarrativeNoteNode[] = Array.from({ length: 60 }, (_, index) => ({ blockId: id(index), x: 20, y: index * 100, width: 220, height: 70 }));
/** Fictional prose replaces only generation; notes receive ordinary validated scenario contracts. */
function scenario(indices = [0, 1, 0]): FunctionNarrativeScenario {
  const details = indices.map((index, occurrence) => ({ nodeId: id(index), occurrence, text: "A literal model explanation <script>unsafe</script> " + index,
    syntax: "Assignment creates a local value.", reason: "The same example reaches this statement.", effect: "The local changes before the next statement.",
    values: [{ name: "total", before: "1", after: String(occurrence + 2) }], source: { snippetId: "root", startLine: index + 1, endLine: index + 1 } }));
  return { title: "Source route", when: [], outcome: "return total", assumptions: [], steps: details,
    example: { inputs: [{ name: "value", json: "1" }], result: "3" }, graph: { nodeIds: [...new Set(indices.map(id))], edgeIds: [] }, nodeDetails: details };
}

test("notes bind only reached current nodes, keep repeated source indices and never mutate graph geometry", () => {
  const reading = scenario();
  reading.nodeDetails!.push({ ...reading.nodeDetails![0], nodeId: id(3) });
  const before = structuredClone(nodes);
  const notes = projectNarrativeGraphNotes(reading, nodes);
  assert.deepEqual(notes.map(note => [note.blockId, note.visits.map(visit => visit.nodeIndex)]), [[id(0), [0, 2]], [id(1), [1]]]);
  const placed = layoutNarrativeGraphNotes(notes, 300, new Map([[id(0), 420]]));
  assert.equal(placed[0].x, 324);
  assert.ok(placed[1].y >= placed[0].y + placed[0].height + 16);
  assert.deepEqual(nodes, before);
  assert.deepEqual(projectNarrativeGraphNotes(reading, nodes, () => undefined), []);
  assert.deepEqual(projectNarrativeGraphNotes({ ...reading, graph: { nodeIds: [id(1)], edgeIds: [] } }, nodes).map(note => note.blockId), [id(1)]);
});

test("compound identity resolution attaches descriptions only to the verified visible node", () => {
  const composed = [{ ...nodes[0], blockId: "child:visible" }];
  const notes = projectNarrativeGraphNotes(scenario([0]), composed, source => source === id(0) ? "child:visible" : undefined);
  assert.equal(notes[0].blockId, "child:visible");
  assert.equal(notes[0].visits[0].detail.nodeId, id(0), "navigation retains the original source-owned identity");
});

function browserFixture() {
  const runtime = installSidebarWebviewRuntime();
  const listeners = new Set<() => void>(), bounds: unknown[] = [], reveals: any[] = [], opened: number[] = [];
  let selected = id(0);
  const browser = new Function("state", getBrowserLocalizationSource() + "const LOGIC_SVG_NAMESPACE='http://www.w3.org/2000/svg';function createLogicSvgElement(name){return document.createElementNS(LOGIC_SVG_NAMESPACE,name);}"
    + getNarrativeGraphNotesBrowserSource() + "return {create:createNarrativeGraphNotes,locale:applyProjectAnalyzerLanguage};")({ uiLanguage: "en" });
  const controller = browser.create({ layout: { width: 300, height: 6000, nodes }, viewport: document.getElementById("notes-viewport"),
    viewportController: { setContentBounds(value: unknown) { bounds.push(value); }, revealBounds(value: unknown, options: unknown) { reveals.push({ value, options }); } },
    comprehension: { getState: () => ({ selectedBlockId: selected }), subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
      activateBlock(value: string) { selected = value; for (const listener of listeners) listener(); } }, resolveBlockId: (value: string) => value });
  document.getElementById("notes-root")!.append(controller.toggle, controller.layer);
  const reading = (value = scenario(), ordinal = 1) => ({ scenario: value, ordinal, language: "en", modelName: "Model", openSource(index: number) { opened.push(index); } });
  return { runtime, browser, controller, bounds, reveals, opened, listeners, reading,
    dispose() { controller.dispose(); runtime.restore(); } };
}

test("graph-note markers reveal cached literal prose at the current zoom, visits retain their source actions", () => {
  const f = browserFixture();
  try {
    assert.equal(f.runtime.getRenderedAttributeByClass("notes-root", "logic-narrative-note-toggle", "aria-pressed"), "false");
    f.controller.setScenario(f.reading());
    assert.equal(f.runtime.countRenderedByClass("notes-root", "logic-narrative-graph-note"), 2);
    assert.ok(f.runtime.getRenderedText("notes-root").some(text => text.includes("<script>unsafe</script>")));
    assert.ok(f.runtime.getRenderedText("notes-root").includes("Visit 2"));
    f.runtime.clickRenderedByClassNth("notes-root", "logic-narrative-note-marker", 1);
    assert.equal(f.reveals.at(-1).options.preserveScale, true);
    f.runtime.clickRenderedByClassNth("notes-root", "logic-narrative-note-source", 1);
    assert.deepEqual(f.opened, [2]);
    f.controller.setScenario(f.reading(scenario([1, 2]), 2));
    assert.equal(f.runtime.countRenderedByClass("notes-root", "logic-narrative-note-marker"), 2);
    assert.ok(!f.runtime.getRenderedText("notes-root").includes("Visit 2"), "notes cannot borrow another scenario's visits");
    f.browser.locale("ko"); f.controller.refreshLanguage();
    assert.ok(f.runtime.getRenderedText("notes-root").includes("그래프 노트"));
    const last = f.bounds.at(-1) as any; assert.ok(last.width > 300);
    f.controller.setScenario(undefined);
    assert.equal(f.runtime.countRenderedByClass("notes-root", "logic-narrative-graph-note"), 0);
    assert.deepEqual(f.bounds.at(-1), { width: 300, height: 6000 });
    f.controller.dispose(); assert.equal(f.listeners.size, 0);
    assert.equal(f.runtime.pendingAnimationFrameCount(), 0, "notes introduce no animation scheduler");
  } finally { f.dispose(); }
});

test("a dense scenario keeps detailed note DOM bounded while retaining all source markers", () => {
  const f = browserFixture();
  try {
    f.controller.setScenario(f.reading(scenario(nodes.map((_, index) => index))));
    assert.equal(f.runtime.countRenderedByClass("notes-root", "logic-narrative-note-marker"), 60);
    assert.equal(f.runtime.countRenderedByClass("notes-root", "logic-narrative-note-body"), 40);
    f.runtime.clickRenderedByClassNth("notes-root", "logic-narrative-note-marker", 59);
    assert.equal(f.runtime.countRenderedByClass("notes-root", "logic-narrative-note-body"), 40);
    f.runtime.clickRenderedByClassNth("notes-root", "logic-narrative-note-toggle", 0);
    assert.equal(f.runtime.countRenderedByClass("notes-root", "logic-narrative-note-body"), 0);
  } finally { f.dispose(); }
});

test("touch scrolling stays inside the note and keyboard markers use one roving tab stop", () => {
  const f = browserFixture();
  try {
    f.controller.setScenario(f.reading());
    assert.equal(f.runtime.getRenderedAttributeByClass("notes-root", "logic-narrative-note-marker", "tabindex"), "0");
    f.runtime.dispatchRenderedEventByClass("notes-root", "logic-narrative-note-body", "pointerdown", { pointerType: "touch", pointerId: 1, clientY: 100 });
    f.runtime.dispatchRenderedEventByClass("notes-root", "logic-narrative-note-body", "pointermove", { pointerType: "touch", pointerId: 1, clientY: 20, preventDefault() {} });
    assert.equal(f.runtime.getRenderedScrollByClass("notes-root", "logic-narrative-note-body").top, 80);
    assert.equal(f.reveals.length, 0, "text scrolling cannot pan the graph");
  } finally { f.dispose(); }
});
