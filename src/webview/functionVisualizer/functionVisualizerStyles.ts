/** Theme-aware layout for the navigable, single-canvas Function Visualizer tab. */

import { getFunctionLogicGraphStyles } from "../codeFlow/functionLogicGraphStyles";

/** Returns panel chrome plus the shared source-backed graph styles. */
export function getFunctionVisualizerStyles(): string {
  return /* css */ `
    :root {
      color-scheme: light dark;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }

    * { box-sizing: border-box; }

    body {
      min-width: 320px;
      margin: 0;
      background: var(--vscode-editor-background);
    }

    button { font: inherit; }

    .visualizer-shell {
      width: min(1320px, 100%);
      margin: 0 auto;
      padding: 22px clamp(16px, 3vw, 42px) 48px;
    }

    .visualizer-topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 12px;
      margin: -22px calc(-1 * clamp(16px, 3vw, 42px)) 24px;
      padding: 12px clamp(16px, 3vw, 42px);
      background: color-mix(in srgb, var(--vscode-editor-background) 94%, transparent);
      border-bottom: 1px solid var(--vscode-panel-border);
      backdrop-filter: blur(10px);
    }

    .back-button,
    .breadcrumb-button {
      min-height: 28px;
      color: var(--vscode-foreground);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 5px;
      cursor: pointer;
    }

    .back-button {
      padding: 4px 10px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .back-button:disabled,
    .breadcrumb-button:disabled {
      opacity: 0.62;
      cursor: default;
    }

    .breadcrumbs {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 4px;
      overflow-x: auto;
      scrollbar-width: thin;
    }

    .breadcrumb-button {
      flex: 0 0 auto;
      max-width: 260px;
      padding: 4px 7px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .breadcrumb-button.active {
      color: var(--vscode-textLink-foreground);
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 10%, transparent);
      font-weight: 700;
    }

    .breadcrumb-separator {
      flex: 0 0 auto;
      color: var(--vscode-descriptionForeground);
    }

    .visualizer-header {
      display: grid;
      gap: 7px;
      margin-bottom: 18px;
    }

    .visualizer-eyebrow {
      color: var(--vscode-textLink-foreground);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.12em;
    }

    .visualizer-header h1 {
      margin: 0;
      font-size: clamp(22px, 3vw, 34px);
      line-height: 1.15;
      overflow-wrap: anywhere;
    }

    .visualizer-subtitle,
    .visualizer-summary,
    .semantics-note,
    .status {
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }

    .visualizer-summary { font-weight: 600; }

    .semantics-note {
      padding: 10px 12px;
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 6%, transparent);
      border-left: 3px solid var(--vscode-textLink-foreground);
      border-radius: 4px;
    }

    .status {
      min-height: 22px;
      margin: 10px 0 18px;
      font-size: 12px;
    }

    .flow-steps {
      display: grid;
      gap: 16px;
      min-width: 0;
    }

    .function-origins {
      display: grid;
      gap: 7px;
      margin: 0 0 16px;
    }

    .function-origins h2 {
      margin: 0;
      font-size: 12px;
    }

    #function-origins {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }

    .origin-chip {
      padding: 4px 7px;
      color: var(--vscode-textLink-foreground);
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 7%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 30%, var(--vscode-panel-border));
      border-radius: 999px;
      font-size: 10px;
    }

    .visualizer-empty {
      display: grid;
      min-height: 260px;
      place-items: center;
      padding: 24px;
      color: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-sideBar-background) 45%, transparent);
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 10px;
      text-align: center;
    }

    .flow-badge {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      padding: 2px 5px;
      color: var(--vscode-descriptionForeground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 999px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    .logic-button {
      width: fit-content;
      min-height: 28px;
      padding: 4px 9px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      cursor: pointer;
    }

    button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    .flow-gaps {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .flow-gaps h2 { margin: 0 0 10px; font-size: 15px; }
    #flow-gaps { display: grid; gap: 8px; }

    .gap-card {
      padding: 10px 12px;
      background: var(--vscode-editorWarning-background, transparent);
      border: 1px solid var(--vscode-editorWarning-border, var(--vscode-panel-border));
      border-radius: 6px;
    }

    .gap-card p {
      margin: 4px 0 0;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }

    ${getFunctionLogicGraphStyles()}

    .visualizer-shell .logic-graph-node.expandable {
      border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 58%, var(--vscode-panel-border));
      cursor: zoom-in;
    }

    .visualizer-shell .logic-graph-node.expandable.expanded {
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, var(--vscode-sideBar-background));
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-textLink-foreground) 22%, transparent);
      cursor: zoom-out;
    }

    .visualizer-shell .logic-callee-button.expanded {
      border-color: var(--vscode-textLink-foreground);
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 10%, transparent);
    }

    .logic-signature { padding: 12px 14px; }
    .logic-signature > span { font-size: 10px; }
    .logic-signature code { font-size: 13px; }
    .logic-graph-header > strong { font-size: 14px; }
    .logic-graph-legend { grid-column: auto; justify-content: flex-start; }
    .logic-graph-viewport { max-height: min(68vh, 760px); border-radius: 9px; }
    .logic-node-label { font-size: 10px; }
    .logic-node-meta { font-size: 8px; }
    .logic-selection { padding: 13px 14px; }
    .logic-selection-header > strong { font-size: 13px; }
    .logic-selection-detail,
    .logic-selection-meta { font-size: 11px; }

    @media (max-width: 640px) {
      .visualizer-topbar { grid-template-columns: 1fr; }
      .logic-graph-header { grid-template-columns: 1fr; }
      .logic-graph-legend { grid-column: 1; }
    }
  `;
}
