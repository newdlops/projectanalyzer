/** Theme-aware Debug Variables-like styles for Function Logic value previews. */

/** Returns isolated styles for the session-scoped value preview editor. */
export function getFunctionLogicValuePreviewStyles(): string {
  return /* css */ `
    .logic-value-preview-editor {
      display: grid;
      min-width: 0;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
      overflow: hidden;
    }

    .logic-value-preview-header {
      display: flex;
      min-width: 0;
      align-items: start;
      justify-content: space-between;
      gap: 8px;
      padding: 8px;
    }

    .logic-value-preview-heading {
      display: grid;
      min-width: 0;
      gap: 2px;
    }

    .logic-value-preview-heading strong {
      font-size: var(--logic-font-body);
    }

    .logic-value-preview-heading span,
    .logic-value-preview-omitted {
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-tiny);
      line-height: 1.35;
    }

    .logic-value-preview-clear-all,
    .logic-value-preview-clear {
      flex: 0 0 auto;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 3px;
      cursor: pointer;
    }

    .logic-value-preview-clear-all {
      min-height: 23px;
      padding: 2px 6px;
      font-size: var(--logic-font-tiny);
    }

    .logic-value-preview-columns,
    .logic-value-preview-row {
      display: grid;
      grid-template-columns: minmax(105px, 0.85fr) minmax(130px, 1.15fr);
      min-width: 0;
    }

    .logic-value-preview-columns {
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-keybindingTable-headerBackground, var(--vscode-editorGroupHeader-tabsBackground));
      border-top: 1px solid var(--vscode-panel-border);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: var(--logic-font-tiny);
      font-weight: 700;
    }

    .logic-value-preview-columns span,
    .logic-value-preview-identity,
    .logic-value-preview-input-cell {
      min-width: 0;
      padding: 5px 7px;
    }

    .logic-value-preview-columns span + span,
    .logic-value-preview-input-cell {
      border-left: 1px solid var(--vscode-panel-border);
    }

    .logic-value-preview-row + .logic-value-preview-row {
      border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, transparent);
    }

    .logic-value-preview-rows {
      min-height: 0;
      max-height: clamp(160px, 26vh, 260px);
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }

    .logic-value-preview-row.selected {
      background: color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 38%, transparent);
      box-shadow: inset 3px 0 0 var(--vscode-focusBorder);
    }

    .logic-value-preview-row.inferred {
      border-left: 2px dashed var(--vscode-descriptionForeground);
    }

    .logic-value-preview-identity {
      appearance: none;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      width: 100%;
      align-items: center;
      gap: 3px 5px;
      color: inherit;
      background: transparent;
      border: 0;
      text-align: left;
      cursor: pointer;
    }

    .logic-value-preview-identity:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .logic-value-preview-identity:focus-visible,
    .logic-value-preview-identity.selected {
      color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -2px;
    }

    .logic-value-preview-kind {
      color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
      font-size: var(--logic-font-tiny);
      font-weight: 800;
    }

    .logic-value-preview-kind.local { color: var(--vscode-charts-green, var(--vscode-foreground)); }
    .logic-value-preview-kind.constant { color: var(--vscode-charts-purple, var(--vscode-textLink-foreground)); }
    .logic-value-preview-kind.component { color: var(--vscode-charts-yellow, var(--vscode-textLink-foreground)); }
    .logic-value-preview-kind.manual { color: var(--vscode-debugTokenExpression-value, var(--vscode-charts-yellow)); }

    .logic-value-preview-identity code,
    .logic-value-preview-input {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--logic-code-small);
    }

    .logic-value-preview-identity code {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .logic-value-preview-scope {
      grid-column: 2;
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-tiny);
      overflow-wrap: anywhere;
    }

    .logic-value-preview-input-cell {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 3px;
    }

    .logic-value-preview-input {
      width: 100%;
      min-width: 0;
      min-height: 24px;
      padding: 3px 5px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      outline: none;
    }

    .logic-value-preview-input:focus,
    .logic-value-preview-clear-all:focus-visible,
    .logic-value-preview-clear:focus-visible {
      border-color: var(--vscode-focusBorder);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .logic-value-preview-clear {
      width: 23px;
      height: 23px;
      padding: 0;
      font-size: var(--logic-font-large);
      line-height: 1;
    }

    .logic-value-preview-tracked-rows:not(:empty)
      + .logic-value-preview-manual-rows:not(:empty) {
      border-top: 1px solid var(--vscode-panel-border);
    }

    .logic-value-preview-empty {
      margin: 0;
      padding: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-small);
      line-height: 1.4;
    }

    .logic-value-preview-add {
      display: grid;
      grid-template-columns: minmax(90px, 0.8fr) minmax(120px, 1.2fr) auto;
      align-items: center;
      gap: 5px;
      min-width: 0;
      padding: 7px;
      background: color-mix(in srgb, var(--vscode-debugTokenExpression-value) 5%, transparent);
      border-top: 1px solid var(--vscode-panel-border);
    }

    .logic-value-preview-add-button {
      min-height: 24px;
      padding: 3px 7px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 3px;
      font-size: var(--logic-font-small);
      cursor: pointer;
      white-space: nowrap;
    }

    .logic-value-preview-add-button:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
    }

    .logic-value-preview-add-button:focus-visible {
      border-color: var(--vscode-focusBorder);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .logic-value-preview-add-status {
      grid-column: 1 / -1;
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-tiny);
      overflow-wrap: anywhere;
    }

    .logic-value-preview-add-status.error {
      color: var(--vscode-errorForeground);
    }

    .logic-value-preview-omitted {
      margin: 0;
      padding: 6px 8px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .logic-value-access-preview {
      flex: 1 1 100%;
      min-width: 0;
      color: var(--vscode-debugTokenExpression-value, var(--vscode-charts-yellow));
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--logic-code-small);
      line-height: 1.3;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    @media (max-width: 430px) {
      .logic-value-preview-columns,
      .logic-value-preview-row {
        grid-template-columns: 1fr;
      }

      .logic-value-preview-columns span + span,
      .logic-value-preview-input-cell {
        border-left: 0;
        border-top: 1px solid var(--vscode-panel-border);
      }

      .logic-value-preview-add { grid-template-columns: 1fr; }
      .logic-value-preview-add-status { grid-column: 1; }
    }

    @media (forced-colors: active) {
      .logic-value-preview-editor,
      .logic-value-preview-input,
      .logic-value-preview-clear-all,
      .logic-value-preview-clear,
      .logic-value-preview-add-button {
        border-color: CanvasText;
      }
    }
  `;
}
