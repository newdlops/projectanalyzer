/**
 * Theme-aware CSS shared by the Project Analyzer sidebar and graph panel.
 */

import {
  getProjectGuideStyles,
  getSidebarDisclosureStyles
} from "./explorerSidebarStructureStyles";
import { getFunctionSearchStyles } from "./functionSearch";
import { getProjectLearningJourneyStyles } from "./projectLearningJourney";

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
      width: 100%;
      max-width: 1280px;
      margin: 0 auto;
    }

    .toolbar,
    .button-grid,
    .action-grid,
    .panel-header,
    .graph-toolbar,
    .mode-switch {
      display: flex;
      gap: 6px;
    }

    .toolbar {
      align-items: center;
    }

    .panel-header {
      align-items: center;
      flex-wrap: wrap;
    }

    .graph-toolbar {
      flex-wrap: wrap;
      justify-content: flex-end;
      margin-left: auto;
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
    .view-button,
    .icon-button {
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

    .icon-button {
      width: 30px;
      height: 28px;
      padding: 0;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }

    .icon-button.wide {
      width: 64px;
    }

    .icon-button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
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

    .more-actions {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .more-actions > summary {
      width: fit-content;
      cursor: pointer;
      user-select: none;
    }

    .more-actions-grid {
      margin-top: 6px;
    }

    .graph-panel {
      box-sizing: border-box;
      width: 100%;
      min-width: ${surface === "panel" ? "360px" : "0"};
      max-width: 100%;
      height: ${graphHeight};
      min-height: ${surface === "panel" ? "300px" : graphHeight};
      max-height: ${surface === "panel" ? "calc(100vh - 130px)" : graphHeight};
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: var(--vscode-editor-background);
      overflow: hidden;
      ${surface === "panel" ? "resize: both;" : ""}
    }

    .graph-canvas {
      display: block;
      width: 100%;
      height: 100%;
      outline: none;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }

    .graph-canvas:focus {
      box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
    }

    .graph-canvas.panning {
      cursor: grabbing;
    }

${getProjectGuideStyles()}
${getProjectLearningJourneyStyles()}
    .list {
      display: flex;
      min-height: 0;
      flex: 1;
      flex-direction: column;
      gap: 4px;
      overflow: auto;
    }

${getSidebarDisclosureStyles()}
${getFunctionSearchStyles()}
    .explorer-tree {
      gap: 0;
      padding: 2px 0;
    }

    .explorer-tree.virtual-tree {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: auto;
    }

    .virtual-tree-spacer {
      position: relative;
      width: 100%;
      min-width: 0;
    }

    .virtual-tree-row {
      position: absolute;
      top: 0;
      right: 0;
      left: 0;
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

    .tree-row {
      display: grid;
      grid-template-columns: 16px 16px minmax(0, 1fr);
      align-items: center;
      width: 100%;
      min-width: 0;
      height: 22px;
      padding-top: 0;
      padding-right: 8px;
      padding-bottom: 0;
      color: var(--vscode-foreground);
      background: transparent;
      border: 0;
      border-radius: 0;
      text-align: left;
      cursor: pointer;
    }

    .tree-row:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .tree-row.selected {
      color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
      background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground));
    }

    .tree-row:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
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
      position: relative;
      width: 16px;
      height: 22px;
      opacity: 0;
    }

    .tree-row.expandable .tree-disclosure {
      opacity: 1;
    }

    .tree-disclosure::before {
      position: absolute;
      top: 7px;
      left: 5px;
      width: 0;
      height: 0;
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
      border-left: 5px solid var(--vscode-icon-foreground);
      content: "";
      opacity: 0.82;
    }

    .tree-row.expanded .tree-disclosure::before {
      transform: rotate(90deg);
      transform-origin: 2px 4px;
    }

    .tree-file-icon {
      position: relative;
      width: 16px;
      height: 22px;
      color: var(--vscode-icon-foreground);
    }

    .tree-file-icon::before {
      position: absolute;
      top: 5px;
      left: 4px;
      width: 8px;
      height: 10px;
      border: 1px solid currentColor;
      border-radius: 1px;
      content: "";
      opacity: 0.76;
    }

    .tree-row.entry-row .tree-file-icon::before {
      border-color: var(--vscode-charts-green, currentColor);
      opacity: 0.95;
    }

    .tree-row.external-row .tree-file-icon::before {
      border-style: dashed;
      opacity: 0.62;
    }

    .tree-row.framework-row .tree-file-icon::before {
      border-color: var(--vscode-charts-blue, currentColor);
      opacity: 0.9;
    }

    .tree-row.semantic-row .tree-file-icon::before {
      top: 8px;
      left: 5px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      opacity: 0.68;
    }

    .tree-label-group {
      display: flex;
      min-width: 0;
      align-items: baseline;
      gap: 6px;
    }

    .tree-label,
    .tree-detail {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tree-label {
      min-width: 0;
    }

    .tree-detail {
      min-width: 24px;
      max-width: 58%;
      flex: 0 1 auto;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
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
