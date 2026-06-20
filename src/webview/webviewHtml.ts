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
    <div class="button-grid">
      <button id="analyze-current" class="secondary-button" type="button">Current File</button>
      <button id="open-graph" class="secondary-button" type="button">Open Graph</button>
      <button id="cancel-analysis" class="secondary-button" type="button">Cancel</button>
      <button id="export-json" class="secondary-button" type="button">Export JSON</button>
      <button id="clear-cache" class="secondary-button" type="button">Clear</button>
    </div>
    <div id="status" class="status">Ready</div>
    <div class="stats" aria-label="Graph summary">
      <div class="stat"><span id="files" class="stat-value">0</span><span class="stat-label">Files</span></div>
      <div class="stat"><span id="symbols" class="stat-value">0</span><span class="stat-label">Nodes</span></div>
      <div class="stat"><span id="edges" class="stat-value">0</span><span class="stat-label">Edges</span></div>
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
    maxNodes: 72
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
    <div class="toolbar">
      <button id="export-json" class="secondary-button" type="button">Export JSON</button>
    </div>
    <div class="mode-switch" role="tablist">
      <button class="mode-button active" type="button" data-mode="file">Files</button>
      <button class="mode-button" type="button" data-mode="call">Calls</button>
      <button class="mode-button" type="button" data-mode="class">Classes</button>
    </div>
    <input id="search" class="search" type="search" placeholder="Search" aria-label="Search">
    <div id="status" class="status">Ready</div>
    <div class="stats" aria-label="Graph summary">
      <div class="stat"><span id="files" class="stat-value">0</span><span class="stat-label">Files</span></div>
      <div class="stat"><span id="symbols" class="stat-value">0</span><span class="stat-label">Nodes</span></div>
      <div class="stat"><span id="edges" class="stat-value">0</span><span class="stat-label">Edges</span></div>
    </div>
    <div class="graph-panel" aria-label="Graph canvas">
      <svg id="graph-canvas" class="graph-canvas" viewBox="0 0 ${canvasWidth} ${canvasHeight}" role="img"></svg>
    </div>
    <div class="view-switch" role="tablist" aria-label="Node browser mode">
      <button class="view-button active" type="button" data-node-view="tree">Tree</button>
      <button class="view-button" type="button" data-node-view="list">List</button>
    </div>
    <div id="list" class="list" aria-label="Graph nodes"></div>
    <section class="detail" aria-label="Selected node">
      <div id="detail-title" class="detail-title">No selection</div>
      <div id="detail-meta" class="detail-meta"></div>
      <div class="action-grid">
        <button id="open-source" class="action-button" type="button" disabled>Open</button>
        <button id="show-callers" class="action-button" type="button" disabled>Callers</button>
        <button id="show-callees" class="action-button" type="button" disabled>Callees</button>
      </div>
    </section>
  </div>
  <script nonce="${options.nonce}">${clientScript}</script>
</body>
</html>`;
}
