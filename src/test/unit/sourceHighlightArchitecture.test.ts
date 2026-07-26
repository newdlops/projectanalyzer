/**
 * Architecture guards for source-backed graph selection highlighting. These
 * checks avoid loading VS Code while protecting the browser-to-editor contract.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

/** Reads a source file from the repository root. */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

test("one disposable VS Code adapter owns graph source decorations", () => {
  const sourceHighlighter = readSource("src/vscode/sourceHighlightService.ts");
  const services = readSource("src/extension/extensionServices.ts");

  assert.match(sourceHighlighter, /class SourceHighlightService/u);
  assert.match(sourceHighlighter, /createTextEditorDecorationType/u);
  assert.match(sourceHighlighter, /editor\.wordHighlightStrongBackground/u);
  assert.match(sourceHighlighter, /this\.highlightedEditor\?\.setDecorations\(this\.decorationType, \[\]\)/u);
  assert.match(sourceHighlighter, /editor\.setDecorations\(this\.decorationType, \[highlightRange\]\)/u);
  assert.match(sourceHighlighter, /vscode\.window\.tabGroups\.all/u);
  assert.match(sourceHighlighter, /tab\.input instanceof vscode\.TabInputText/u);
  assert.match(sourceHighlighter, /viewColumn: existingTabColumn/u);
  assert.match(services, /const sourceHighlighter = new SourceHighlightService\(\)/u);
  assert.match(services, /context\.subscriptions\.push\(sourceHighlighter\)/u);
});

test("source-backed graph clicks request a decorated editor reveal", () => {
  const explorerGraph = readSource("src/webview/explorerClientScript.ts");
  const moduleGraph = readSource("src/webview/moduleVisualizer/moduleVisualizerBrowserSource.ts");
  const functionGraph = readSource("src/webview/codeFlow/functionLogicBrowserSource.ts");

  assert.match(
    explorerGraph,
    /if \(hitNode\) \{[\s\S]*selectAndToggleNode\(hitNode\.id\);[\s\S]*type: "node\/openSource"/u
  );
  assert.match(
    moduleGraph,
    /if \(node\.kind === "function"\) \{[\s\S]*if \(node\.sourceToken\) \{[\s\S]*requestOpenSource\(/u
  );
  assert.match(
    functionGraph,
    /if \(block\.evidenceToken\) \{[\s\S]*openLogicEvidence\(block\.evidenceToken\)/u
  );
});

test("every Host source-navigation route uses the shared highlighter", () => {
  const explorerPanel = readSource("src/webview/explorerGraphPanelProvider.ts");
  const sidebar = readSource("src/webview/explorerViewProvider.ts");
  const functionVisualizer = readSource(
    "src/webview/functionVisualizer/functionVisualizerPanelProvider.ts"
  );
  const moduleVisualizer = readSource(
    "src/webview/moduleVisualizer/moduleVisualizerPanelProvider.ts"
  );

  assert.match(explorerPanel, /sourceHighlighter\.revealNode\(node\)/u);
  assert.match(sidebar, /sourceHighlighter\.revealNode\(node\)/u);
  assert.match(sidebar, /sourceHighlighter\.revealRange\(filePath, range\)/u);
  assert.match(functionVisualizer, /sourceHighlighter\.revealRange\(filePath, range\)/u);
  assert.match(moduleVisualizer, /sourceHighlighter\.revealRange\(location\.filePath, location\.range\)/u);
  assert.match(moduleVisualizer, /sourceHighlighter\.revealNode\(node\)/u);
});
