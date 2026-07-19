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
  assert.match(menuItem?.when ?? "", /python.*java/u);
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
  const typescriptResolver = readSource(
    "src/analyzer/functionLogic/typescriptFunctionCursorResolver.ts"
  );
  const resolver = readSource("src/analyzer/functionLogic/functionCursorResolver.ts");
  const pythonResolver = readSource(
    "src/analyzer/functionLogic/languages/python/pythonFunctionCursorResolver.ts"
  );
  const javaResolver = readSource(
    "src/analyzer/functionLogic/languages/java/javaFunctionCursorResolver.ts"
  );
  const provider = readSource("src/webview/explorerViewProvider.ts");
  const panel = readSource(
    "src/webview/functionVisualizer/functionVisualizerPanelProvider.ts"
  );
  const codeFlowHost = readSource("src/webview/codeFlow/codeFlowHostDelivery.ts");

  assert.match(typescriptResolver, /while \(pending\.length > 0\)/u);
  assert.match(resolver, /case "python"/u);
  assert.match(resolver, /case "java"/u);
  assert.match(pythonResolver, /collectPythonCallables/u);
  assert.match(javaResolver, /collectJavaCallables/u);
  assert.doesNotMatch(
    [typescriptResolver, resolver, pythonResolver, javaResolver].join("\n"),
    /from ".*(?:vscode|webview|protocol|extension)/u
  );
  assert.match(panel, /createWebviewPanel/u);
  assert.match(panel, /functionVisualizer\/sessionLoaded/u);
  assert.match(panel, /new WebviewGraphDelivery\(\)/u);
  assert.match(panel, /new SourceNodeTokenRegistry\(\)/u);
  assert.match(panel, /publishFunctionNode/u);
  assert.match(provider, /functionVisualizerPanelProvider\.openFunction/u);
  assert.doesNotMatch(provider, /CurrentFunctionVisualizationHostDelivery/u);
  assert.match(codeFlowHost, /public async publishFunctionNode/u);
});

test("Python and Java logic adapters share iterative CFG contracts", () => {
  const dispatcher = readSource("src/analyzer/functionLogic/functionLogicAnalyzer.ts");
  const lezerAnalyzer = readSource(
    "src/analyzer/functionLogic/core/lezerFunctionLogicAnalyzer.ts"
  );
  const structuredControl = readSource(
    "src/analyzer/functionLogic/core/structuredControlFlow.ts"
  );
  const python = readSource(
    "src/analyzer/functionLogic/languages/python/pythonFunctionLogicAnalyzer.ts"
  );
  const java = readSource(
    "src/analyzer/functionLogic/languages/java/javaFunctionLogicAnalyzer.ts"
  );
  const rustSupplement = readSource("src/analyzer/rust/rustAnalyzerBackend.ts");

  assert.match(dispatcher, /analyzePythonFunctionLogic/u);
  assert.match(dispatcher, /analyzeJavaFunctionLogic/u);
  assert.match(lezerAnalyzer, /while \(pending\.length > 0\)/u);
  assert.match(lezerAnalyzer, /createStructuredControlEdges/u);
  assert.match(structuredControl, /while \(currentBlock\)/u);
  assert.match(structuredControl, /while \(container\?\.ownerBlockId\)/u);
  assert.match(python, /LezerFunctionLogicAdapter/u);
  assert.match(java, /LezerFunctionLogicAdapter/u);
  assert.match(rustSupplement, /addSupplementalLanguages/u);
  assert.doesNotMatch(
    [lezerAnalyzer, structuredControl, python, java].join("\n"),
    /from ".*(?:vscode|webview|protocol|extension)/u
  );
});

test("shared Python and Java syntax stays below Function Logic boundaries", () => {
  const lezerSource = readSource("src/analyzer/core/lezerSource.ts");
  const pythonSyntax = readSource("src/analyzer/languages/python/pythonLezerSyntax.ts");
  const javaSyntax = readSource("src/analyzer/languages/java/javaLezerSyntax.ts");

  assert.match(lezerSource, /while \(pending\.length > 0\)/u);
  assert.doesNotMatch(
    [pythonSyntax, javaSyntax].join("\n"),
    /from ".*functionLogic/u
  );
});

test("value-change evidence stays language-adapted, complete, and UI-independent", () => {
  const support = readSource(
    "src/analyzer/functionLogic/valueChanges/valueChangeSupport.ts"
  );
  const typescript = readSource(
    "src/analyzer/functionLogic/valueChanges/typescriptValueChanges.ts"
  );
  const python = readSource(
    "src/analyzer/functionLogic/valueChanges/pythonValueChanges.ts"
  );
  const java = readSource(
    "src/analyzer/functionLogic/valueChanges/javaValueChanges.ts"
  );
  const combined = [support, typescript, python, java].join("\n");

  assert.match(support, /normalizeValueChangeText/u);
  assert.match(support, /const seen = new Set<string>\(\)/u);
  assert.doesNotMatch(support, /MAX_VALUE_CHANGES_PER_BLOCK|slice\([^)]*\).*…/u);
  assert.match(support, /isPotentialReceiverMutationMethod/u);
  assert.match(typescript, /while \(pending\.length > 0\)/u);
  assert.match(python, /while \(pending\.length > 0\)/u);
  assert.match(java, /while \(pending\.length > 0\)/u);
  assert.match(combined, /confidence: "inferred"/u);
  assert.doesNotMatch(combined, /from ".*(?:webview|protocol|vscode|extension)/u);
});

