/** Theme-native source outline, with independent scrolling and responsive disclosure. */
export function getFunctionReadingStyles(): string {
  return /* css */ `
    .logic-reading-surface {
      display: grid;
      grid-template-columns: clamp(210px, 18vw, 260px) minmax(0, 1fr);
      grid-column: 1;
      grid-row: 1;
      min-width: 0;
      min-height: 0;
      height: 100%;
    }
    .logic-reading-surface.outline-closed { grid-template-columns: minmax(0, 1fr); }
    .logic-reading-surface > .logic-graph-viewport { min-width: 0; min-height: 0; height: 100%; }
    .logic-reading-outline {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      min-width: 0;
      min-height: 0;
      border: 1px solid var(--vscode-panel-border);
      border-right: 0;
      border-radius: 5px 0 0 5px;
      background: var(--vscode-sideBar-background);
    }
    .logic-reading-outline[hidden], .logic-reading-list > li[hidden], .logic-reading-empty[hidden] { display: none; }
    .logic-reading-header { padding: 14px 12px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
    .logic-reading-header h2 { margin: 0; font-size: max(13px, var(--logic-font-body)); font-weight: 650; }
    .logic-reading-description { margin: 6px 0 12px; color: var(--vscode-descriptionForeground); line-height: 1.5; font-size: max(12px, var(--logic-font-small)); }
    .logic-reading-filters { display: flex; flex-wrap: wrap; gap: 4px; }
    .logic-reading-filter, .logic-reading-footer button {
      min-height: 28px;
      padding: 4px 7px;
      color: var(--vscode-foreground);
      font: inherit;
      font-size: max(12px, var(--logic-font-small));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: transparent;
      cursor: pointer;
    }
    .logic-reading-filter[aria-pressed="true"] { color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); background: var(--vscode-list-activeSelectionBackground); border-color: var(--vscode-focusBorder); }
    .logic-reading-list { position: relative; min-height: 0; margin: 0; padding: 6px; list-style: none; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
    .logic-reading-list > li { margin: 0; content-visibility: auto; contain-intrinsic-size: auto 64px; }
    .logic-reading-step {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr);
      gap: 7px;
      width: 100%;
      min-height: 48px;
      padding: 9px 6px;
      text-align: left;
      color: var(--vscode-foreground);
      background: transparent;
      border: 1px solid transparent;
      border-left: 2px solid transparent;
      border-radius: 3px;
      cursor: pointer;
      touch-action: manipulation;
    }
    .logic-reading-ordinal { padding-top: 2px; color: var(--vscode-descriptionForeground); font-size: 11px; font-variant-numeric: tabular-nums; }
    .logic-reading-step-content { display: grid; gap: 4px; min-width: 0; padding-left: calc(var(--reading-depth) * 5px); }
    .logic-reading-step-meta { color: var(--vscode-descriptionForeground); font-size: max(11px, var(--logic-font-tiny)); line-height: 1.35; overflow-wrap: anywhere; }
    .logic-reading-step code { font-family: var(--vscode-editor-font-family); font-size: max(12px, var(--logic-code-small)); line-height: 1.5; overflow-wrap: anywhere; white-space: normal; }
    .logic-reading-step[aria-current="step"] { border-left-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); }
    .logic-reading-step[aria-current="step"] .logic-reading-step-meta,
    .logic-reading-step[aria-current="step"] .logic-reading-ordinal { color: inherit; }
    .logic-reading-step:hover, .logic-reading-filter:hover, .logic-reading-footer button:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
    .logic-reading-step[aria-current="step"]:hover, .logic-reading-filter[aria-pressed="true"]:hover { background: var(--vscode-list-activeSelectionBackground); }
    .logic-reading-step:focus-visible, .logic-reading-filter:focus-visible, .logic-reading-footer button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: -2px; }
    .logic-reading-empty { grid-row: 2; margin: 0; padding: 16px 12px; line-height: 1.6; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .logic-reading-footer { grid-row: 3; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px; border-top: 1px solid var(--vscode-panel-border); }
    .logic-reading-progress { flex: 1 1 75px; color: var(--vscode-descriptionForeground); font-size: 12px; font-variant-numeric: tabular-nums; }
    .logic-reading-footer button:disabled { opacity: 0.5; cursor: default; }
    @container logic-inspector (max-width: 1039px) {
      .logic-reading-surface { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(180px, 36%) minmax(0, 1fr); }
      .logic-reading-surface.outline-closed { grid-template-rows: minmax(0, 1fr); }
      .logic-reading-outline { border-right: 1px solid var(--vscode-panel-border); border-bottom: 0; border-radius: 5px 5px 0 0; }
      .logic-reading-header { padding: 8px 10px; }
      .logic-reading-description { margin: 3px 0 6px; }
      .logic-reading-footer { padding: 5px 10px; }
    }
    @media (pointer: coarse) {
      .logic-reading-filter, .logic-reading-footer button, .logic-reading-toggle { min-height: 44px; }
      @container logic-inspector (max-width: 1039px) {
        /* Touch targets need more room above the independently scrolling steps. */
        .logic-reading-surface:not(.outline-closed) { grid-template-rows: minmax(300px, 48%) minmax(0, 1fr); }
      }
    }
    @media (forced-colors: active) {
      .logic-reading-step[aria-current="step"], .logic-reading-filter[aria-pressed="true"] { border-color: Highlight; }
    }
  `;
}
