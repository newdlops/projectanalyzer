/** Exercises real Scenario evaluation reuse and invalidation through the generated trace/playback API. */
import assert from "node:assert/strict";
import test from "node:test";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import { getFunctionLogicScenarioEvaluatorBrowserSource, getFunctionLogicScenarioTraceBrowserSource, getFunctionLogicValuePreviewBrowserSource } from "../../webview/codeFlow/valuePreview";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

test("trace and repeated playback reads share one unchanged scenario evaluation", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const { trace, evaluations, preview } = createTrace();
    preview("input", "4");
    trace.setSelectedBinding("result");
    const frames = trace.readFrames("result");
    assert.equal(frames[0].carriedValue, "8");
    for (let index = 0; index < 100; index += 1) trace.readFrames("result");
    trace.refresh();
    assert.equal(evaluations(), 1, "playback state updates must not rerun the interpreter");
    assert.equal(trace.readFrames("input")[0].carriedValue, "4");
    assert.equal(evaluations(), 1, "binding selection must reuse the same calculation");
  } finally { runtime.restore(); }
});

test("editing a scenario input invalidates the cached result without retaining old frames", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const { trace, evaluations, preview } = createTrace();
    preview("input", "4");
    assert.equal(trace.readFrames("result")[0].carriedValue, "8");
    preview("input", "7");
    assert.equal(trace.readFrames("result")[0].carriedValue, "14");
    trace.refresh(); trace.readFrames("result");
    assert.equal(evaluations(), 2);
  } finally { runtime.restore(); }
});

test("changed node and edge reachability invalidates Scenario playback frames", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const { trace, evaluations, preview, nodes, edges } = createTrace();
    preview("input", "4");
    assert.equal(trace.readFrames("result")[0].carriedValue, "8");
    edges.get("next")!.path.classList.add("choice-dimmed");
    assert.notEqual(trace.readFrames("result")[0].carriedValue, "8");
    edges.get("next")!.path.classList.remove("choice-dimmed");
    nodes.get("calculate")!.classList.add("choice-dimmed");
    trace.readFrames("result");
    assert.equal(evaluations(), 3);
  } finally { runtime.restore(); }
});

test("locale refresh reformats cached unknown frames without rerunning the interpreter", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const { trace, evaluations, setLanguage } = createTrace();
    const english = trace.readFrames("input")[0].status;
    setLanguage("ko");
    const korean = trace.readFrames("input")[0].status;
    assert.notEqual(korean, english);
    assert.match(korean, /입력/);
    assert.equal(evaluations(), 1);
  } finally { runtime.restore(); }
});

test("unchanged binding refresh keeps the visible trace rows mounted", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const { trace, preview } = createTrace();
    document.getElementById("trace-root")!.append(trace.element);
    preview("input", "4"); trace.setSelectedBinding("result");
    const row = runtime.getRenderedIdentityByClassNth("trace-root", "logic-scenario-step", 0);
    trace.setSelectedBinding("result"); trace.refresh();
    assert.equal(runtime.getRenderedIdentityByClassNth("trace-root", "logic-scenario-step", 0), row);
  } finally { runtime.restore(); }
});

test("symbolic-only binding inspection never offers a calculated value trace", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const { trace, evaluations } = createTrace(true);
    assert.equal(trace.element.hidden, true);
    trace.setSelectedBinding("input"); trace.refresh();
    assert.deepEqual(trace.readFrames("input"), []);
    assert.equal(evaluations(), 0, "source binding inspection must not start a value calculation");
  } finally { runtime.restore(); }
});

/** Linear source-calculable fixture: result = input * 2. Counts the real interpreter boundary. */
function createTrace(symbolicOnly = false) {
  const nodes = new Map(["entry", "calculate"].map((id) => [id, document.createElement("button")]));
  const edges = new Map([["next", { path: document.createElement("path") }]]);
  const logic = {
    ...(symbolicOnly ? { tutor: { program: { evaluationMode: "symbolic-only" } } } : {}),
    blocks: [
      { id: "entry", kind: "entry", label: "input", valueAccesses: [{ bindingId: "input", access: "define", confidence: "exact" }] },
      { id: "calculate", kind: "mutation", label: "result = input * 2", valueChanges: [{ target: "result", targetKind: "variable", operation: "initialize", operator: "=", value: "input * 2", confidence: "exact" }] }
    ],
    edges: [{ id: "next", sourceId: "entry", targetId: "calculate", kind: "next", confidence: "exact" }],
    valueBindings: [
      { id: "input", name: "input", kind: "parameter", definitionBlockId: "entry", confidence: "exact" },
      { id: "result", name: "result", kind: "local", definitionBlockId: "calculate", confidence: "exact" }
    ], layout: { nodes: [] }
  };
  return new Function("logic", "nodes", "edges", `${getBrowserLocalizationSource()}
    ${getFunctionLogicValuePreviewBrowserSource()}${getFunctionLogicScenarioEvaluatorBrowserSource()}${getFunctionLogicScenarioTraceBrowserSource()}
    const formatLogicBlockLabel = block => block.label;
    const formatFunctionLogicBindingKind = kind => kind;
    let evaluations = 0; const evaluate = calculateFunctionLogicScenario;
    calculateFunctionLogicScenario = (...args) => { evaluations += 1; return evaluate(...args); };
    const trace = createFunctionLogicScenarioTrace(logic, nodes, edges);
    return { trace, nodes, edges, evaluations: () => evaluations, preview: writeFunctionLogicValuePreview, setLanguage: applyProjectAnalyzerLanguage };
  `)(logic, nodes, edges) as {
    trace: { element: HTMLElement; refresh(): void; setSelectedBinding(id: string): void; readFrames(id: string): Array<{ carriedValue: string; status: string }> };
    nodes: typeof nodes; edges: typeof edges;
    evaluations(): number; preview(id: string, value: string): void; setLanguage(language: string): void;
  };
}
