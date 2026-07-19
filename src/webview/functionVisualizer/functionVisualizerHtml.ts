/** HTML factory for the dedicated Function Visualizer editor tab. */

import * as vscode from "vscode";
import { getFunctionVisualizerBrowserSource } from "./functionVisualizerBrowserSource";
import { getFunctionVisualizerStyles } from "./functionVisualizerStyles";

/** Inputs required to build one nonce-protected panel document. */
export type FunctionVisualizerHtmlOptions = {
  webview: vscode.Webview;
  nonce: string;
};

/** Builds a graph-first function reading surface with drill navigation chrome. */
export function getFunctionVisualizerHtml(
  options: FunctionVisualizerHtmlOptions
): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${options.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
  <title>Function Visualizer</title>
  <style>${getFunctionVisualizerStyles()}</style>
</head>
<body>
  <main class="visualizer-shell">
    <nav class="visualizer-topbar" aria-label="Function navigation">
      <button id="function-back" class="back-button" type="button" disabled>← Parent function</button>
      <div id="function-breadcrumbs" class="breadcrumbs"></div>
    </nav>

    <header class="visualizer-header">
      <div class="visualizer-eyebrow">FUNCTION VISUALIZER · STATIC POSSIBLE PATHS</div>
      <h1 id="function-title">Function Visualizer</h1>
      <div id="function-subtitle" class="visualizer-subtitle">Waiting for a function</div>
      <div id="function-summary" class="visualizer-summary"></div>
      <div id="function-semantics" class="semantics-note">
        Possible static paths, not observed runtime execution.
      </div>
    </header>

    <div id="status" class="status" role="status" aria-live="polite">Connecting to the analyzer…</div>
    <section id="function-origins-section" class="function-origins" aria-labelledby="function-origins-title" hidden>
      <h2 id="function-origins-title">Known entrypoints reaching this function</h2>
      <div id="function-origins"></div>
    </section>
    <section id="flow-steps" class="flow-steps" aria-label="Function control-flow graph"></section>

    <section id="flow-gaps-section" class="flow-gaps" aria-labelledby="flow-gaps-title" hidden>
      <h2 id="flow-gaps-title">What remains unknown</h2>
      <div id="flow-gaps"></div>
    </section>
  </main>
  <script nonce="${options.nonce}">${getFunctionVisualizerBrowserSource()}</script>
</body>
</html>`;
}
