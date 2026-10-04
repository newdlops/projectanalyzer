/** Compact VS Code theme styles for static facts and representative shared rows. */
export function getFunctionSummaryStyles(): string {
  return /* css */ `
    .logic-behavior-summary, .logic-representative-summary { display: grid; gap: 8px; min-width: 0; padding-top: 8px; border-top: 1px solid var(--vscode-panel-border); }
    .logic-behavior-summary p, .logic-representative-summary p { margin: 0; overflow-wrap: anywhere; }
    .logic-summary-note, .logic-summary-basis, .logic-summary-disclosure { color: var(--vscode-descriptionForeground); font-size: var(--logic-font-small); line-height: 1.45; }
    .logic-summary-purpose { color: var(--vscode-foreground); font-size: var(--logic-font-medium); line-height: 1.45; }
    .logic-summary-basis { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .logic-summary-fact-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; min-width: 0; }
    .logic-summary-fact-columns > section, .logic-behavior-summary > section { display: grid; align-content: start; gap: 6px; min-width: 0; }
    .logic-summary-list, .logic-summary-stages, .logic-summary-scenarios { display: grid; align-content: start; gap: 6px; margin: 0; padding: 0; min-width: 0; list-style: none; }
    .logic-summary-item { display: grid; gap: 4px; min-width: 0; padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-foreground); font-size: var(--logic-font-small); overflow-wrap: anywhere; }
    .logic-summary-item code { white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--vscode-editor-font-family); font-size: inherit; }
    .logic-summary-alternatives { display: grid; gap: 3px; margin: 0; padding-left: 18px; }
    .logic-summary-disclosure summary { color: var(--vscode-foreground); cursor: pointer; overflow-wrap: anywhere; }
    .logic-summary-disclosure summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .logic-summary-disclosure > ul { margin-top: 6px; }
    .logic-summary-disclosure li { overflow-wrap: anywhere; }
    .logic-summary-scenario { display: grid; gap: 6px; padding: 8px 0; min-width: 0; border-bottom: 1px solid var(--vscode-panel-border); }
    .logic-summary-scenario-select { min-height: 30px; font-weight: 700; }
    .logic-summary-scenario-facts { display: grid; grid-template-columns: minmax(80px, .3fr) minmax(0, 1fr); gap: 4px 8px; margin: 0; min-width: 0; font-size: var(--logic-font-small); }
    .logic-summary-scenario-facts dt { color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
    .logic-summary-scenario-facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
    @container function-guide (max-width: 560px) { .logic-summary-fact-columns { grid-template-columns: 1fr; gap: 8px; } .logic-summary-scenario-facts { grid-template-columns: 1fr; gap: 2px; } .logic-summary-scenario-facts dd { margin-bottom: 6px; } }
    @media (max-width: 520px) { .logic-summary-fact-columns, .logic-summary-scenario-facts { grid-template-columns: 1fr; } .logic-summary-scenario-facts dd { margin-bottom: 6px; } }
    @media (pointer: coarse) { .logic-summary-scenario-select, .logic-summary-show-more { min-height: 44px; } }
    @media (forced-colors: active) { .logic-summary-scenario-select[aria-current="true"] { outline: 2px solid Highlight; outline-offset: -2px; } }
  `;
}
