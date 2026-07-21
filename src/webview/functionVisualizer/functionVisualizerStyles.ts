/** Theme-aware layout for the navigable, single-canvas Function Visualizer tab. */

import { getFunctionLogicGraphStyles } from "../codeFlow/functionLogicGraphStyles";

/** Returns panel chrome plus the shared source-backed graph styles. */
export function getFunctionVisualizerStyles(): string {
  return /* css */ `
    :root {
      color-scheme: light dark;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
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
      width: 100%;
      min-height: 100vh;
      margin: 0 auto;
      padding: 8px clamp(12px, 1.8vw, 28px) 24px;
    }

    .visualizer-topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 12px;
      margin: -8px calc(-1 * clamp(12px, 1.8vw, 28px)) 8px;
      padding: 6px clamp(12px, 1.8vw, 28px);
      background: color-mix(in srgb, var(--vscode-editor-background) 94%, transparent);
      border-bottom: 1px solid var(--vscode-panel-border);
      backdrop-filter: blur(10px);
    }

    .visualizer-topbar[hidden] { display: none; }

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
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      gap: 3px 16px;
      margin-bottom: 5px;
    }

    .visualizer-eyebrow {
      color: var(--vscode-textLink-foreground);
      grid-column: 1 / -1;
      grid-row: 1;
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.12em;
    }

    .visualizer-header h1 {
      grid-column: 1;
      grid-row: 2;
      margin: 0;
      min-width: 0;
      font-size: clamp(1.4rem, 2.1vw, 2rem);
      line-height: 1.08;
      overflow-wrap: anywhere;
    }

    .visualizer-subtitle,
    .visualizer-summary,
    .semantics-note,
    .status {
      color: var(--vscode-descriptionForeground);
      line-height: 1.35;
    }

    .visualizer-subtitle {
      grid-column: 1 / -1;
      grid-row: 3;
      min-width: 0;
      font-size: 0.88rem;
      overflow-wrap: anywhere;
    }

    .visualizer-summary {
      grid-column: 2;
      grid-row: 2;
      max-width: min(54vw, 780px);
      font-size: 0.86rem;
      font-weight: 600;
      text-align: right;
    }

    .semantics-note {
      grid-column: 1 / -1;
      grid-row: 4;
      margin-top: 2px;
      padding: 5px 8px;
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 6%, transparent);
      border-left: 2px solid var(--vscode-textLink-foreground);
      border-radius: 3px;
      font-size: 0.82rem;
    }

    .status {
      margin: 4px 0 6px;
      font-size: 0.86rem;
    }

    .status[hidden] { display: none; }

    .flow-steps {
      display: grid;
      gap: 10px;
      min-width: 0;
    }

    .function-origins {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 5px 8px;
      margin: 4px 0 6px;
    }

    .function-origins[hidden] { display: none; }

    .function-origins h2 {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 0.78rem;
      white-space: nowrap;
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
      font-size: 0.78rem;
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
      font-size: 0.72rem;
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

    .flow-gaps h2 { margin: 0 0 10px; font-size: 1.15rem; }
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

    .logic-signature { padding: 10px 11px; }
    .logic-signature > span { font-size: var(--logic-font-small); }
    .logic-signature code { font-size: var(--logic-code-font-size); }
    .logic-graph-header > strong { font-size: var(--logic-font-large); }
    .logic-graph-legend { grid-column: auto; justify-content: flex-start; }
    .visualizer-shell .logic-graph-workspace {
      --logic-workspace-height: clamp(460px, 76vh, 1080px);
    }

    .logic-graph-viewport {
      width: 100%;
      border-radius: 9px;
    }
    .logic-node-label { font-size: var(--logic-code-small); }
    .logic-node-meta { font-size: var(--logic-code-tiny); }
    .logic-value-target-kind { font-size: var(--logic-font-tiny); }
    .logic-value-change code { font-size: var(--logic-code-small); }
    .logic-selection { padding: 13px 14px; }
    .logic-selection-header > strong { font-size: var(--logic-code-body); }
    .logic-selection-detail,
    .logic-selection-meta { font-size: var(--logic-font-body); }

    @media (max-width: 900px) {
      .visualizer-header { grid-template-columns: minmax(0, 1fr); }
      .visualizer-summary {
        grid-column: 1;
        grid-row: 4;
        max-width: none;
        text-align: left;
      }
      .semantics-note { grid-row: 5; }
    }

    @media (min-width: 721px) {
      .visualizer-shell .logic-graph-workspace.inspector-open {
        grid-template-columns: minmax(0, 1fr) clamp(300px, 31vw, 430px);
      }
    }

    @media (max-width: 640px) {
      .visualizer-topbar { grid-template-columns: 1fr; }
      .logic-graph-header { grid-template-columns: 1fr; }
      .logic-graph-legend { grid-column: 1; }
      .visualizer-shell .logic-graph-workspace {
        --logic-workspace-height: clamp(380px, 70vh, 760px);
      }
    }
  `;
}
