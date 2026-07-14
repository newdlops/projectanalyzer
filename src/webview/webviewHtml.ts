/**
 * Webview HTML factory for Project Analyzer GUI surfaces. The sidebar is a
 * control surface; the graph browser is rendered only inside a WebviewPanel tab.
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

/**
 * Builds the requested Project Analyzer Webview document.
 */
export function getExplorerHtml(options: WebviewHtmlOptions): string {
  if (options.surface === "panel") {
    return getGraphPanelHtml(options);
  }

  return getSidebarHtml(options);
}

/**
 * Builds the Activity Bar sidebar control surface.
 */
function getSidebarHtml(options: WebviewHtmlOptions): string {
  const cspSource = options.webview.cspSource;
  const clientScript = getExplorerSidebarScript();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
  <title>Project Analyzer</title>
  <style>${getExplorerStyles("sidebar")}</style>
</head>
<body>
  <div class="shell sidebar-shell">
    <div class="toolbar">
      <button id="analyze-workspace" class="primary-button" type="button">Analyze Workspace</button>
    </div>
    <details class="more-actions">
      <summary>More actions</summary>
      <div class="button-grid more-actions-grid">
        <button id="analyze-current" class="secondary-button" type="button">Current File</button>
        <button id="show-workspace" class="secondary-button" type="button">Workspace Scope</button>
        <button id="export-json" class="secondary-button" type="button">Export JSON</button>
        <button id="clear-cache" class="secondary-button" type="button">Clear Cache</button>
      </div>
    </details>
    <div id="status" class="status">Ready</div>
    <div id="project-guide" class="project-guide" aria-label="Project reading guide">
      <div class="summary-title">Project Map</div>
      <div id="guide-summary" class="guide-summary" aria-live="polite"></div>
      <div class="guide-section-label">Detected scopes</div>
      <div id="guide-scopes" class="guide-scopes" aria-live="polite"></div>
      <div id="guide-scope-detail" class="guide-scope-detail" aria-live="polite"></div>
    </div>
    <div class="accordion" aria-label="Detailed explorer sections">
      <section id="call-section" class="tree-section calls-section collapsed">
        <button id="accordion-calls" class="accordion-header" type="button" aria-expanded="false" aria-controls="call-panel">
          <span class="accordion-disclosure"></span>
          <span class="accordion-title">Explore Code Flows</span>
        </button>
        <div id="call-panel" class="accordion-panel" hidden>
          <div id="call-tree" class="list explorer-tree call-tree" role="tree" aria-label="Code flow tree"></div>
        </div>
      </section>
      <section id="structure-section" class="tree-section structure-section collapsed">
        <button id="accordion-structure" class="accordion-header" type="button" aria-expanded="false" aria-controls="structure-panel">
          <span class="accordion-disclosure"></span>
          <span class="accordion-title">Browse Structure</span>
        </button>
        <div id="structure-panel" class="accordion-panel" hidden>
          <div class="structure-switch" role="tablist" aria-label="Structure view">
            <button id="structure-frameworks" class="view-button active" type="button" role="tab" aria-selected="true">Components</button>
            <button id="structure-files" class="view-button" type="button" role="tab" aria-selected="false">Files</button>
          </div>
          <div id="framework-tree" class="list explorer-tree framework-tree" role="tree" aria-label="Framework semantic tree"></div>
          <div id="explorer-tree" class="list explorer-tree" role="tree" aria-label="Project import tree" hidden></div>
        </div>
      </section>
      <section id="analysis-section" class="tree-section analysis-section collapsed">
        <button id="accordion-analysis" class="accordion-header" type="button" aria-expanded="false" aria-controls="analysis-panel">
          <span class="accordion-disclosure"></span>
          <span class="accordion-title">Analysis Details</span>
        </button>
        <div id="analysis-panel" class="accordion-panel analysis-panel" hidden>
          <div id="project-overview" class="project-overview" aria-label="Project Brief and analysis signals">
            <div class="overview-block">
              <div class="summary-title">Analysis Scope</div>
              <div id="project-brief" class="overview-list" aria-live="polite"></div>
            </div>
            <div class="overview-block">
              <div class="summary-title">Analysis Signals</div>
              <div id="analysis-signals" class="signal-list" aria-live="polite"></div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
  <script nonce="${options.nonce}">${clientScript}</script>
</body>
</html>`;
}

/**
 * Builds the editor-tab graph browser WebviewPanel.
 */
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
      <canvas
        id="graph-canvas"
        class="graph-canvas"
        width="${canvasWidth}"
        height="${canvasHeight}"
        role="application"
        tabindex="0"
        aria-label="Project graph canvas"
      ></canvas>
    </div>
  </div>
  <script nonce="${options.nonce}">${clientScript}</script>
</body>
</html>`;
}
