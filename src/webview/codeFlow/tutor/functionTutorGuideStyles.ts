/** Theme-native styles for the Function Guide reading surface. */

/** Returns compact VS Code-themed CSS for Guide hierarchy, states, and responsive tables. */
export function getFunctionTutorGuideStyles(): string {
  return /* css */ `
    .logic-function-guide { display: grid; gap: 8px; min-width: 0; }
    .logic-function-guide-content { display: grid; gap: 10px; min-width: 0; }
    .logic-function-guide h3, .logic-function-guide h4 { margin: 0; color: var(--vscode-foreground); font-size: var(--logic-font-medium); line-height: 1.3; }
    .logic-guide-status, .logic-guide-answer, .logic-guide-empty, .logic-guide-scenario-body > p, .logic-guide-scenario-description { margin: 0; color: var(--vscode-descriptionForeground); font-size: var(--logic-font-small); line-height: 1.45; overflow-wrap: anywhere; }
    .logic-guide-overview, .logic-guide-navigation, .logic-guide-chapter { display: grid; gap: 6px; min-width: 0; }
    .logic-guide-overview { padding-top: 8px; border-top: 1px solid var(--vscode-panel-border); }
    .logic-guide-overview dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 8px; margin: 0; font-size: var(--logic-font-small); }
    .logic-guide-overview dt { color: var(--vscode-descriptionForeground); }
    .logic-guide-overview dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
    .logic-guide-navigation ol { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
    .logic-guide-question { width: 100%; min-height: 26px; padding: 3px 5px; color: var(--vscode-foreground); background: transparent; border: 1px solid transparent; border-radius: 3px; font: inherit; font-size: var(--logic-font-small); text-align: left; overflow-wrap: anywhere; cursor: pointer; }
    .logic-guide-question:hover { background: var(--vscode-list-hoverBackground); }
    .logic-guide-question[aria-current="true"] { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); border-color: var(--vscode-focusBorder); }
    .logic-guide-progress { margin: 0; color: var(--vscode-descriptionForeground); font-size: var(--logic-font-small); }
    .logic-guide-facts { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .logic-guide-facts li { display: grid; gap: 4px; min-width: 0; padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border); font-size: var(--logic-font-small); overflow-wrap: anywhere; }
    .logic-guide-facts strong { font-weight: 700; }
    .logic-guide-certainty { color: var(--vscode-descriptionForeground); font-size: var(--logic-font-small); }
    .logic-guide-facts .flow-badge, .logic-guide-source-basis .flow-badge, .logic-guide-scenario-detail .flow-badge { justify-self: start; }
    .logic-guide-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .logic-guide-action, .logic-guide-source-action, .logic-guide-actions > button, .logic-guide-toggle { min-height: 26px; padding: 3px 8px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); border-radius: 3px; font: inherit; font-size: var(--logic-font-small); font-weight: 650; cursor: pointer; touch-action: manipulation; }
    .logic-guide-source-action { align-self: start; justify-self: start; font-weight: 600; }
    .logic-guide-action:hover:not(:disabled), .logic-guide-source-action:hover, .logic-guide-actions > button:hover:not(:disabled), .logic-guide-toggle:hover { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .logic-guide-action:disabled, .logic-guide-actions > button:disabled { opacity: .65; cursor: default; }
    .logic-guide-source-basis, .logic-guide-scenarios, .logic-guide-limits, .logic-guide-more-facts { color: var(--vscode-descriptionForeground); font-size: var(--logic-font-small); line-height: 1.45; }
    .logic-guide-source-basis summary, .logic-guide-scenarios summary, .logic-guide-limits summary, .logic-guide-more-facts summary { color: var(--vscode-foreground); cursor: pointer; }
    .logic-guide-source-basis summary:focus-visible, .logic-guide-scenarios summary:focus-visible, .logic-guide-limits summary:focus-visible, .logic-guide-more-facts summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .logic-guide-source-basis ul, .logic-guide-limits ul, .logic-guide-more-facts ul { display: grid; gap: 4px; margin: 6px 0 0; padding-left: 18px; }
    .logic-guide-source-basis li { overflow-wrap: anywhere; }
    .logic-guide-scenario-body { display: grid; gap: 8px; padding-top: 7px; }
    .logic-guide-scenario-table, .logic-guide-transition-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: var(--logic-font-small); font-variant-numeric: tabular-nums; }
    .logic-guide-scenario-table caption { padding: 2px 0 5px; color: var(--vscode-descriptionForeground); text-align: left; }
    .logic-guide-scenario-table th, .logic-guide-scenario-table td, .logic-guide-transition-table th, .logic-guide-transition-table td { padding: 5px 6px; border: 1px solid var(--vscode-panel-border); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    .logic-guide-scenario-select { width: 100%; padding: 2px; color: var(--vscode-foreground); background: transparent; border: 1px solid transparent; border-radius: 2px; font: inherit; font-size: inherit; text-align: left; cursor: pointer; }
    .logic-guide-scenario-select:hover { background: var(--vscode-list-hoverBackground); }
    .logic-guide-scenario-select.selected, .logic-guide-scenario-select[aria-current="true"] { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .logic-guide-scenario-body label { display: grid; gap: 3px; color: var(--vscode-descriptionForeground); font-size: var(--logic-font-small); }
    .logic-guide-scenario-detail { display: grid; gap: 8px; min-width: 0; padding-top: 8px; border-top: 1px solid var(--vscode-panel-border); }
    .logic-guide-scenario-detail dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 8px; margin: 0; font-size: var(--logic-font-small); }
    .logic-guide-scenario-detail dt { color: var(--vscode-descriptionForeground); }
    .logic-guide-scenario-detail dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
    .logic-guide-scenario-body select { max-width: 100%; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 3px; font: inherit; }
    .logic-guide-question:focus-visible, .logic-guide-action:focus-visible, .logic-guide-source-action:focus-visible, .logic-guide-toggle:focus-visible, .logic-guide-scenario-select:focus-visible, .logic-guide-scenario-body select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    @media (max-width: 520px) { .logic-guide-overview dl, .logic-guide-scenario-detail dl { grid-template-columns: 1fr; gap: 1px; } .logic-guide-overview dd, .logic-guide-scenario-detail dd { margin-bottom: 5px; } }
    @container logic-inspector (max-width: 340px) { .logic-guide-overview dl, .logic-guide-scenario-detail dl { grid-template-columns: 1fr; gap: 1px; } .logic-guide-overview dd, .logic-guide-scenario-detail dd { margin-bottom: 5px; } .logic-guide-actions { align-items: stretch; } .logic-guide-actions > button { flex: 1 1 100%; } }
    @media (pointer: coarse) { .logic-guide-question, .logic-guide-action, .logic-guide-source-action, .logic-guide-toggle, .logic-guide-scenario-select, .logic-guide-scenario-body select { min-height: 44px; } }
    @media (forced-colors: active) { .logic-guide-question[aria-current="true"], .logic-guide-scenario-select[aria-current="true"] { outline: 2px solid Highlight; outline-offset: -2px; } }
    @media (prefers-reduced-motion: reduce) { .logic-function-guide *, .logic-guide-toggle { transition: none; } }
  `;
}
