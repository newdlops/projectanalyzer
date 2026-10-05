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
    .logic-narrative-example, .logic-narrative-node-reader, .logic-narrative-node-body, .logic-narrative-node-detail { display: grid; gap: 8px; min-width: 0; }
    .logic-narrative-example-values { display: grid; grid-template-columns: minmax(80px, .25fr) minmax(0, 1fr); gap: 4px 8px; margin: 0; min-width: 0; }
    .logic-narrative-example-values dt { color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
    .logic-narrative-example-values dd { margin: 0; min-width: 0; font-family: var(--vscode-editor-font-family); white-space: pre-wrap; overflow-wrap: anywhere; }
    .logic-narrative-select[aria-pressed="true"] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .logic-narrative-node-reader { border-top: 1px solid var(--vscode-panel-border); padding-top: 12px; }
    .logic-narrative-node-reader > label { font-size: var(--logic-font-small); color: var(--vscode-descriptionForeground); }
    .logic-narrative-node-select { box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; min-height: 30px; padding: 4px; font: inherit; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border)); border-radius: 3px; }
    .logic-narrative-node-select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .logic-narrative-node-detail + .logic-narrative-node-detail { border-top: 1px solid var(--vscode-panel-border); padding-top: 8px; }
    .logic-narrative-node-values { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: var(--logic-font-small); }
    .logic-narrative-node-values caption { text-align: left; color: var(--vscode-descriptionForeground); padding-bottom: 4px; }
    .logic-narrative-node-values th, .logic-narrative-node-values td { text-align: left; vertical-align: top; padding: 5px 6px; border-bottom: 1px solid var(--vscode-panel-border); white-space: pre-wrap; overflow-wrap: anywhere; }
    .logic-narrative-node-values tbody th, .logic-narrative-node-values td { font-family: var(--vscode-editor-font-family); font-weight: 400; }
    .logic-narrative-pagination { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border-top: 1px solid var(--vscode-panel-border); padding-top: 12px; min-width: 0; }
    .logic-narrative-page-label { flex: 1 0 100%; color: var(--vscode-descriptionForeground); font-size: var(--logic-font-small); overflow-wrap: anywhere; }
    .logic-narrative-pagination button { flex: 1; min-width: 0; }
    .logic-narrative-evidence { min-width: 0; font-size: var(--logic-font-small); }
    .logic-narrative-evidence > summary { cursor: pointer; padding: 4px 0; line-height: 1.5; color: var(--vscode-descriptionForeground); }
    .logic-narrative-evidence > summary:hover { color: var(--vscode-foreground); }
    .logic-narrative-evidence > summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .logic-narrative-evidence-body { display: grid; gap: 10px; padding-top: 8px; min-width: 0; }
    .logic-function-narratives [hidden] { display: none !important; }
    .logic-function-narratives button { min-height: 30px; white-space: normal; overflow-wrap: anywhere; }
    .logic-function-narratives button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    @container function-guide (max-width: 560px) { .logic-narrative-facts, .logic-narrative-example-values { grid-template-columns: 1fr; } .logic-narrative-example-values dd { margin-bottom: 4px; } }
    @media (max-width: 520px) { .logic-narrative-facts, .logic-narrative-example-values { grid-template-columns: 1fr; } .logic-narrative-example-values dd { margin-bottom: 4px; } }
    @media (pointer: coarse) { .logic-function-narratives button, .logic-narrative-node-select { min-height: 44px; } }
    @media (forced-colors: active) { .logic-function-narratives button:focus-visible { outline: 2px solid Highlight; } }
  `;
}
