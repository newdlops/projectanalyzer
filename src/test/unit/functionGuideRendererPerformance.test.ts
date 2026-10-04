/** Behavioral regressions for idle Guide rendering and shared-workspace ownership. */
import assert from "node:assert/strict";
import test from "node:test";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import { getFunctionTutorBrowserSource } from "../../webview/codeFlow/tutor";
import { getFunctionLogicScenarioWorkspaceBrowserSource } from "../../webview/codeFlow/scenarioWorkspace";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";
import { installNativeDisclosureTasks } from "./helpers/nativeDisclosureRuntime";

test("opening Guide scenarios settles native toggle tasks and keeps its disclosure mounted", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const tasks = installNativeDisclosureTasks();
    const { panel, acquisitions } = createGuide();
    document.getElementById("guide-root")!.append(panel.section);
    panel.setActive(true);
    const disclosureId = runtime.getRenderedIdentityByClassNth("guide-root", "logic-guide-scenarios", 0);
    const disclosure = document.getElementById(disclosureId) as HTMLDetailsElement;
    disclosure.open = true;
    assert.doesNotThrow(() => tasks.flush());
    assert.equal(acquisitions(), 1, "a native disclosure activation must acquire once");
    assert.equal(runtime.getRenderedIdentityByClassNth("guide-root", "logic-guide-scenarios", 0), disclosureId);
    panel.refreshLanguage();
    assert.equal(tasks.flush(), 0, "localizing an open disclosure must not queue another toggle");
    assert.equal(disclosure.open, true);
    panel.dispose();
  } finally { runtime.restore(); }
});

test("Guide activation is idempotent and releases only its own workspace consumer", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const { panel, acquisitions, releases, workspace } = createGuide();
    document.getElementById("guide-root")!.append(panel.section);
    panel.setActive(true);
    runtime.setRenderedOpenByClassNth("guide-root", "logic-guide-scenarios", 0, true);
    workspace.acquire(); // A separate Values consumer must survive Guide updates.
    const acquired = acquisitions();
    panel.setActive(true); panel.setActive(true);
    assert.equal(acquisitions(), acquired);
    panel.setActive(false); panel.setActive(false); panel.dispose(); panel.dispose();
    assert.equal(releases(), 1, "repeated inactive/dispose calls must not release Values");
  } finally { runtime.restore(); }
});

test("disposing an open Guide cancels queued native toggles and unsubscribes its DOM", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const tasks = installNativeDisclosureTasks();
    const { panel, acquisitions, workspace } = createGuide();
    document.getElementById("guide-root")!.append(panel.section);
    panel.setActive(true);
    const id = runtime.getRenderedIdentityByClassNth("guide-root", "logic-guide-scenarios", 0);
    (document.getElementById(id) as HTMLDetailsElement).open = true;
    panel.dispose();
    tasks.flush(); workspace.markModified();
    assert.equal(acquisitions(), 0, "a disposed Guide must not activate from a queued toggle");
    assert.equal(runtime.getRenderedIdentityByClassNth("guide-root", "logic-guide-scenarios", 0), id);
  } finally { runtime.restore(); }
});

/** Runs the real generated panel and workspace with counters at their ownership boundary. */
function createGuide() {
  return new Function(`${getBrowserLocalizationSource()}
    ${getFunctionLogicScenarioWorkspaceBrowserSource()}
    ${getFunctionTutorBrowserSource()}
    const tutor = { id: "guide-performance", availability: "available", parameters: [], seeds: [], guide: { chapters: [] }, context: { counts: {} } };
    const workspace = acquireFunctionLogicScenarioWorkspace("root", tutor);
    let acquisitions = 0; let releases = 0;
    const acquire = workspace.acquire.bind(workspace); const release = workspace.release.bind(workspace);
    workspace.acquire = () => { acquisitions += 1; acquire(); };
    workspace.release = () => { releases += 1; release(); };
    const panel = createFunctionTutorPanel({ tutor }, { scenarioWorkspace: workspace });
    return { panel, workspace, acquisitions: () => acquisitions, releases: () => releases };
  `)() as {
    panel: { section: HTMLElement; setActive(active: boolean): void; refreshLanguage(): void; dispose(): void };
    workspace: { acquire(): void; markModified(): void };
    acquisitions(): number;
    releases(): number;
  };
}
