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
    publisher: string;
    activationEvents: string[];
    contributes: {
      commands: Array<{ command: string; title: string; category?: string }>;
      menus: Record<string, Array<{ command: string; when?: string }>>;
    };
  };
  const commandId = "projectAnalyzer.visualizeCurrentFunction";

  assert.equal(packageJson.publisher, "newdlops");
  assert.ok(packageJson.activationEvents.includes(`onCommand:${commandId}`));
  assert.deepEqual(
    packageJson.contributes.commands.filter((command) => command.command === commandId),
    [{
      command: commandId,
      title: "Visualize Current Function",
      category: "Code Flow"
    }]
  );
  const contextMenu = packageJson.contributes.menus["editor/context"] ?? [];
  const currentFunctionItems = contextMenu.filter((item) => item.command === commandId);
  assert.equal(currentFunctionItems.length, 1);
  const menuItem = currentFunctionItems[0];
  assert.match(menuItem?.when ?? "", /typescript.*javascript/u);
  assert.match(menuItem?.when ?? "", /python.*java/u);
  assert.match(menuItem?.when ?? "", /fsharp.*ocaml.*elixir/u);
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
  const functionalResolver = readSource(
    "src/analyzer/functionLogic/languages/functional/functionalFunctionCursorResolver.ts"
  );
  const provider = readSource("src/webview/explorerViewProvider.ts");
  const panel = readSource(
    "src/webview/functionVisualizer/functionVisualizerPanelProvider.ts"
  );
  const codeFlowHost = readSource("src/webview/codeFlow/codeFlowHostDelivery.ts");

  assert.match(typescriptResolver, /while \(pending\.length > 0\)/u);
  assert.match(resolver, /case "python"/u);
  assert.match(resolver, /case "java"/u);
  assert.match(resolver, /case "fsharp"/u);
  assert.match(resolver, /case "ocaml"/u);
  assert.match(resolver, /case "elixir"/u);
  assert.match(pythonResolver, /collectPythonCallables/u);
  assert.match(javaResolver, /collectJavaCallables/u);
  assert.match(functionalResolver, /parseFunctionalSource/u);
  assert.doesNotMatch(
    [typescriptResolver, resolver, pythonResolver, javaResolver, functionalResolver].join("\n"),
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

test("language logic adapters keep parser-specific semantics behind pure boundaries", () => {
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
  const functional = readSource(
    "src/analyzer/functionLogic/languages/functional/functionalFunctionLogicAnalyzer.ts"
  );
  const events = readSource(
    "src/analyzer/functionLogic/events/typescriptEventBindings.ts"
  );
  const expressionPlanner = readSource(
    "src/analyzer/functionLogic/expressions/typescriptExpressionPlanner.ts"
  );
  const expressionExpansion = readSource(
    "src/analyzer/functionLogic/expressions/typescriptExpressionExpansion.ts"
  );
  const rustSupplement = readSource("src/analyzer/rust/rustAnalyzerBackend.ts");
  const services = readSource("src/extension/extensionServices.ts");

  assert.match(dispatcher, /analyzePythonFunctionLogic/u);
  assert.match(dispatcher, /analyzeJavaFunctionLogic/u);
  assert.match(dispatcher, /analyzeFunctionalFunctionLogic/u);
  assert.match(lezerAnalyzer, /while \(pending\.length > 0\)/u);
  assert.match(lezerAnalyzer, /createStructuredControlEdges/u);
  assert.match(structuredControl, /while \(currentBlock\)/u);
  assert.match(structuredControl, /while \(container\?\.ownerBlockId\)/u);
  assert.match(python, /LezerFunctionLogicAdapter/u);
  assert.match(java, /LezerFunctionLogicAdapter/u);
  assert.match(functional, /collectFunctionalPipelineChains/u);
  assert.match(functional, /for \(let index = 1; index < blocks\.length; index \+= 1\)/u);
  assert.match(events, /while \(pending\.length > 0\)/u);
  assert.match(events, /readTypeScriptEventBinding/u);
  assert.match(expressionPlanner, /while \(pending\.length > 0/u);
  assert.match(expressionPlanner, /QuestionQuestionToken/u);
  assert.match(expressionPlanner, /nestConditionalBranch/u);
  assert.match(expressionExpansion, /replaceBooleanControlAnchor/u);
  assert.match(expressionExpansion, /parentBlockId: block\.parentBlockId/u);
  assert.match(expressionExpansion, /remainingBlockBudget/u);
  assert.match(rustSupplement, /addSupplementalLanguages/u);
  assert.match(rustSupplement, /"fsharp"[\s\S]*"ocaml"[\s\S]*"elixir"/u);
  assert.match(services, /new FunctionalLanguageAnalyzer\(\)/u);
  assert.doesNotMatch(
    [
      lezerAnalyzer,
      structuredControl,
      python,
      java,
      functional,
      events,
      expressionPlanner,
      expressionExpansion
    ].join("\n"),
    /from ".*(?:vscode|webview|protocol|extension)/u
  );
});

test("shared parser syntax stays below Function Logic boundaries", () => {
  const lezerSource = readSource("src/analyzer/core/lezerSource.ts");
  const pythonSyntax = readSource("src/analyzer/languages/python/pythonLezerSyntax.ts");
  const javaSyntax = readSource("src/analyzer/languages/java/javaLezerSyntax.ts");
  const functionalSyntax = readSource(
    "src/analyzer/languages/functional/functionalPipelineSyntax.ts"
  );

  assert.match(lezerSource, /while \(pending\.length > 0\)/u);
  assert.doesNotMatch(
    [pythonSyntax, javaSyntax, functionalSyntax].join("\n"),
    /from ".*functionLogic/u
  );
});

test("branch choices use a pure iterative reachability module and shared renderer", () => {
  const choices = readSource(
    "src/webview/codeFlow/branchChoices/functionLogicBranchChoices.ts"
  );
  const renderer = readSource(
    "src/webview/codeFlow/functionLogicBrowserSource.ts"
  );
  const selection = readSource(
    "src/webview/codeFlow/functionLogicSelectionBrowserSource.ts"
  );
  const styles = readSource(
    "src/webview/codeFlow/branchChoices/functionLogicBranchChoiceStyles.ts"
  );

  assert.match(choices, /edge\.kind === "true"[\s\S]*edge\.kind === "false"[\s\S]*edge\.kind === "case"/u);
  assert.match(choices, /while \(cursor < pendingBlocks\.length\)/u);
  assert.match(choices, /const activeBlockIds = new Set/u);
  assert.match(choices, /const bestDepthByBlockId = new Map/u);
  assert.match(choices, /maximumDepth = blocks\.length/u);
  assert.match(choices, /pruneFunctionLogicBranchChoices/u);
  assert.doesNotMatch(choices, /from ".*(?:analyzer|application|protocol|vscode|extension)/u);
  assert.match(renderer, /getFunctionLogicBranchChoicesBrowserSource/u);
  assert.match(renderer, /applyFunctionLogicBranchChoicePresentation/u);
  assert.match(renderer, /label\.addEventListener\("keydown"/u);
  assert.match(selection, /createFunctionLogicBranchChoiceButton/u);
  assert.match(selection, /createFunctionLogicBranchChoiceSummary/u);
  assert.match(styles, /\.logic-edge\.choice-selected/u);
  assert.match(styles, /\.logic-graph-node\.choice-dimmed/u);
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

test("lexical value flow stays parser-adapted, bounded, iterative, and protocol-safe", () => {
  const projection = readSource(
    "src/analyzer/functionLogic/dataFlow/functionLogicDataFlow.ts"
  );
  const valueTypes = readSource("src/analyzer/functionLogic/dataFlow/types.ts");
  const typescript = readSource(
    "src/analyzer/functionLogic/dataFlow/typescriptFunctionDataFlow.ts"
  );
  const lezer = readSource(
    "src/analyzer/functionLogic/dataFlow/lezerFunctionDataFlow.ts"
  );
  const sharedLezerPipeline = readSource(
    "src/analyzer/functionLogic/core/lezerFunctionLogicAnalyzer.ts"
  );
  const protocol = readSource("src/protocol/functionLogic.ts");
  const renderer = readSource("src/webview/codeFlow/functionLogicBrowserSource.ts");
  const browser = readSource(
    "src/webview/codeFlow/dataFlow/functionLogicDataFlowBrowserSource.ts"
  );
  const compound = readSource(
    "src/webview/functionVisualizer/compoundFunctionLogicGraphSource.ts"
  );

  assert.match(projection, /maximumDepth = blocks\.length/u);
  assert.match(projection, /maximumFlows = DEFAULT_MAX_VALUE_FLOWS/u);
  assert.match(projection, /while \(cursor < pending\.length\)/u);
  assert.match(projection, /const bestDepthByBlockId = new Map/u);
  assert.match(projection, /findReachingDefinitionBlocks/u);
  assert.match(projection, /targetUsage/u);
  assert.match(valueTypes, /FunctionLogicValueUsageKind = "consume" \| "sink"/u);
  assert.match(typescript, /while \(pending\.length > 0\)/u);
  assert.match(typescript, /NodeFlags\.Const/u);
  assert.match(typescript, /classifyIdentifierUsage/u);
  assert.match(typescript, /isExternalAssignmentBoundary/u);
  assert.match(lezer, /collectPythonFunctionValueFacts/u);
  assert.match(lezer, /collectJavaFunctionValueFacts/u);
  assert.match(lezer, /classifyLezerValueUsage/u);
  assert.match(lezer, /\bfinal\b/u);
  assert.match(sharedLezerPipeline, /collectValueFacts/u);
  assert.doesNotMatch(
    [projection, typescript, lezer].join("\n"),
    /from ".*(?:webview|protocol|vscode|extension)/u
  );
  assert.match(protocol, /FunctionLogicValueBindingPayload/u);
  assert.match(protocol, /FunctionLogicValueFlowPayload/u);
  assert.match(protocol, /FunctionLogicValueUsagePayloadKind/u);
  assert.match(renderer, /getFunctionLogicDataFlowBrowserSource/u);
  assert.match(browser, /createFunctionLogicValueFlowPath/u);
  assert.match(browser, /formatFunctionLogicBindingKind/u);
  assert.match(browser, /formatFunctionLogicValueUsage/u);
  assert.match(browser, /logic-data-flow-sink-arrow/u);
  assert.match(compound, /createCompoundBindingId/u);
  assert.match(compound, /createCompoundValueFlowId/u);
});

test("Function Logic keeps a large graph surface and modular adjacent inspector drawer", () => {
  const renderer = readSource("src/webview/codeFlow/functionLogicBrowserSource.ts");
  const inspector = readSource(
    "src/webview/codeFlow/inspector/functionLogicInspectorBrowserSource.ts"
  );
  const inspectorStyles = readSource(
    "src/webview/codeFlow/inspector/functionLogicInspectorStyles.ts"
  );
  const visualizerStyles = readSource(
    "src/webview/functionVisualizer/functionVisualizerStyles.ts"
  );

  assert.match(renderer, /getFunctionLogicInspectorBrowserSource/u);
  assert.match(renderer, /inspector\.attachViewport\(viewport\)/u);
  assert.match(renderer, /inspector\.prependSections\(/u);
  assert.match(renderer, /inspector\.appendSections\(/u);
  assert.match(renderer, /valueFlowRendering\?\.valuePreviewEditor/u);
  assert.match(renderer, /valueFlowRendering\?\.scenarioTrace/u);
  assert.match(renderer, /valueFlowRendering\?\.toolbar/u);
  assert.match(inspector, /functionLogicInspectorSessionKey/u);
  assert.match(inspector, /drawer\.inert = !functionLogicInspectorOpen/u);
  assert.match(inspector, /event\.key !== "Escape"/u);
  assert.match(inspector, /aria-expanded/u);
  assert.match(inspector, /functionLogicInspectorOpen = true/u);
  assert.match(
    inspector,
    /scroll\.replaceChildren\(\.\.\.available, \.\.\.scroll\.children\)/u
  );
  assert.match(inspectorStyles, /display: grid/u);
  assert.match(inspectorStyles, /grid-template-columns: minmax\(0, 1fr\) 0/u);
  assert.match(inspectorStyles, /--logic-workspace-height: clamp\(340px, 70vh, 780px\)/u);
  assert.match(inspectorStyles, /height: var\(--logic-workspace-height\)/u);
  assert.match(inspectorStyles, /overflow-y: auto/u);
  assert.match(inspectorStyles, /grid-auto-rows: max-content/u);
  assert.match(inspectorStyles, /scrollbar-gutter: stable/u);
  assert.match(inspectorStyles, /clamp\(280px, 32vw, 390px\)/u);
  assert.match(inspectorStyles, /\.logic-graph-workspace\.inspector-open/u);
  assert.doesNotMatch(inspectorStyles, /position: absolute|logic-inspector-backdrop/u);
  assert.doesNotMatch(inspector, /backdrop/u);
  assert.match(visualizerStyles, /\.visualizer-shell \{[\s\S]*?width: 100%/u);
  assert.match(visualizerStyles, /grid-template-columns: minmax\(0, 1fr\) auto/u);
  assert.match(visualizerStyles, /\.status\[hidden\] \{ display: none; \}/u);
  assert.match(visualizerStyles, /\.function-origins \{[\s\S]*?display: flex/u);
  assert.match(
    visualizerStyles,
    /\.function-origins\[hidden\] \{ display: none; \}/u
  );
  assert.match(visualizerStyles, /clamp\(300px, 31vw, 430px\)/u);
  assert.match(visualizerStyles, /--logic-workspace-height: clamp\(460px, 76vh, 1080px\)/u);
  assert.doesNotMatch(
    [inspector, inspectorStyles].join("\n"),
    /from ".*(?:analyzer|application|protocol|vscode|extension)/u
  );
});

test("Function Logic viewport owns free pan, focal zoom, Center, and Fit", () => {
  const geometry = readSource(
    "src/webview/codeFlow/viewport/functionLogicViewportGeometry.ts"
  );
  const browser = readSource(
    "src/webview/codeFlow/viewport/functionLogicViewportBrowserSource.ts"
  );
  const styles = readSource(
    "src/webview/codeFlow/viewport/functionLogicViewportStyles.ts"
  );
  const renderer = readSource("src/webview/codeFlow/functionLogicBrowserSource.ts");
  const visualizer = readSource(
    "src/webview/functionVisualizer/functionVisualizerBrowserSource.ts"
  );

  assert.match(geometry, /FUNCTION_LOGIC_MAX_PAN = 10_000_000/u);
  assert.match(geometry, /createFunctionLogicFocalZoom/u);
  assert.match(geometry, /createFitFunctionLogicViewportTransform/u);
  assert.match(geometry, /resizeFunctionLogicViewportTransform/u);
  assert.match(browser, /addEventListener\("pointerdown", handlePointerDown\)/u);
  assert.match(browser, /addEventListener\("wheel", handleWheel, \{ passive: false \}\)/u);
  assert.match(browser, /translate3d\(/u);
  assert.match(browser, /"Center", "Center function graph \(C\)"/u);
  assert.match(browser, /"Fit", "Fit complete function graph \(F\)"/u);
  assert.match(browser, /aria-keyshortcuts/u);
  assert.match(styles, /overflow: hidden/u);
  assert.match(styles, /touch-action: none/u);
  assert.match(styles, /cursor: grab/u);
  assert.match(renderer, /createFunctionLogicViewportController/u);
  assert.match(renderer, /graphRendering\.activateViewport\(\)/u);
  assert.match(visualizer, /viewportController\.getTransform\(\)/u);
  assert.match(visualizer, /viewportController\.setTransform/u);
  assert.doesNotMatch(
    [geometry, browser, styles].join("\n"),
    /from ".*(?:analyzer|application|protocol|vscode|extension)/u
  );
});

test("Function Logic typography follows VS Code UI and editor settings", () => {
  const typography = readSource(
    "src/webview/codeFlow/typography/functionLogicTypographyStyles.ts"
  );
  const styles = [
    "src/webview/codeFlow/functionLogicGraphStyles.ts",
    "src/webview/codeFlow/dataFlow/functionLogicDataFlowStyles.ts",
    "src/webview/codeFlow/branchChoices/functionLogicBranchChoiceStyles.ts",
    "src/webview/codeFlow/functionLogicCompoundGroupStyles.ts",
    "src/webview/codeFlow/inspector/functionLogicInspectorStyles.ts",
    "src/webview/codeFlow/valuePreview/functionLogicValuePreviewStyles.ts",
    "src/webview/codeFlow/valuePreview/functionLogicScenarioTraceStyles.ts",
    "src/webview/codeFlow/viewport/functionLogicViewportStyles.ts",
    "src/webview/functionVisualizer/functionVisualizerStyles.ts"
  ].map(readSource).join("\n");

  assert.match(typography, /--vscode-font-size/u);
  assert.match(typography, /--vscode-editor-font-size/u);
  assert.match(typography, /--vscode-font-family/u);
  assert.match(typography, /--vscode-editor-font-family/u);
  assert.doesNotMatch(styles, /font-size:\s*\d+px/u);
});

test("code-snippet presentation is shared, inert, and Webview-only", () => {
  const tokenizer = readSource(
    "src/webview/codePresentation/codeSnippetTokenizer.ts"
  );
  const styles = readSource(
    "src/webview/codePresentation/codeSnippetStyles.ts"
  );
  const logicRenderer = readSource(
    "src/webview/codeFlow/functionLogicBrowserSource.ts"
  );
  const moduleBrowser = readSource(
    "src/webview/moduleVisualizer/moduleVisualizerBrowserSource.ts"
  );
  const moduleRenderer = readSource(
    "src/webview/moduleVisualizer/moduleVisualizerGraphRendererSource.ts"
  );

  assert.match(tokenizer, /while \(cursor < value\.length\)/u);
  assert.match(tokenizer, /span\.textContent = token\.text/u);
  assert.match(tokenizer, /element\.replaceChildren\(content\)/u);
  assert.doesNotMatch(tokenizer, /innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(/u);
  assert.match(styles, /white-space: pre-wrap/u);
  assert.match(logicRenderer, /getCodeSnippetBrowserSource/u);
  assert.match(logicRenderer, /mountCodeSnippet\(label, block\.label\)/u);
  assert.match(moduleBrowser, /getCodeSnippetBrowserSource/u);
  assert.match(moduleRenderer, /mountCodeSnippet\(title, node\.label\)/u);
  assert.doesNotMatch(
    tokenizer,
    /from ".*(?:analyzer|application|protocol|vscode|extension)/u
  );
});

test("Scenario values stay bounded, calculated, traceable, session-scoped, and browser-only", () => {
  const renderer = readSource("src/webview/codeFlow/functionLogicBrowserSource.ts");
  const dataFlow = readSource(
    "src/webview/codeFlow/dataFlow/functionLogicDataFlowBrowserSource.ts"
  );
  const preview = readSource(
    "src/webview/codeFlow/valuePreview/functionLogicValuePreviewBrowserSource.ts"
  );
  const previewStyles = readSource(
    "src/webview/codeFlow/valuePreview/functionLogicValuePreviewStyles.ts"
  );
  const trace = readSource(
    "src/webview/codeFlow/valuePreview/functionLogicScenarioTraceBrowserSource.ts"
  );
  const evaluator = readSource(
    "src/webview/codeFlow/valuePreview/functionLogicScenarioEvaluatorBrowserSource.ts"
  );
  const expression = readSource(
    "src/webview/codeFlow/valuePreview/functionLogicScenarioExpressionBrowserSource.ts"
  );

  assert.match(renderer, /getFunctionLogicValuePreviewBrowserSource/u);
  assert.match(renderer, /getFunctionLogicScenarioEvaluatorBrowserSource/u);
  assert.match(renderer, /getFunctionLogicScenarioTraceBrowserSource/u);
  assert.match(dataFlow, /createFunctionLogicValuePreviewEditor/u);
  assert.match(dataFlow, /createFunctionLogicValuePreviewLabel/u);
  assert.match(dataFlow, /readFunctionLogicScenarioEditableBindings/u);
  assert.match(preview, /MAX_LOGIC_VALUE_PREVIEW_LENGTH = 240/u);
  assert.match(preview, /MAX_LOGIC_VALUE_PREVIEW_ROWS = 120/u);
  assert.match(preview, /MAX_LOGIC_MANUAL_SCENARIO_ROWS = 32/u);
  assert.match(preview, /MAX_LOGIC_MANUAL_SCENARIO_NAME_LENGTH = 80/u);
  assert.match(preview, /FUNCTION_LOGIC_MANUAL_SCENARIO_PREFIX = "scenario-manual:"/u);
  assert.match(preview, /functionLogicValuePreviewSessionKey/u);
  assert.match(preview, /functionLogicManualScenarioValueByName/u);
  assert.match(preview, /readFunctionLogicScenarioEditableBindings/u);
  assert.match(preview, /readFunctionLogicValuePreview/u);
  assert.match(preview, /addEventListener\("input"/u);
  assert.match(preview, /onBindingSelect\(binding\.id\)/u);
  assert.match(preview, /aria-pressed/u);
  assert.match(
    previewStyles,
    /\.logic-value-preview-rows \{[\s\S]*max-height: clamp\(160px, 26vh, 260px\)[\s\S]*overflow-y: auto/u
  );
  assert.match(dataFlow, /selectBinding\(bindingId, false\)/u);
  assert.match(dataFlow, /valuePreviewRendering\.setSelectedBinding/u);
  assert.match(dataFlow, /scenarioTraceRendering\.setSelectedBinding/u);
  assert.match(preview, /label\.textContent = value/u);
  assert.match(trace, /MAX_LOGIC_SCENARIO_TRACE_STEPS = 80/u);
  assert.match(trace, /formatFunctionLogicScenarioRole/u);
  assert.match(trace, /calculateFunctionLogicScenario/u);
  assert.match(trace, /formatFunctionLogicScenarioCalculationRole/u);
  assert.match(trace, /rows\.replaceChildren\(\)/u);
  assert.match(evaluator, /MAX_LOGIC_SCENARIO_WORK_ITEMS = 1200/u);
  assert.match(evaluator, /JSON\.parse/u);
  assert.match(evaluator, /getFunctionLogicScenarioExpressionBrowserSource/u);
  assert.match(evaluator, /binding\.kind === "parameter" \|\| binding\.manual/u);
  assert.match(expression, /createFunctionLogicScenarioRpn/u);
  assert.match(expression, /applyFunctionLogicScenarioTernary/u);
  assert.match(evaluator, /mergeFunctionLogicScenarioEnvironments/u);
  assert.match(evaluator, /choice-dimmed/u);
  assert.doesNotMatch(
    [preview, evaluator, expression, trace].join("\n"),
    /vscode\.postMessage|\beval\(|new Function/u
  );
  assert.doesNotMatch(
    [preview, evaluator, expression, trace].join("\n"),
    /from ".*(?:analyzer|application|protocol|vscode|extension)/u
  );
});

test("Scenario Variables and its Inspector are invariant even without analyzer bindings", () => {
  const renderer = readSource("src/webview/codeFlow/functionLogicBrowserSource.ts");
  const inspector = readSource(
    "src/webview/codeFlow/inspector/functionLogicInspectorBrowserSource.ts"
  );
  const dataFlow = readSource(
    "src/webview/codeFlow/dataFlow/functionLogicDataFlowBrowserSource.ts"
  );

  assert.match(renderer, /createFunctionLogicInspector\(choiceSessionKey\)/u);
  assert.match(inspector, /functionLogicInspectorOpen = true/u);
  assert.match(dataFlow, /valuePreviewEditor: valuePreviewRendering\.element/u);
  assert.match(dataFlow, /scenarioTrace: scenarioTraceRendering\.element/u);
  assert.doesNotMatch(
    dataFlow,
    /if \(bindings\.length === 0\) return undefined/u
  );
});

test("JSX component values stay parser-owned, bounded, and visible through value flow", () => {
  const jsxValueFlow = readSource(
    "src/analyzer/functionLogic/jsx/typescriptJsxValueFlow.ts"
  );
  const analyzer = readSource(
    "src/analyzer/functionLogic/typescriptFunctionLogicAnalyzer.ts"
  );
  const collector = readSource(
    "src/analyzer/functionLogic/dataFlow/typescriptFunctionDataFlow.ts"
  );
  const protocol = readSource("src/protocol/functionLogic.ts");
  const projector = readSource(
    "src/application/codeFlow/codeFlowFunctionLogicProjection.ts"
  );
  const browser = readSource(
    "src/webview/codeFlow/dataFlow/functionLogicDataFlowBrowserSource.ts"
  );

  assert.match(jsxValueFlow, /planTypeScriptJsxStatementValueFlow/u);
  assert.match(jsxValueFlow, /expandTypeScriptJsxValueFlows/u);
  assert.match(jsxValueFlow, /"JSX component collection"/u);
  assert.match(jsxValueFlow, /for \(const anchor of input\.blocks\)/u);
  assert.match(analyzer, /jsxValueRequests/u);
  assert.match(collector, /propagateComponentValueRoles/u);
  assert.match(collector, /remainingPasses = candidates\.length/u);
  assert.match(protocol, /FunctionLogicValuePayloadRole = "component"/u);
  assert.match(projector, /access\.valueRole/u);
  assert.match(projector, /binding\.valueRole/u);
  assert.match(browser, /valueRole === "component"/u);
  assert.doesNotMatch(
    jsxValueFlow,
    /from ".*(?:application|protocol|webview|vscode|extension)/u
  );
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
  assert.match(compoundScene, /eventHandler \? "event" : "call"/u);
  assert.match(compoundScene, /eventHandler \|\| !continuationId/u);
  assert.match(compoundScene, /compound-resume:/u);
  assert.match(compoundScene, /relation: "callReturn"/u);
  assert.match(compoundScene, /valueBindings/u);
  assert.match(compoundScene, /valueFlows/u);
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
