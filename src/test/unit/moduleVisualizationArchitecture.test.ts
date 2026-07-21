/**
 * Source-based architecture guards for project-level Module Flow integration.
 *
 * The checks keep command contribution, activation, composition, exact workspace
 * acquisition, and sidebar reuse connected without loading the VS Code runtime.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const OPEN_MODULE_FLOW_COMMAND = "projectAnalyzer.openModuleFlow";

test("package contributes a descriptive Module Flow command and sidebar title action", () => {
  const packageJson = JSON.parse(readSource("package.json")) as {
    activationEvents: string[];
    contributes: {
      commands: Array<{ command: string; title: string; category?: string }>;
      menus: Record<string, Array<{ command: string; when?: string }>>;
    };
  };

  assert.ok(
    packageJson.activationEvents.includes(`onCommand:${OPEN_MODULE_FLOW_COMMAND}`)
  );
  assert.ok(packageJson.contributes.commands.some((command) =>
    command.command === OPEN_MODULE_FLOW_COMMAND
      && command.title === "Open Project Module Flow"
      && command.category === "Code Flow"
  ));

  const viewTitleItem = (packageJson.contributes.menus["view/title"] ?? [])
    .find((item) => item.command === OPEN_MODULE_FLOW_COMMAND);
  assert.equal(viewTitleItem?.when, "view == projectAnalyzer.explorerView");
  assert.equal(
    (packageJson.contributes.menus["editor/context"] ?? [])
      .some((item) => item.command === OPEN_MODULE_FLOW_COMMAND),
    false
  );
});

test("activation registers the Module Flow command with shared services", () => {
  const activation = readSource("src/extension/activate.ts");

  assert.match(
    activation,
    /import \{ registerModuleVisualizationCommand \} from "\.\/moduleVisualization"/u
  );
  assert.match(
    activation,
    /registerModuleVisualizationCommand\(context, services\)/u
  );
});

test("the composition root constructs one coordinator and one module panel", () => {
  const services = readSource("src/extension/extensionServices.ts");

  assert.equal(countMatches(services, /new WorkspaceGraphCoordinator\(/gu), 1);
  assert.equal(countMatches(services, /new ModuleVisualizerPanelProvider\(/gu), 1);
  assert.match(services, /moduleVisualizerPanelProvider: ModuleVisualizerPanelProvider/u);
  assert.match(services, /workspaceGraphCoordinator: WorkspaceGraphCoordinator/u);
  assert.match(services, /moduleVisualizerPanelProvider,\s*workspaceGraphCoordinator\s*\}/su);
  assert.match(services, /openModuleFlow: \(\) => openModuleFlow\(\{/u);
  assert.match(services, /workspaceGraphCoordinator\s*\n\s*\}\);/u);
});

test("the sidebar exposes a labeled accessible Module Flow launcher", () => {
  const html = readSource("src/webview/webviewHtml.ts");
  const browser = readSource("src/webview/codeFlow/codeFlowBrowserSource.ts");
  const provider = readSource("src/webview/explorerViewProvider.ts");

  assert.match(html, /id="open-module-flow"/u);
  assert.match(html, /See how modules connect/u);
  assert.match(html, /title="Open Project Module Flow in a new editor tab"/u);
  assert.match(html, /aria-describedby="module-flow-description module-flow-action-hint"/u);
  assert.match(browser, /type: "moduleFlow\/open", payload: \{\}/u);
  assert.match(browser, /moduleFlow\/openCompleted/u);
  assert.match(browser, /state\.moduleFlowOpening/u);
  assert.match(provider, /case "moduleFlow\/open":/u);
  assert.match(provider, /type: "moduleFlow\/openCompleted"/u);
});

test("the command uses only exact coordinator acquisition and the module panel", () => {
  const command = readSource(
    "src/extension/moduleVisualization/moduleVisualizationCommand.ts"
  );

  assert.match(
    command,
    /workspaceGraphCoordinator\.resolveWorkspaceGraph\(\)/u
  );
  assert.match(
    command,
    /moduleVisualizerPanelProvider\.openGraph\(resolution\.graph\)/u
  );
  assert.doesNotMatch(
    command,
    /getLatestGraph|getLatestGraphForScope|getReusableWorkspaceGraph|analyzer\.analyzeWorkspace/u
  );
  assert.doesNotMatch(
    command,
    /ExplorerGraphPanelProvider|explorerGraphPanelProvider|graphPanelProvider/u
  );
});

test("Explorer workspace analysis delegates to the coordinator without latest fallback", () => {
  const explorer = readSource("src/webview/explorerViewProvider.ts");
  const workspaceAnalysis = extractSourceRegion(
    explorer,
    "private async runWorkspaceAnalysis",
    "private async runCurrentFileAnalysis"
  );

  assert.match(
    workspaceAnalysis,
    /workspaceGraphCoordinator\.resolveWorkspaceGraph\(\)/u
  );
  assert.doesNotMatch(
    workspaceAnalysis,
    /analyzer\.analyzeWorkspace|getLatestGraph|getLatestGraphForScope|getReusableWorkspaceGraph/u
  );
  assert.doesNotMatch(
    explorer,
    /WorkspaceCacheMatch|getReusableWorkspaceGraph|getLatestGraphForScope|cacheLatestFallback/u
  );
  assert.doesNotMatch(explorer, /createWorkspaceCacheKey/u);
});

test("edge crossing bridges stay inside the pure iterative Module Flow layer", () => {
  const bridges = readSource(
    "src/application/moduleFlow/moduleFlowEdgeBridges.ts"
  );
  const routing = readSource(
    "src/application/moduleFlow/moduleFlowGraphRouting.ts"
  );

  assert.match(bridges, /export function createModuleFlowEdgeBridges/u);
  assert.match(bridges, /while \(low < high\)/u);
  assert.match(bridges, /for \(const crossingSegment of vertical\)/u);
  assert.match(bridges, /export function createModuleFlowEdgePath/u);
  assert.match(bridges, /export function createModuleFlowBridgeDirectionPath/u);
  assert.doesNotMatch(bridges, /from "(?:\.\.\/)*(?:webview|vscode|extension|protocol)/u);
  assert.match(
    routing,
    /createModuleFlowEdgeBridgesForRouting\(result\)/u
  );
});

test("same-canvas Function Logic uses isolated delivery and browser adapters", () => {
  const provider = readSource(
    "src/webview/moduleVisualizer/moduleVisualizerPanelProvider.ts"
  );
  const delivery = readSource(
    "src/webview/moduleVisualizer/moduleFlowFunctionLogicDelivery.ts"
  );
  const scene = readSource(
    "src/webview/moduleVisualizer/moduleFlowFunctionLogicScene.ts"
  );
  const browser = readSource(
    "src/webview/moduleVisualizer/moduleVisualizerBrowserSource.ts"
  );
  const componentFocus = readSource(
    "src/webview/moduleVisualizer/moduleFlowModuleComponentFocus.ts"
  );
  const lineageFocus = readSource(
    "src/webview/moduleVisualizer/moduleFlowLineageFocus.ts"
  );

  assert.match(provider, /new ModuleFlowFunctionLogicDelivery\(/u);
  assert.doesNotMatch(provider, /openFunction/u);
  assert.match(delivery, /analyzeFunctionLogic\(/u);
  assert.match(delivery, /createFunctionLogicCodeFlowDetail\(/u);
  assert.match(delivery, /resolveFunctionNode\(request\.functionId\)/u);
  assert.match(scene, /export function createModuleFlowFunctionLogicScene/u);
  assert.doesNotMatch(scene, /(?:vscode|node:fs|readFile)/u);
  assert.match(browser, /getModuleFlowFunctionLogicBrowserSource\(\)/u);
  assert.match(browser, /getModuleFlowFunctionLogicSceneBrowserSource\(\)/u);
  assert.match(browser, /getModuleFlowModuleComponentFocusBrowserSource\(\)/u);
  assert.match(componentFocus, /export function selectModuleFlowComponentFocus/u);
  assert.doesNotMatch(componentFocus, /(?:vscode|node:fs|readFile)/u);
  assert.match(browser, /getModuleFlowLineageFocusBrowserSource\(\)/u);
  assert.match(lineageFocus, /export function createModuleFlowLineageScene/u);
  assert.match(lineageFocus, /while \(cursor < queue\.length\)/u);
  assert.doesNotMatch(lineageFocus, /(?:vscode|node:fs|readFile)/u);
});

/** Reads a repository source file without assuming the compiled output location. */
function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

/** Counts explicit construction sites using a caller-supplied global pattern. */
function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

/** Extracts one class-method region for focused dependency assertions. */
function extractSourceRegion(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}
