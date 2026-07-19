/** HTML factory for the dedicated project Module Flow editor tab. */

import * as vscode from "vscode";
import { getModuleVisualizerBrowserSource } from "./moduleVisualizerBrowserSource";
import { getModuleVisualizerStyles } from "./moduleVisualizerStyles";

/** Inputs required to build one nonce-protected panel document. */
export type ModuleVisualizerHtmlOptions = {
  webview: vscode.Webview;
  nonce: string;
};

/** Builds the graph-first module reading surface and bounded detail rail. */
export function getModuleVisualizerHtml(
  options: ModuleVisualizerHtmlOptions
): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${options.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
  <title>Module Flow</title>
  <style>${getModuleVisualizerStyles()}</style>
</head>
<body>
  <main class="module-flow-shell">
    <header class="module-flow-header">
      <div class="module-flow-eyebrow">MODULE FLOW · STATIC RESPONSIBILITY RELATIONSHIPS</div>
      <div class="module-flow-heading-row">
        <h1>How this project moves</h1>
        <div id="module-summary" class="module-flow-summary">Waiting for workspace analysis</div>
      </div>
      <div class="module-flow-semantics">Possible static relationships, not observed runtime execution. Click a module to attach its boundary functions to this canvas.</div>
    </header>

    <nav class="module-flow-toolbar" aria-label="Module Flow controls">
      <button class="mode-button active" data-mode="execution" type="button">Execution</button>
      <button class="mode-button" data-mode="dependency" type="button">Dependency</button>
      <button class="mode-button" data-mode="boundary" type="button">All boundaries</button>
      <span class="toolbar-spacer"></span>
      <label class="toolbar-check"><input id="include-external" type="checkbox" checked> External</label>
      <label class="toolbar-check"><input id="include-inferred" type="checkbox" checked> Inferred</label>
      <button id="fit-graph" class="toolbar-button" type="button">Fit</button>
      <button id="reset-graph" class="toolbar-button" type="button">100%</button>
    </nav>

    <section class="module-flow-workspace">
      <div id="module-viewport" class="module-flow-viewport" aria-label="Project module flow graph">
        <div id="module-status" class="module-flow-status" role="status" aria-live="polite">Connecting to the analyzer</div>
        <div id="module-stage" class="module-flow-stage">
          <div id="module-cycles" class="module-flow-cycles"></div>
          <svg id="module-edges" class="module-flow-edges" aria-label="Module relationships"></svg>
          <div id="module-nodes" class="module-flow-nodes"></div>
        </div>
      </div>
      <aside id="module-detail" class="module-flow-detail" aria-label="Selected module or relationship details">
        <div class="detail-empty">Select a module or relationship to inspect source-backed details.</div>
      </aside>
    </section>
  </main>
  <script nonce="${options.nonce}">${getModuleVisualizerBrowserSource()}</script>
</body>
</html>`;
}
