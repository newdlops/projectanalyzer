/** Generated-renderer lifecycle tests for detached subscriptions and obsolete root payloads. */
import assert from "node:assert/strict";
import test from "node:test";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import { getFunctionVisualizerBrowserSource } from "../../webview/functionVisualizer/functionVisualizerBrowserSource";
import { getCodeFlowBrowserSource } from "../../webview/codeFlow/codeFlowBrowserSource";
import { getFunctionLogicScenarioWorkspaceBrowserSource } from "../../webview/codeFlow/scenarioWorkspace";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

test("disposing the rendered graph releases Guide and Values DOM subscriptions", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const renderer = new Function(`${getBrowserLocalizationSource()}${getFunctionVisualizerBrowserSource()}
      return { dispose: disposeActiveFunctionLogicViewport, registry: functionLogicScenarioWorkspaceRegistry };`
    )() as { dispose(): void; registry: Map<string, { markModified(): void }> };
    runtime.dispatchMessage({ type: "functionVisualizer/sessionLoaded", payload: {
      graphVersion: "lifecycle", root: { sourceToken: "root-token", label: "Root" }
    } });
    runtime.dispatchMessage({ type: "codeFlow/detailLoaded", payload: {
      graphVersion: "lifecycle", kind: "functionLogic", title: "Root", subtitle: "root.ts:1", origins: [], gaps: [],
      logic: {
        language: "typescript", signature: "function root() {}",
        blocks: [{ id: "entry", kind: "entry", label: "Root", confidence: "exact", depth: 0 }], edges: [],
        valueBindings: [], valueFlows: [], callees: [],
        summary: { blockCount: 1, branchCount: 0, loopCount: 0, callCount: 0, effectCount: 0, mutationCount: 0, exitCount: 0 },
        layout: { width: 240, height: 160, nodes: [{ blockId: "entry", x: 20, y: 20, width: 200, height: 100, rank: 0, lane: 0 }], edges: [] },
        tutor: { id: "lifecycle-tutor", availability: "available", parameters: [], seeds: [], guide: { chapters: [] }, context: { counts: {} } }
      }
    } });
    runtime.clickRenderedByClassNth("flow-steps", "logic-guide-toggle", 0);
    runtime.setRenderedOpenByClassNth("flow-steps", "logic-guide-scenarios", 0, true);
    const workspace = [...renderer.registry.values()][0];
    assert.ok(workspace);
    renderer.dispose();
    const writes = runtime.textValues.length;
    workspace.markModified();
    assert.equal(runtime.textValues.length, writes, "disposed graph consumers must not rewrite detached DOM");
  } finally { runtime.restore(); }
});

test("same-root workspace relayout reuses results and a new root expires the old session", () => {
  const acquire = new Function(`${getFunctionLogicScenarioWorkspaceBrowserSource()}
    return acquireFunctionLogicScenarioWorkspace;`
  )() as (key: string, tutor: object) => { read(): { results: Map<string, unknown> } };
  const tutor = { id: "root-cache", seeds: [] };
  const first = acquire("root-a", tutor);
  first.read().results.set("seed", [{ terminal: { kind: "return" } }]);
  assert.equal(acquire("root-a", tutor), first, "relayout must preserve cached scenario results");
  acquire("root-b", tutor);
  const reopened = acquire("root-a", tutor);
  assert.notEqual(reopened, first, "a previous root must not keep its payload and subscribers alive");
  assert.equal(reopened.read().results.size, 0);
});

for (const surface of [
  { name: "Function Visualizer root replacement", source: getFunctionVisualizerBrowserSource,
    message: { type: "functionVisualizer/sessionLoaded", payload: { graphVersion: "new-root", root: { sourceToken: "next-root", label: "Next" } } } },
  { name: "sidebar graph reset", source: getCodeFlowBrowserSource, message: { type: "graph/cleared", payload: {} } }
]) {
  test(`${surface.name} expires cached results before the next body loads`, () => {
    const runtime = installSidebarWebviewRuntime();
    try {
      const renderer = new Function(`${getBrowserLocalizationSource()}${surface.source()}
        return { acquire: acquireFunctionLogicScenarioWorkspace, registry: functionLogicScenarioWorkspaceRegistry };`
      )() as { acquire(key: string, tutor: object): { read(): { results: Map<string, unknown> } }; registry: Map<string, unknown> };
      const retired = renderer.acquire("old-root", { id: "old-tutor", seeds: [] });
      retired.read().results.set("seed", [{ terminal: { kind: "return" } }]);
      runtime.dispatchMessage(surface.message);
      assert.equal(renderer.registry.size, 0, "a loading, failed, or cleared root must not retain its previous Tutor payload");
      assert.equal(retired.read().results.size, 0);
    } finally { runtime.restore(); }
  });
}

test("graph disposal releases registered preview DOM while preserving same-root input values", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const renderer = new Function(`${getBrowserLocalizationSource()}${getFunctionVisualizerBrowserSource()}
      return { dispose: disposeActiveFunctionLogicViewport, makeLabel: createFunctionLogicValuePreviewLabel,
        write: writeFunctionLogicValuePreview, read: readFunctionLogicValuePreview, labels: functionLogicValuePreviewElementsByBindingId };`
    )() as { dispose(): void; makeLabel(id: string): HTMLElement; write(id: string, value: string): void; read(id: string): string; labels: Map<string, Set<HTMLElement>> };
    runtime.dispatchMessage({ type: "functionVisualizer/sessionLoaded", payload: {
      graphVersion: "preview-lifecycle", root: { sourceToken: "preview-root", label: "Root" }
    } });
    runtime.dispatchMessage({ type: "codeFlow/detailLoaded", payload: {
      graphVersion: "preview-lifecycle", kind: "functionLogic", title: "Root", subtitle: "root.ts:1", origins: [], gaps: [],
      logic: {
        language: "typescript", signature: "function root() {}",
        blocks: [{ id: "entry", kind: "entry", label: "Root", confidence: "exact", depth: 0 }], edges: [],
        valueBindings: [], valueFlows: [], callees: [],
        summary: { blockCount: 1, branchCount: 0, loopCount: 0, callCount: 0, effectCount: 0, mutationCount: 0, exitCount: 0 },
        layout: { width: 240, height: 160, nodes: [{ blockId: "entry", x: 20, y: 20, width: 200, height: 100, rank: 0, lane: 0 }], edges: [] }
      }
    } });
    renderer.write("input", "42");
    document.getElementById("flow-steps")!.append(renderer.makeLabel("input"));
    assert.equal(renderer.labels.get("input")?.size, 1);
    renderer.dispose();
    assert.equal(renderer.labels.size, 0, "a relayout must not retain graph/detail DOM in the label registry");
    assert.equal(renderer.read("input"), "42", "teardown must preserve editable values for same-root relayout");
  } finally { runtime.restore(); }
});
