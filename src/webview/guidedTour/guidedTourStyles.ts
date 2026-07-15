/** Theme-aware styles for the Guide/Explore surfaces and current-stop card. */

/** Returns Guided Tour styles injected only as part of the shared Webview CSS. */
export function getGuidedTourStyles(): string {
  return /* css */ `
    .sidebar-surface-tabs {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 3px;
      padding: 2px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
    }

    .surface-tab {
      min-width: 0;
      padding: 5px 7px;
      overflow: hidden;
      border: 0;
      border-radius: 3px;
      color: var(--vscode-foreground);
      background: transparent;
      cursor: pointer;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .surface-tab:hover,
    .surface-tab:focus-visible {
      background: var(--vscode-list-hoverBackground);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .surface-tab.active {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-secondaryBackground);
    }

    .sidebar-surface[hidden] {
      display: none;
    }

    .guided-tour-surface,
    .explore-surface,
    .guided-tour-content,
    .guided-tour-mission,
    .guided-tour-stop,
    .guided-tour-unavailable {
      min-width: 0;
    }

    .guided-tour-content,
    .explore-surface,
    .guided-tour-mission,
    .guided-tour-stop,
    .guided-tour-unavailable {
      display: flex;
      flex-direction: column;
    }

    .guided-tour-content,
    .explore-surface {
      gap: 8px;
    }

    .guided-tour-mission,
    .guided-tour-stop,
    .guided-tour-unavailable {
      gap: 6px;
      padding: 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
      background: var(--vscode-editor-background);
    }

    .guided-tour-stop {
      border-left: 3px solid var(--vscode-focusBorder);
    }

    .guided-tour-mission-title,
    .guided-tour-stop-label,
    .guided-tour-exit-heading {
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .guided-tour-progress,
    .guided-tour-field-label {
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .guided-tour-context,
    .guided-tour-location,
    .guided-tour-copy,
    .guided-tour-note,
    .guided-tour-error,
    .guided-tour-empty,
    .guided-tour-list,
    .guided-tour-architecture {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .guided-tour-objective {
      line-height: 1.4;
    }

    .guided-tour-architecture {
      padding: 3px 5px;
      border-radius: 3px;
      color: var(--vscode-badge-foreground);
      background: var(--vscode-badge-background);
    }

    .guided-tour-field {
      display: grid;
      grid-template-columns: 72px minmax(0, 1fr);
      gap: 6px;
    }

    .guided-tour-list-field {
      min-width: 0;
    }

    .guided-tour-list {
      margin: 3px 0 0;
      padding-left: 18px;
    }

    .guided-tour-list li + li {
      margin-top: 2px;
    }

    .guided-tour-evidence {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .guided-tour-evidence > summary {
      width: fit-content;
      cursor: pointer;
      font-weight: 600;
      user-select: none;
    }

    .guided-tour-evidence[open] {
      padding-top: 2px;
    }

    .guided-tour-actions {
      display: flex;
      gap: 6px;
      margin-top: 2px;
    }

    .guided-tour-primary {
      min-width: 0;
    }

    .guided-tour-back {
      flex: 0 1 auto;
    }

    .guided-tour-error {
      padding: 4px 6px;
      border-left: 2px solid var(--vscode-errorForeground);
      color: var(--vscode-errorForeground);
      background: var(--vscode-inputValidation-errorBackground, transparent);
    }

    .guided-tour-exit {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 4px;
      margin-top: 2px;
      padding-top: 7px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .guided-tour-empty {
      padding: 12px 8px;
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 5px;
      text-align: center;
    }
  `;
}