test("child functions use bounded iterative attachment on one shared graph canvas", () => {
  const browser = readSource(
    "src/webview/functionVisualizer/functionVisualizerBrowserSource.ts"
  );
  const compoundScene = readSource(
    "src/webview/functionVisualizer/compoundFunctionLogicGraphSource.ts"
  );
  const compoundRouting = readSource(
    "src/webview/functionVisualizer/compoundFunctionLogicRoutingSource.ts"
  );
  const compoundDimensions = readSource(
    "src/webview/functionVisualizer/compoundFunctionLogicDimensionsSource.ts"
  );
  const sharedRenderer = readSource(
    "src/webview/codeFlow/functionLogicBrowserSource.ts"
  );
  const graphStyles = readSource(
    "src/webview/codeFlow/functionLogicGraphStyles.ts"
  );

  assert.match(browser, /MAX_ATTACHED_FUNCTION_DEPTH = 6/u);
  assert.match(browser, /MAX_ATTACHED_FUNCTIONS = 32/u);
  assert.match(browser, /while \(cursor < pendingIds\.length\)/u);
  assert.match(browser, /visitedScopeIds/u);
  assert.match(browser, /status = ancestorTokens\.includes/u);
  assert.match(browser, /createAttachedFunctionGraphScene/u);
  assert.match(browser, /renderFunctionLogic\(\s*attachedScene\.logic/u);
  assert.match(browser, /captureLogicGraphViewport/u);
  assert.match(browser, /restoreLogicGraphViewport/u);
  assert.match(browser, /enteringAttachedFunctionIds/u);
  assert.doesNotMatch(browser, /renderInlineFunctionExpansions|createInlineExpansionCard/u);
  assert.match(compoundScene, /while \(scopeCursor < pendingScopeIds\.length\)/u);
  assert.match(compoundScene, /createCompoundFunctionGraphLayout/u);
  assert.match(compoundScene, /rankBounds/u);
  assert.match(compoundScene, /relation: "call"/u);
  assert.match(compoundScene, /compound-resume:/u);
  assert.match(compoundScene, /relation: "callReturn"/u);
  assert.match(compoundScene, /getCompoundFunctionLogicDimensionsSource/u);
  assert.match(compoundScene, /measureCompoundBlockDimensions/u);
  assert.match(compoundDimensions, /function measureCompoundBlockDimensions/u);
  assert.doesNotMatch(
    compoundScene,
    /slice\(0, (?:31|41)\).*…/u
  );
  assert.match(compoundRouting, /orderCompoundBlocksByParentLane/u);
  assert.match(compoundRouting, /sourceTrackIndex/u);
  assert.match(compoundRouting, /targetTrackIndex/u);
  assert.match(compoundRouting, /sourceX/u);
  assert.match(compoundRouting, /targetX/u);
  assert.doesNotMatch(compoundScene, /from ".*application/u);
  assert.doesNotMatch(compoundRouting, /from ".*application/u);
  assert.doesNotMatch(compoundDimensions, /from ".*application/u);
  assert.match(sharedRenderer, /createFunctionLogicGraph\(logic, graphContext\)/u);
  assert.match(sharedRenderer, /graphContext\.onExpandableBlockClick\(block\)/u);
  assert.match(sharedRenderer, /graphContext\.onGraphRendered/u);
  assert.match(sharedRenderer, /logic-node-entering/u);
  assert.match(sharedRenderer, /logic-edge-entering/u);
  assert.match(sharedRenderer, /normalizeLogicVisualDepth/u);
  assert.match(sharedRenderer, /logic-depth-/u);
  assert.doesNotMatch(sharedRenderer, /compactTargetLabel/u);
  assert.match(graphStyles, /--logic-node-depth-overlay/u);
  assert.match(graphStyles, /\.logic-depth-5/u);
  assert.match(graphStyles, /@keyframes logic-child-node-enter/u);
  assert.match(graphStyles, /prefers-reduced-motion: reduce/u);
  assert.doesNotMatch(
    graphStyles,
    /\.flow-badge\.logic-node-function\s*\{[^}]*text-overflow:\s*ellipsis/su
  );
  assert.doesNotMatch(
    graphStyles,
    /\.flow-badge\.logic-transfer\s*\{[^}]*text-overflow:\s*ellipsis/su
  );
  assert.doesNotMatch(graphStyles, /text-overflow:\s*ellipsis/u);
});

/** Reads one repository file for stable composition and dependency assertions. */
function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}
