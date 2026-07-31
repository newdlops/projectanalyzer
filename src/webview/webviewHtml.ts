/**
 * Webview HTML factory. The Activity Bar owns the flow-first reading surface;
 * the retained editor panel remains an internal graph-renderer compatibility
 * boundary until the horizontal CodeFlow canvas replaces it.
 */

import * as vscode from "vscode";
import { getExplorerClientScript } from "./explorerClientScript";
import { getExplorerSidebarScript } from "./explorerSidebarScript";
import { getExplorerStyles, type ExplorerSurface } from "./explorerStyles";
import { getBrowserLocalizationSource } from "../localization/browserCatalog";

/** Data required to construct explorer Webview HTML. */
export type WebviewHtmlOptions = {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  nonce: string;
  defaultDepth: number;
  maxRenderedNodes: number;
  initialMode: "call" | "file" | "class";
  surface: ExplorerSurface;
  language?: "ko" | "en";
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
<html lang="${options.language ?? "en"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
  <title>Project Analyzer Code Flow</title>
  <style>${getExplorerStyles("sidebar")}</style>
</head>
<body data-i18n-document-title="code-flow-title">
  <main class="shell code-flow-shell">
    <header class="product-intro">
      <div class="product-eyebrow" data-i18n="code-flow-eyebrow">CODE FLOW READER</div>
      <h1 data-i18n="code-flow-heading">Understand this codebase</h1>
      <p data-i18n="code-flow-intro">Start at a boundary. Follow responsibility changes. Find effects. Verify every jump in source.</p>
    </header>

    <div class="toolbar analysis-toolbar">
      <button id="analyze-workspace" class="primary-button" type="button" data-i18n="analyze-workspace">Analyze Workspace</button>
    </div>
    <div id="status" class="status" role="status" aria-live="polite" data-i18n="ready">Ready</div>

    <section class="module-flow-launcher" aria-labelledby="module-flow-launcher-title">
      <div class="section-kicker" data-i18n="project-map">PROJECT MAP</div>
      <h2 id="module-flow-launcher-title" data-i18n="module-launcher-title">See how modules connect</h2>
      <p id="module-flow-description" data-i18n="module-launcher-description">
        Open a bounded graph of execution, dependencies, and responsibility boundaries.
      </p>
      <button
        id="open-module-flow"
        class="module-flow-cta"
        type="button"
        title="Open Project Module Flow in a new editor tab" data-i18n-title="open-module-flow-title"
        aria-describedby="module-flow-description module-flow-action-hint"
      >
        <svg class="module-flow-cta-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M7 8h6m-6 16h6m6-8h6M13 8l6 8m-6 8 6-8"/>
          <circle cx="5" cy="8" r="3"/>
          <circle cx="5" cy="24" r="3"/>
          <circle cx="27" cy="16" r="3"/>
        </svg>
        <span class="module-flow-cta-copy">
          <strong id="module-flow-action-label" data-i18n="open-module-flow">Open Module Flow</strong>
          <small id="module-flow-action-hint" data-i18n="module-flow-opens">Opens beside your code</small>
        </span>
        <span class="module-flow-cta-arrow" aria-hidden="true">→</span>
      </button>
    </section>

    <section class="reading-frame" aria-labelledby="reading-frame-title">
      <div id="reading-frame-title" class="section-kicker" data-i18n="reading-questions">READ CODE WITH FIVE QUESTIONS</div>
      <ol>
        <li><span>1</span><strong data-i18n="reading-boundary">Boundary</strong><small data-i18n="reading-boundary-detail">What starts it?</small></li>
        <li><span>2</span><strong data-i18n="reading-responsibility">Responsibility</strong><small data-i18n="reading-responsibility-detail">Who owns the next step?</small></li>
        <li><span>3</span><strong data-i18n="reading-decision">Decision</strong><small data-i18n="reading-decision-detail">Where can behavior change?</small></li>
        <li><span>4</span><strong data-i18n="reading-effect">Effect</strong><small data-i18n="reading-effect-detail">What state or system is touched?</small></li>
        <li><span>5</span><strong data-i18n="reading-verify">Verify</strong><small data-i18n="reading-verify-detail">Which source proves the jump?</small></li>
      </ol>
    </section>

    <section id="flow-start" class="flow-start" aria-labelledby="flow-start-title">
      <div class="section-heading-row">
        <div>
          <div class="section-kicker" data-i18n="start">START</div>
          <h2 id="flow-start-title" data-i18n="choose-question">Choose one question</h2>
        </div>
        <span id="catalog-summary" class="summary-chip"></span>
      </div>

      <div class="start-mode-switch" role="group" aria-label="Flow starting point" data-i18n-aria-label="flow-starting-point">
        <button id="mode-entrypoints" class="start-mode active" type="button" aria-pressed="true" data-i18n="entrypoints">Entrypoints</button>
        <button id="mode-functions" class="start-mode" type="button" aria-pressed="false" data-i18n="functions">Functions</button>
      </div>

      <form id="flow-search-form" class="flow-search" role="search">
        <input
          id="flow-search-input"
          type="search"
          maxlength="512"
          autocomplete="off"
          placeholder="Route, operation, or framework" data-i18n-placeholder="entrypoint-placeholder"
          aria-label="Search entrypoints" data-i18n-aria-label="search-entrypoints"
        >
        <button id="flow-search-submit" class="search-submit" type="submit" aria-label="Search" data-i18n-aria-label="search" data-i18n="search">Find</button>
      </form>
      <div id="flow-search-meta" class="flow-search-meta" aria-live="polite"></div>
      <div id="flow-results" class="flow-results" aria-label="Flow starting points" data-i18n-aria-label="flow-starting-points"></div>
      <button id="flow-search-more" class="text-button" type="button" hidden data-i18n="load-more-functions">Load more functions</button>
    </section>

    <section id="flow-reader" class="flow-reader" aria-labelledby="flow-title" hidden>
      <button id="flow-back" class="back-button" type="button" data-i18n="choose-another-start">← Choose another start</button>
      <div class="flow-reader-header">
        <div id="flow-reader-kicker" class="section-kicker" data-i18n="static-flow-eyebrow">STATIC FLOW · POSSIBLE CALL PATH</div>
        <h2 id="flow-title"></h2>
        <div id="flow-subtitle" class="flow-subtitle"></div>
        <div id="flow-summary" class="flow-summary"></div>
      </div>
      <div id="flow-semantics-note" class="semantics-note">
        Arrows mean statically discoverable call relationships, not observed runtime order.
      </div>

      <section id="flow-origins-section" class="flow-origins" aria-labelledby="flow-origins-title" hidden>
        <h3 id="flow-origins-title" data-i18n="known-entrypoints">Known entrypoints</h3>
        <div id="flow-origins"></div>
      </section>

      <div id="flow-steps" class="flow-steps" role="tree" aria-label="Code flow steps" data-i18n-aria-label="code-flow-steps"></div>

      <section id="flow-gaps-section" class="flow-gaps" aria-labelledby="flow-gaps-title" hidden>
        <h3 id="flow-gaps-title" data-i18n="unknown-title">What remains unknown</h3>
        <div id="flow-gaps"></div>
      </section>
    </section>

    <details class="utility-actions">
      <summary data-i18n="analysis-data">Analysis and data</summary>
      <div class="button-grid utility-action-grid">
        <button id="analyze-current" class="secondary-button" type="button" data-i18n="analyze-current">Analyze Current File</button>
        <button id="show-workspace" class="secondary-button" type="button" data-i18n="restore-workspace">Restore Workspace</button>
        <button id="export-json" class="secondary-button" type="button" data-i18n="export-evidence">Export Evidence JSON</button>
        <button id="clear-cache" class="secondary-button" type="button" data-i18n="clear-cache">Clear Analysis Cache</button>
      </div>
    </details>
  </main>
  <script nonce="${options.nonce}">${getBrowserLocalizationSource()}\napplyProjectAnalyzerLanguage("${options.language ?? "en"}");\n${clientScript}</script>
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
<html lang="${options.language ?? "en"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
  <title>Project Analyzer Graph</title>
  <style>${getExplorerStyles("panel")}</style>
</head>
<body data-i18n-document-title="graph-title">
  <div class="shell panel-shell">
    <div class="panel-header">
      <div class="mode-switch" role="tablist">
        <button class="mode-button active" type="button" data-mode="file" data-i18n="graph-mode-files">Files</button>
        <button class="mode-button" type="button" data-mode="call" data-i18n="graph-mode-calls">Calls</button>
        <button class="mode-button" type="button" data-mode="class" data-i18n="graph-mode-classes">Classes</button>
      </div>
      <div class="graph-toolbar" aria-label="Graph controls" data-i18n-aria-label="graph-controls">
        <button id="zoom-out" class="icon-button" type="button" title="Zoom out" data-i18n-title="graph-zoom-out">-</button>
        <button id="zoom-reset" class="icon-button wide" type="button" title="Reset zoom" data-i18n-title="reset-zoom-short" data-i18n="graph-zoom-value">100%</button>
        <button id="zoom-in" class="icon-button" type="button" title="Zoom in" data-i18n-title="graph-zoom-in">+</button>
        <button id="fit-view" class="icon-button wide" type="button" title="Fit graph to view" data-i18n-title="fit-view" data-i18n="fit-short">Fit</button>
        <button id="center-view" class="icon-button wide" type="button" title="Move graph to center" data-i18n-title="center-view" data-i18n="center-short">Center</button>
      </div>
    </div>
    <div id="status" class="status" data-i18n="ready">Ready</div>
    <div class="graph-panel" aria-label="Graph canvas" data-i18n-aria-label="graph-canvas">
      <canvas id="graph-canvas" class="graph-canvas" width="${canvasWidth}" height="${canvasHeight}" role="application" tabindex="0" aria-label="Project graph canvas" data-i18n-aria-label="project-graph-canvas"></canvas>
    </div>
  </div>
  <script nonce="${options.nonce}">${getBrowserLocalizationSource()}\napplyProjectAnalyzerLanguage("${options.language ?? "en"}");\n${clientScript}</script>
</body>
</html>`;
}
