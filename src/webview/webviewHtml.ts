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
    <div id="explorer-tree" class="list explorer-tree" role="tree" aria-label="Project import tree"></div>
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
    maxNodes: 1000
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
