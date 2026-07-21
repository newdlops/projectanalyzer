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
      <div class="zoom-controls" role="group" aria-label="Graph zoom controls">
        <button id="zoom-out" class="zoom-button" type="button" aria-label="Zoom out" aria-controls="module-viewport" title="Zoom out (-)">−</button>
        <button id="zoom-level" class="zoom-level" type="button" aria-label="Reset zoom to 100 percent" aria-controls="module-viewport" title="Reset zoom (0)">100%</button>
        <button id="zoom-in" class="zoom-button" type="button" aria-label="Zoom in" aria-controls="module-viewport" title="Zoom in (+)">+</button>
      </div>
      <button id="fit-graph" class="toolbar-button" type="button" aria-controls="module-viewport" title="Fit complete graph (F)">Fit</button>
    </nav>

    <section class="module-flow-workspace">
      <p id="module-viewport-help" class="visually-hidden">Use plus, minus, zero, or F while this graph is focused. Hold Control or Command while scrolling to zoom. Drag empty canvas space to pan. Click empty canvas space or press Escape to clear module focus and restore the initial scene.</p>
      <div id="module-viewport" class="module-flow-viewport" role="region" tabindex="0" aria-label="Project module flow graph" aria-describedby="module-viewport-help">
        <div id="module-status" class="module-flow-status" role="status" aria-live="polite">Connecting to the analyzer</div>
        <div id="module-stage" class="module-flow-stage">
          <div id="module-scene" class="module-flow-scene">
            <div id="module-cycles" class="module-flow-cycles"></div>
            <svg id="module-edges" class="module-flow-edges" aria-label="Module relationships"></svg>
            <div id="module-nodes" class="module-flow-nodes"></div>
          </div>
        </div>
      </div>
      <aside id="module-detail" class="module-flow-detail" aria-label="Selected module or relationship details">
        <div class="detail-empty">Select a module or relationship to inspect source-backed details.</div>
      </aside>
    </section>
    <div id="zoom-announcement" class="visually-hidden" aria-live="polite"></div>
  </main>
  <script nonce="${options.nonce}">${getModuleVisualizerBrowserSource()}</script>
</body>
</html>`;
}
