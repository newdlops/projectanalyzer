/**
 * Webview HTML factory for the Project Analyzer GUI. It owns document assembly
 * while browser-side behavior lives in explorerClientScript.ts.
 */

import * as vscode from "vscode";
import { getExplorerClientScript } from "./explorerClientScript";

/** Data required to construct the explorer Webview HTML. */
export type WebviewHtmlOptions = {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  nonce: string;
  defaultDepth: number;
  initialMode: "call" | "file" | "class";
  surface: "sidebar";
};

/**
 * Builds the Visual Explorer HTML document for the sidebar Webview.
 */
export function getExplorerHtml(options: WebviewHtmlOptions): string {
  const cspSource = options.webview.cspSource;
  const clientScript = getExplorerClientScript({
    defaultDepth: options.defaultDepth,
    initialMode: options.initialMode
  });

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
  <title>Project Analyzer</title>
  <style>${getExplorerStyles()}</style>
</head>
<body>
  <div class="shell">
    <div class="toolbar">
      <button id="analyze-workspace" class="primary-button" type="button">Analyze Workspace</button>
    </div>
    <div class="button-grid">
      <button id="analyze-current" class="secondary-button" type="button">Current File</button>
      <button id="cancel-analysis" class="secondary-button" type="button">Cancel</button>
      <button id="export-json" class="secondary-button" type="button">Export JSON</button>
      <button id="clear-cache" class="secondary-button" type="button">Clear</button>
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
      <svg id="graph-canvas" class="graph-canvas" viewBox="0 0 320 220" role="img"></svg>
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

/**
 * Returns theme-aware CSS for the sidebar explorer shell and graph canvas.
 */
function getExplorerStyles(): string {
  return /* css */ `
    :root {
      color-scheme: light dark;
    }

    body {
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    button,
    input {
      font: inherit;
    }

    .shell {
      display: flex;
      min-width: 0;
      min-height: 100vh;
      flex-direction: column;
      gap: 10px;
      padding: 10px;
      box-sizing: border-box;
    }

    .toolbar,
    .button-grid,
    .action-grid,
    .mode-switch,
    .stats {
      display: flex;
      gap: 6px;
    }

    .toolbar {
      align-items: center;
    }

    .button-grid,
    .action-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .primary-button,
    .secondary-button,
    .action-button,
    .mode-button {
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .primary-button,
    .secondary-button,
    .action-button {
      flex: 1;
      padding: 6px 8px;
    }

    .primary-button {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    .primary-button:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .secondary-button,
    .action-button {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }

    .secondary-button:hover,
    .action-button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .secondary-button:disabled,
    .action-button:disabled,
    .primary-button:disabled {
      cursor: default;
      opacity: 0.55;
    }

    .mode-switch {
      padding: 2px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
    }

    .mode-button {
      flex: 1;
      min-width: 0;
      padding: 4px 6px;
      color: var(--vscode-foreground);
      background: transparent;
    }

    .mode-button.active {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-secondaryBackground);
    }

    .search {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
    }

    .status {
      min-height: 18px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .graph-panel {
      min-height: 220px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: var(--vscode-editor-background);
      overflow: hidden;
    }

    .graph-canvas {
      display: block;
      width: 100%;
      height: 220px;
    }

    .graph-edge {
      stroke: var(--vscode-descriptionForeground);
      stroke-width: 1.2;
      opacity: 0.55;
    }

    .graph-edge.unresolved {
      stroke-dasharray: 4 3;
      opacity: 0.45;
    }

    .graph-edge.selected {
      stroke: var(--vscode-charts-green);
      stroke-width: 1.8;
      opacity: 0.85;
    }

    .graph-edge.dimmed,
    .graph-node.dimmed {
      opacity: 0.32;
    }

    .graph-node {
      cursor: pointer;
      outline: none;
    }

    .graph-node circle {
      fill: var(--vscode-sideBar-background);
      stroke: var(--vscode-charts-blue);
      stroke-width: 1.5;
    }

    .graph-node.selected circle,
    .graph-node:focus circle {
      fill: var(--vscode-button-background);
      stroke: var(--vscode-button-foreground);
      stroke-width: 2;
    }

    .graph-node.external circle {
      stroke: var(--vscode-charts-yellow);
    }

    .graph-label {
      fill: var(--vscode-foreground);
      font-size: 10px;
      pointer-events: none;
      text-anchor: middle;
    }

    .graph-message {
      fill: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-anchor: middle;
    }

    .stat {
      min-width: 0;
      padding: 6px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
    }

    .stat-value {
      display: block;
      font-size: 16px;
      font-weight: 600;
      line-height: 1.1;
    }

    .stat-label {
      display: block;
      overflow: hidden;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .list {
      display: flex;
      min-height: 0;
      flex: 1;
      flex-direction: column;
      gap: 4px;
      overflow: auto;
    }

    .node-row {
      width: 100%;
      min-width: 0;
      padding: 7px 8px;
      color: var(--vscode-foreground);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      text-align: left;
      cursor: pointer;
    }

    .node-row:hover,
    .node-row.selected {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-panel-border);
    }

    .node-name,
    .node-meta {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .node-meta {
      margin-top: 2px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .detail {
      padding-top: 8px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .detail-title {
      overflow: hidden;
      margin-bottom: 3px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .detail-meta {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .empty-state {
      padding: 12px 8px;
      color: var(--vscode-descriptionForeground);
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 4px;
      text-align: center;
    }
  `;
}
