/** Theme-aware lens and central attention styles for the Function Logic graph. */

/** Returns Function Logic comprehension styles without defining a new visual system. */
export function getFunctionLogicComprehensionStyles(): string {
  return /* css */ `
    .logic-lens-toolbar {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 3px;
      min-width: 0;
    }

    .logic-lens-label {
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-small);
      font-weight: 700;
    }

    .logic-lens-button {
      min-height: 26px;
      padding: 3px 7px;
      color: var(--vscode-foreground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      font-size: var(--logic-font-small);
    }

    .logic-lens-button:hover { background: var(--vscode-list-hoverBackground); }

    .logic-lens-button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .logic-lens-button[aria-pressed="true"] {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border-color: var(--vscode-button-background);
    }

    .logic-graph-node[data-attention],
    .logic-edge[data-attention],
    .logic-edge-label[data-attention] {
      transition: opacity 120ms ease-out;
    }

    .logic-graph-node[data-attention="related"],
    .logic-edge[data-attention="related"],
    .logic-edge-label[data-attention="related"] { opacity: 1; }

    .logic-graph-node[data-attention="context"] { opacity: 0.78; }
    .logic-edge[data-attention="context"],
    .logic-edge-label[data-attention="context"] { opacity: 0.62; }

    .logic-graph-node[data-attention="muted"] { opacity: 0.42; }
    .logic-edge[data-attention="muted"],
    .logic-edge-label[data-attention="muted"] { opacity: 0.28; }

    .logic-graph-node.selected[data-attention],
    .logic-graph-node:focus-visible[data-attention] { opacity: 1; }

    .logic-static-ledger {
      display: grid;
      gap: 5px;
      min-width: 0;
      padding: 8px;
      background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
    }

    .logic-static-ledger > strong { font-size: var(--logic-font-body); }

    .logic-static-ledger > p {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-small);
      line-height: 1.35;
    }

    .logic-static-ledger-list {
      display: grid;
      gap: 3px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .logic-static-ledger-step {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 6px;
      width: 100%;
      min-width: 0;
      padding: 5px 6px;
      color: var(--vscode-foreground);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 3px;
      text-align: left;
      cursor: pointer;
    }

    .logic-static-ledger-step:hover { background: var(--vscode-list-hoverBackground); }
    .logic-static-ledger-step:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
    .logic-static-ledger-step[aria-current="step"] {
      background: var(--vscode-list-activeSelectionBackground);
      border-color: var(--vscode-focusBorder);
    }

    .logic-static-ledger-step > span {
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-tiny);
      font-weight: 700;
    }

    .logic-static-ledger-step > strong {
      min-width: 0;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--logic-code-small);
      overflow-wrap: anywhere;
    }

    @media (prefers-reduced-motion: reduce) {
      .logic-graph-node[data-attention],
      .logic-edge[data-attention],
      .logic-edge-label[data-attention] { transition: none; }
    }
  `;
}
