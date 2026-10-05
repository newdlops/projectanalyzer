/** Theme-native styles for compact LLM reading cards, shared by both Webview surfaces. */
export function getFunctionNarrativesStyles(): string {
  return /* css */ `
    .logic-function-narratives { display: grid; gap: 8px; min-width: 0; border-top: 1px solid var(--vscode-panel-border); padding-top: 12px; }
    .logic-function-narratives h3, .logic-function-narratives h4, .logic-function-narratives p { margin: 0; overflow-wrap: anywhere; line-height: 1.5; }
    .logic-narrative-status { color: var(--vscode-descriptionForeground); font-size: var(--logic-font-small); }
    .logic-narrative-results, .logic-narrative-scenario { display: grid; gap: 8px; min-width: 0; }
    .logic-narrative-scenario { padding: 12px 0; border-top: 1px solid var(--vscode-panel-border); }
    .logic-narrative-facts { display: grid; grid-template-columns: minmax(80px, .25fr) minmax(0, 1fr); gap: 4px 8px; min-width: 0; }
    .logic-narrative-facts strong { color: var(--vscode-descriptionForeground); font-weight: 500; }
    .logic-narrative-facts ul { margin: 0; padding-left: 18px; min-width: 0; }
    .logic-narrative-steps { margin: 0; padding-left: 22px; display: grid; gap: 8px; min-width: 0; }
    .logic-narrative-steps li, .logic-narrative-facts li { overflow-wrap: anywhere; line-height: 1.5; }
    .logic-narrative-source { margin-top: 4px; }
    .logic-narrative-paragraph { white-space: pre-line; }
    .logic-narrative-evidence { min-width: 0; font-size: var(--logic-font-small); }
    .logic-narrative-evidence > summary { cursor: pointer; padding: 4px 0; line-height: 1.5; color: var(--vscode-descriptionForeground); }
    .logic-narrative-evidence > summary:hover { color: var(--vscode-foreground); }
    .logic-narrative-evidence > summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .logic-narrative-evidence-body { display: grid; gap: 10px; padding-top: 8px; min-width: 0; }
    .logic-function-narratives [hidden] { display: none !important; }
    .logic-function-narratives button { min-height: 30px; white-space: normal; overflow-wrap: anywhere; }
    .logic-function-narratives button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    @container function-guide (max-width: 560px) { .logic-narrative-facts { grid-template-columns: 1fr; } }
    @media (max-width: 520px) { .logic-narrative-facts { grid-template-columns: 1fr; } }
    @media (pointer: coarse) { .logic-function-narratives button { min-height: 44px; } }
    @media (forced-colors: active) { .logic-function-narratives button:focus-visible { outline: 2px solid Highlight; } }
  `;
}
