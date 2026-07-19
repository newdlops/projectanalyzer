/**
 * Webview HTML factory. The Activity Bar owns the flow-first reading surface;
 * the retained editor panel remains an internal graph-renderer compatibility
 * boundary until the horizontal CodeFlow canvas replaces it.
 */

import * as vscode from "vscode";
import { getExplorerClientScript } from "./explorerClientScript";
import { getExplorerSidebarScript } from "./explorerSidebarScript";
import { getExplorerStyles, type ExplorerSurface } from "./explorerStyles";

/** Data required to construct explorer Webview HTML. */
export type WebviewHtmlOptions = {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  nonce: string;
  defaultDepth: number;
  maxRenderedNodes: number;
  initialMode: "call" | "file" | "class";
  surface: ExplorerSurface;
};

/** Builds the requested Project Analyzer Webview document. */
export function getExplorerHtml(options: WebviewHtmlOptions): string {
  return options.surface === "panel"
    ? getGraphPanelHtml(options)
    : getCodeFlowSidebarHtml(options);
}

/** Builds the Activity Bar Code Flow Reader surface. */
function getCodeFlowSidebarHtml(options: WebviewHtmlOptions): string {
  const cspSource = options.webview.cspSource;
  const clientScript = getExplorerSidebarScript();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
  <title>Project Analyzer Code Flow</title>
  <style>${getExplorerStyles("sidebar")}</style>
</head>
<body>
  <main class="shell code-flow-shell">
    <header class="product-intro">
      <div class="product-eyebrow">CODE FLOW READER</div>
      <h1>Understand this codebase</h1>
      <p>Start at a boundary. Follow responsibility changes. Find effects. Verify every jump in source.</p>
    </header>

    <div class="toolbar analysis-toolbar">
      <button id="analyze-workspace" class="primary-button" type="button">Analyze Workspace</button>
    </div>
    <div id="status" class="status" role="status" aria-live="polite">Ready</div>

    <section class="reading-frame" aria-labelledby="reading-frame-title">
      <div id="reading-frame-title" class="section-kicker">READ CODE WITH FIVE QUESTIONS</div>
      <ol>
        <li><span>1</span><strong>Boundary</strong><small>What starts it?</small></li>
        <li><span>2</span><strong>Responsibility</strong><small>Who owns the next step?</small></li>
        <li><span>3</span><strong>Decision</strong><small>Where can behavior change?</small></li>
        <li><span>4</span><strong>Effect</strong><small>What state or system is touched?</small></li>
        <li><span>5</span><strong>Verify</strong><small>Which source proves the jump?</small></li>
      </ol>
    </section>

    <section id="flow-start" class="flow-start" aria-labelledby="flow-start-title">
      <div class="section-heading-row">
        <div>
          <div class="section-kicker">START</div>
          <h2 id="flow-start-title">Choose one question</h2>
        </div>
        <span id="catalog-summary" class="summary-chip"></span>
      </div>

      <div class="start-mode-switch" role="tablist" aria-label="Flow starting point">
        <button id="mode-entrypoints" class="start-mode active" type="button" role="tab" aria-selected="true">Entrypoints</button>
        <button id="mode-functions" class="start-mode" type="button" role="tab" aria-selected="false">Functions</button>
      </div>

      <form id="flow-search-form" class="flow-search" role="search">
        <input
          id="flow-search-input"
          type="search"
          maxlength="512"
          autocomplete="off"
          placeholder="Route, operation, or framework"
          aria-label="Search entrypoints"
        >
        <button id="flow-search-submit" class="search-submit" type="submit" aria-label="Search">Find</button>
      </form>
      <div id="flow-search-meta" class="flow-search-meta" aria-live="polite"></div>
      <div id="flow-results" class="flow-results" role="listbox" aria-label="Flow starting points"></div>
      <button id="flow-search-more" class="text-button" type="button" hidden>Load more functions</button>
    </section>

    <section id="flow-reader" class="flow-reader" aria-labelledby="flow-title" hidden>
      <button id="flow-back" class="back-button" type="button">← Choose another start</button>
      <div class="flow-reader-header">
        <div id="flow-reader-kicker" class="section-kicker">STATIC FLOW · POSSIBLE CALL PATH</div>
        <h2 id="flow-title"></h2>
        <div id="flow-subtitle" class="flow-subtitle"></div>
        <div id="flow-summary" class="flow-summary"></div>
      </div>
      <div id="flow-semantics-note" class="semantics-note">
        Arrows mean statically discoverable call relationships, not observed runtime order.
      </div>

      <section id="flow-origins-section" class="flow-origins" aria-labelledby="flow-origins-title" hidden>
        <h3 id="flow-origins-title">Known entrypoints</h3>
        <div id="flow-origins"></div>
      </section>

      <div id="flow-steps" class="flow-steps" role="tree" aria-label="Code flow steps"></div>

      <section id="flow-gaps-section" class="flow-gaps" aria-labelledby="flow-gaps-title" hidden>
        <h3 id="flow-gaps-title">What remains unknown</h3>
        <div id="flow-gaps"></div>
      </section>
    </section>

    <details class="utility-actions">
      <summary>Analysis and data</summary>
      <div class="button-grid utility-action-grid">
        <button id="analyze-current" class="secondary-button" type="button">Analyze Current File</button>
        <button id="show-workspace" class="secondary-button" type="button">Restore Workspace</button>
        <button id="export-json" class="secondary-button" type="button">Export Evidence JSON</button>
        <button id="clear-cache" class="secondary-button" type="button">Clear Analysis Cache</button>
      </div>
    </details>
  </main>
  <script nonce="${options.nonce}">${clientScript}</script>
</body>
</html>`;
}
/** Builds the retained editor-tab graph renderer compatibility surface. */
function getGraphPanelHtml(options: WebviewHtmlOptions): string {
  const cspSource = options.webview.cspSource;
  const canvasWidth = 960;
  const canvasHeight = 560;
  const clientScript = getExplorerClientScript({
    canvasHeight,
    canvasWidth,
    defaultDepth: options.defaultDepth,
    initialMode: options.initialMode,
    maxNodes: Math.max(1, Math.floor(options.maxRenderedNodes))
  });

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
  <title>Project Analyzer Graph</title>
  <style>${getExplorerStyles("panel")}</style>
</head>
<body>
  <div class="shell panel-shell">
    <div class="panel-header">
      <div class="mode-switch" role="tablist">
        <button class="mode-button active" type="button" data-mode="file">Files</button>
        <button class="mode-button" type="button" data-mode="call">Calls</button>
        <button class="mode-button" type="button" data-mode="class">Classes</button>
      </div>
      <div class="graph-toolbar" aria-label="Graph controls">
        <button id="zoom-out" class="icon-button" type="button" title="Zoom out">-</button>
        <button id="zoom-reset" class="icon-button wide" type="button" title="Reset zoom">100%</button>
        <button id="zoom-in" class="icon-button" type="button" title="Zoom in">+</button>
        <button id="fit-view" class="icon-button wide" type="button" title="Fit graph to view">Fit</button>
        <button id="center-view" class="icon-button wide" type="button" title="Move graph to center">Center</button>
      </div>
    </div>
    <div id="status" class="status">Ready</div>
    <div class="graph-panel" aria-label="Graph canvas">
      <canvas id="graph-canvas" class="graph-canvas" width="${canvasWidth}" height="${canvasHeight}" role="application" tabindex="0" aria-label="Project graph canvas"></canvas>
    </div>
  </div>
  <script nonce="${options.nonce}">${clientScript}</script>
</body>
</html>`;
}
