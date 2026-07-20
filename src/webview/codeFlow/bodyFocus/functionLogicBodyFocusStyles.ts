/**
 * In-flow navigation and owner affordances for dynamic body frames. Controls
 * occupy layout space above the graph workspace and never cover the canvas.
 */

/** Returns theme-aware body-focus navigation and owner-state styles. */
export function getFunctionLogicBodyFocusStyles(): string {
  return /* css */ `
    .logic-body-focus-navigation {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-width: 0;
      padding: 6px 8px;
      background: color-mix(
        in srgb,
        var(--vscode-charts-purple) 6%,
        var(--vscode-editor-background)
      );
      border: 1px solid color-mix(
        in srgb,
        var(--vscode-charts-purple) 30%,
        var(--vscode-panel-border)
      );
      border-radius: 6px;
    }

    .logic-body-focus-navigation[hidden] { display: none; }

    .logic-body-focus-summary {
      color: var(--vscode-charts-purple, var(--vscode-textLink-foreground));
      font-size: var(--logic-font-small);
      letter-spacing: 0.06em;
      white-space: nowrap;
    }

    .logic-body-focus-hint {
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-small);
      overflow-wrap: anywhere;
    }

    .logic-body-focus-path,
    .logic-body-focus-actions {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 4px;
    }

    .logic-body-focus-path { overflow-x: auto; }

    .logic-body-focus-current {
      min-width: 0;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--logic-code-small);
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .logic-body-focus-separator {
      color: var(--vscode-descriptionForeground);
      flex: 0 0 auto;
    }

    .logic-body-focus-crumb,
    .logic-body-focus-action {
      padding: 3px 6px;
      color: var(--vscode-foreground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 4px;
      font: inherit;
      font-size: var(--logic-font-small);
      cursor: pointer;
    }

    .logic-body-focus-crumb {
      min-width: 0;
      font-family: var(--vscode-editor-font-family);
      overflow-wrap: anywhere;
    }

    .logic-body-focus-crumb:hover,
    .logic-body-focus-action:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
    }

    .flow-badge.logic-node-body-focus {
      color: var(--vscode-charts-purple, var(--vscode-textLink-foreground));
      border-color: color-mix(
        in srgb,
        var(--vscode-charts-purple) 60%,
        var(--vscode-panel-border)
      );
      font-size: var(--logic-font-tiny);
    }

    .logic-graph-node.logic-node-body-owner { cursor: zoom-in; }

    .logic-graph-node.logic-node-body-focused {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 2px;
      cursor: default;
    }

    .logic-graph-node.logic-node-body-nested:not(.logic-node-body-current)
      .logic-node-body-focus::after {
      content: " ↗";
    }

    @media (max-width: 720px) {
      .logic-body-focus-navigation { grid-template-columns: 1fr; }
      .logic-body-focus-actions { justify-content: flex-start; }
    }

    @media (forced-colors: active) {
      .logic-body-focus-navigation { border-color: CanvasText; }
      .logic-graph-node.logic-node-body-focused { outline-color: Highlight; }
    }
  `;
}
