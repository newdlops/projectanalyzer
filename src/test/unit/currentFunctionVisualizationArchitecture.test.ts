/**
 * Architecture guards for the editor-context visualization entrypoint. They
 * keep command activation, menu scope, AST resolution, and editor-tab delivery wired.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(__dirname, "../../..");

test("package contributions activate and expose the current-function editor menu", () => {
  const packageJson = JSON.parse(readSource("package.json")) as {
    activationEvents: string[];
    contributes: {
      commands: Array<{ command: string; title: string }>;
      menus: Record<string, Array<{ command: string; when?: string }>>;
    };
  };
  const commandId = "projectAnalyzer.visualizeCurrentFunction";

  assert.ok(packageJson.activationEvents.includes(`onCommand:${commandId}`));
  assert.ok(packageJson.contributes.commands.some((command) =>
    command.command === commandId && command.title === "Visualize Current Function"
  ));
  const contextMenu = packageJson.contributes.menus["editor/context"] ?? [];
  const menuItem = contextMenu.find((item) => item.command === commandId);
  assert.match(menuItem?.when ?? "", /typescript.*javascript/u);
});

test("activation registers a text-editor command that opens the dedicated panel", () => {
  const activation = readSource("src/extension/activate.ts");
  const command = readSource(
    "src/extension/currentFunctionVisualization/currentFunctionVisualizationCommand.ts"
  );

  assert.match(activation, /registerCurrentFunctionVisualizationCommand\(context, services\)/u);
  assert.match(command, /registerTextEditorCommand/u);
  assert.match(command, /findFunctionAtPosition/u);
  assert.match(command, /analyzer\.analyzeFile/u);
  assert.match(command, /resolveCurrentFunctionGraph/u);
  assert.match(command, /functionVisualizerPanelProvider\.openFunction/u);
  assert.doesNotMatch(command, /workbench\.view\.extension\.projectAnalyzer/u);
});

test("cursor resolution stays host-independent and the panel owns isolated delivery", () => {
  const resolver = readSource(
    "src/analyzer/functionLogic/typescriptFunctionCursorResolver.ts"
  );
  const provider = readSource("src/webview/explorerViewProvider.ts");
  const panel = readSource(
    "src/webview/functionVisualizer/functionVisualizerPanelProvider.ts"
  );
  const codeFlowHost = readSource("src/webview/codeFlow/codeFlowHostDelivery.ts");

  assert.match(resolver, /while \(pending\.length > 0\)/u);
  assert.doesNotMatch(resolver, /from ".*(?:vscode|webview|protocol|extension)/u);
  assert.match(panel, /createWebviewPanel/u);
  assert.match(panel, /functionVisualizer\/sessionLoaded/u);
  assert.match(panel, /new WebviewGraphDelivery\(\)/u);
  assert.match(panel, /new SourceNodeTokenRegistry\(\)/u);
  assert.match(panel, /publishFunctionNode/u);
  assert.match(provider, /functionVisualizerPanelProvider\.openFunction/u);
  assert.doesNotMatch(provider, /CurrentFunctionVisualizationHostDelivery/u);
  assert.match(codeFlowHost, /public async publishFunctionNode/u);
});

/** Reads one repository file for stable composition and dependency assertions. */
function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}
