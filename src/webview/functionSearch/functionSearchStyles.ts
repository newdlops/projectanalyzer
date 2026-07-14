/** CSS for the bounded host-backed function search controls. */

/** Returns styles scoped to the Explore Code Flows search region. */
export function getFunctionSearchStyles(): string {
  return /* css */ `
    .calls-panel {
      flex-direction: column;
    }

    .function-search {
      display: flex;
      flex: 0 0 auto;
      flex-direction: column;
      gap: 3px;
      padding: 2px 4px 5px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .function-search-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      min-width: 0;
      gap: 3px;
    }

    .function-search-input {
      min-width: 0;
      padding: 3px 5px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 3px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
    }

    .function-search-button {
      padding: 3px 6px;
      overflow: hidden;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      cursor: pointer;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .function-search-button:hover,
    .function-search-button:focus-visible {
      background: var(--vscode-button-secondaryHoverBackground);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .function-search-button:disabled {
      cursor: default;
      opacity: 0.55;
    }

    .function-search-meta {
      display: flex;
      min-width: 0;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
    }

    .function-search-status {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .function-search-more {
      flex: 0 0 auto;
      padding: 0;
      border: 0;
      color: var(--vscode-textLink-foreground);
      background: transparent;
      cursor: pointer;
      font: inherit;
    }

    .function-search-more:hover,
    .function-search-more:focus-visible {
      color: var(--vscode-textLink-activeForeground);
      text-decoration: underline;
      outline: none;
    }
  `;
}
