/** Compact reading hierarchy using the existing VS Code typography and semantic colors. */
export function getFunctionUnderstandingStyles(): string {
  return /* css */ `
    .logic-understanding { min-width: 0; padding: 12px 0 4px; }
    .logic-understanding h2 { margin: 0; font-size: max(14px, var(--logic-font-body)); font-weight: 650; }
    .logic-understanding-hint { margin: 4px 0 12px; color: var(--vscode-descriptionForeground); font-size: max(12px, var(--logic-font-small)); line-height: 1.5; }
    .logic-understanding-documentation { margin: 8px 0 12px; padding-left: 10px; border-left: 2px solid var(--vscode-panel-border); font-size: max(12px, var(--logic-font-small)); line-height: 1.6; overflow-wrap: anywhere; white-space: pre-wrap; max-height: 7em; overflow: auto; }
    .logic-understanding-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-block: 1px solid var(--vscode-panel-border); }
    .logic-understanding-action { display: flex; flex-direction: column; gap: 5px; min-width: 0; min-height: 88px; padding: 12px; color: var(--vscode-foreground); background: transparent; border: 0; text-align: left; font: inherit; cursor: pointer; touch-action: manipulation; }
    .logic-understanding-action + .logic-understanding-action { border-left: 1px solid var(--vscode-panel-border); }
    .logic-understanding-action strong { font-size: max(12px, var(--logic-font-small)); font-weight: 600; }
    .logic-understanding-value { line-height: 1.5; font-size: max(12px, var(--logic-font-small)); overflow-wrap: anywhere; }
    .logic-understanding-value.source-names { font-family: var(--vscode-editor-font-family); }
    .logic-understanding-link { margin-top: auto; padding-top: 3px; color: var(--vscode-textLink-foreground); font-size: max(12px, var(--logic-font-small)); }
    .logic-understanding-action:disabled { color: var(--vscode-descriptionForeground); cursor: default; }
    .logic-understanding-action:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
    .logic-understanding-action:focus-visible, .logic-framework summary:focus-visible, .logic-framework button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: -2px; }
    .logic-framework { margin-top: 4px; min-width: 0; border-bottom: 1px solid var(--vscode-panel-border); }
    .logic-framework > summary { padding: 12px 8px; min-height: 40px; cursor: pointer; font-size: max(12px, var(--logic-font-small)); overflow-wrap: anywhere; }
    .logic-framework-role { margin-left: 10px; color: var(--vscode-descriptionForeground); font-weight: 400; }
    .logic-framework-note { margin: 4px 8px 12px; color: var(--vscode-descriptionForeground); font-size: max(12px, var(--logic-font-small)); line-height: 1.5; }
    .logic-framework-facts { margin: 0 0 8px; padding: 0 4px; max-height: 300px; overflow: auto; overscroll-behavior: contain; list-style: none; scrollbar-width: thin; }
    .logic-framework-fact { border-top: 1px solid var(--vscode-panel-border); }
    .logic-framework-fact > summary { padding: 10px 8px; cursor: pointer; line-height: 1.6; overflow-wrap: anywhere; font-size: max(12px, var(--logic-font-small)); }
    .logic-framework summary:hover { background: var(--vscode-list-hoverBackground); }
    .logic-framework-phase { display: inline-block; margin-right: 10px; color: var(--vscode-descriptionForeground); font-size: max(11px, var(--logic-font-tiny)); }
    .logic-framework-fact strong { font-weight: 600; }
    .logic-framework-body { padding: 0 12px 12px 22px; min-width: 0; }
    .logic-framework-body p { margin: 0 0 8px; font-size: max(12px, var(--logic-font-small)); line-height: 1.65; }
    .logic-framework-body code { display: block; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--vscode-editor-font-family); font-size: max(12px, var(--logic-code-small)); line-height: 1.6; }
    .logic-framework-evidence { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
    .logic-framework-confidence { font-size: max(11px, var(--logic-font-tiny)); color: var(--vscode-descriptionForeground); margin-right: auto; }
    .logic-framework-evidence button { min-height: 32px; white-space: normal; overflow-wrap: anywhere; }
    .logic-framework-evidence button:disabled { opacity: 0.6; cursor: default; }
    .logic-framework [hidden], .logic-understanding [hidden] { display: none; }
    .logic-step-explanation { padding: 10px 0; border-bottom: 1px solid var(--vscode-panel-border); font-size: max(12px, var(--logic-font-small)); }
    .logic-step-explanation > strong { font-weight: 600; }
    .logic-step-explanation p { margin: 5px 0 0; line-height: 1.65; }
    @media (max-width: 560px) {
      .logic-understanding-actions { grid-template-columns: minmax(0, 1fr); }
      .logic-understanding-action { min-height: 44px; gap: 3px; padding: 10px 8px; }
      .logic-understanding-action + .logic-understanding-action { border-left: 0; border-top: 1px solid var(--vscode-panel-border); }
      .logic-understanding-link { padding-top: 0; }
      .logic-framework-role { display: block; margin: 3px 0 0 15px; }
      .logic-framework-phase { display: block; margin: 0; }
      .logic-framework-body { padding-left: 8px; }
    }
    @media (pointer: coarse) { .logic-framework summary, .logic-framework-evidence button { min-height: 44px; } }
    @media (forced-colors: active) { .logic-understanding-link { color: LinkText; } .logic-understanding-action:disabled { color: GrayText; } }
  `;
}
