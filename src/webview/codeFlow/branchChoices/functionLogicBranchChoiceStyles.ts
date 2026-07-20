/** Choice-specific Function Logic styles kept outside the main graph stylesheet. */

/** Returns theme-aware path-choice, reachability, and reset-control styles. */
export function getFunctionLogicBranchChoiceStyles(): string {
  return /* css */ `
    .flow-badge.logic-legend.choice {
      color: var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }

    .logic-edge-label.logic-edge-choice {
      pointer-events: all;
      cursor: pointer;
      text-decoration: underline;
      text-decoration-style: dotted;
      text-underline-offset: 2px;
    }

    .logic-edge.choice-dimmed,
    .logic-edge-label.choice-dimmed,
    .logic-graph-node.choice-dimmed {
      opacity: 0.16;
    }

    .logic-graph-node.choice-dimmed.selected {
      opacity: 0.55;
    }

    .logic-edge.choice-reachable {
      opacity: 0.92;
    }

    .logic-edge.choice-selected {
      opacity: 1;
      stroke: var(--vscode-focusBorder);
      stroke-width: 3.2;
    }

    .logic-edge-label.choice-selected {
      fill: var(--vscode-focusBorder);
      font-weight: 800;
      opacity: 1;
    }

    .logic-edge-label.logic-edge-choice:focus {
      fill: var(--vscode-focusBorder);
      stroke-width: 6px;
    }

    .logic-transfer-choice {
      appearance: none;
      max-width: 100%;
      cursor: pointer;
      font: inherit;
      overflow-wrap: anywhere;
      text-align: left;
      white-space: normal;
    }

    .logic-transfer-choice:hover,
    .logic-transfer-choice:focus-visible,
    .logic-transfer-choice.selected {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border-color: var(--vscode-focusBorder);
      outline: none;
    }

    .logic-choice-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 8px;
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 55%, transparent);
      border-radius: 5px;
      font-size: 8px;
    }

    .logic-choice-reset {
      flex: 0 0 auto;
      padding: 3px 6px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 4px;
      font: inherit;
      cursor: pointer;
    }

    .logic-choice-reset:hover,
    .logic-choice-reset:focus-visible {
      border-color: var(--vscode-focusBorder);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    @media (forced-colors: active) {
      .logic-edge.choice-selected,
      .logic-edge-label.choice-selected,
      .logic-choice-summary,
      .logic-transfer-choice.selected {
        color: HighlightText;
        fill: Highlight;
        stroke: Highlight;
        border-color: Highlight;
      }
    }
  `;
}
