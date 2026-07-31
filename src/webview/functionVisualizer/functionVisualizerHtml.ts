/** HTML factory for the dedicated Function Visualizer editor tab. */

import * as vscode from "vscode";
import { getFunctionVisualizerBrowserSource } from "./functionVisualizerBrowserSource";
import { getFunctionVisualizerStyles } from "./functionVisualizerStyles";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";

/** Inputs required to build one nonce-protected panel document. */
export type FunctionVisualizerHtmlOptions = {
  webview: vscode.Webview;
  nonce: string;
  language?: "ko" | "en";
};

/** Builds a graph-first function reading surface with drill navigation chrome. */
export function getFunctionVisualizerHtml(
  options: FunctionVisualizerHtmlOptions
): string {
  return /* html */ `<!DOCTYPE html>
<html lang="${options.language ?? "en"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${options.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
  <title>Function Visualizer</title>
  <style>${getFunctionVisualizerStyles()}</style>
</head>
<body data-i18n-document-title="function-title">
  <main class="visualizer-shell">
    <nav id="function-navigation" class="visualizer-topbar" aria-label="Function navigation" data-i18n-aria-label="function-navigation" hidden>
      <button id="function-back" class="back-button" type="button" data-i18n="parent-function" disabled>← Parent function</button>
      <div id="function-breadcrumbs" class="breadcrumbs"></div>
    </nav>

    <header class="visualizer-header">
      <div class="visualizer-eyebrow" data-i18n="function-eyebrow">FUNCTION VISUALIZER · STATIC POSSIBLE PATHS</div>
      <h1 id="function-title" data-i18n="function-title">Function Visualizer</h1>
      <div id="function-subtitle" class="visualizer-subtitle" data-i18n="waiting-function">Waiting for a function</div>
      <div id="function-summary" class="visualizer-summary"></div>
      <div id="function-semantics" class="semantics-note" data-i18n="function-semantics">
        Possible static paths, not observed runtime execution.
      </div>
    </header>

    <div id="status" class="status" role="status" aria-live="polite" data-i18n="connecting">Connecting to the analyzer…</div>
    <section id="function-origins-section" class="function-origins" aria-labelledby="function-origins-title" hidden>
      <h2 id="function-origins-title" data-i18n="reached-from-title">Reached from</h2>
      <div id="function-origins"></div>
    </section>
    <section id="flow-steps" class="flow-steps" aria-label="Function control-flow graph" data-i18n-aria-label="function-control-aria"></section>

    <section id="flow-gaps-section" class="flow-gaps" aria-labelledby="flow-gaps-title" hidden>
      <h2 id="flow-gaps-title" data-i18n="unknown-title">What remains unknown</h2>
      <div id="flow-gaps"></div>
    </section>
  </main>
  <script nonce="${options.nonce}">${getBrowserLocalizationSource()}\napplyProjectAnalyzerLanguage("${options.language ?? "en"}");\n${getFunctionVisualizerBrowserSource()}</script>
</body>
</html>`;
}
