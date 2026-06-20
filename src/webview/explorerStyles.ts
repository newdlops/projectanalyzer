/**
 * Theme-aware CSS shared by the Project Analyzer sidebar and graph panel.
 */

/** Visual surface that receives the shared explorer styles. */
export type ExplorerSurface = "sidebar" | "panel";

/**
 * Returns CSS for the requested Webview surface.
 */
export function getExplorerStyles(surface: ExplorerSurface): string {
  const graphHeight = surface === "panel" ? "min(62vh, 620px)" : "220px";

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

    .panel-shell {
      max-width: 1280px;
      margin: 0 auto;
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
    .mode-button,
    .view-button {
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

    .view-switch {
      display: flex;
      width: fit-content;
      max-width: 100%;
      gap: 4px;
      padding: 2px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
    }

    .mode-button,
    .view-button {
      flex: 1;
      min-width: 0;
      padding: 4px 6px;
      color: var(--vscode-foreground);
      background: transparent;
    }

    .mode-button.active,
    .view-button.active {
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
      min-height: ${graphHeight};
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: var(--vscode-editor-background);
      overflow: hidden;
    }

    .graph-canvas {
      display: block;
      width: 100%;
      height: ${graphHeight};
    }

    .graph-edge {
      fill: none;
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
      display: flex;
      align-items: center;
      gap: 6px;
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

    .node-row.tree-row {
      padding-top: 4px;
      padding-bottom: 4px;
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

    .node-text {
      min-width: 0;
      flex: 1;
    }

    .tree-disclosure {
      display: inline-flex;
      width: 14px;
      flex: 0 0 14px;
      justify-content: center;
      color: var(--vscode-descriptionForeground);
    }

    .tree-disclosure.empty {
      opacity: 0;
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
