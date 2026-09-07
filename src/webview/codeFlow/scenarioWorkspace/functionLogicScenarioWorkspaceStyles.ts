/** Theme-token styles for the path-centric Values Scenario Workspace. */
export function getFunctionLogicScenarioWorkspaceStyles(): string {
  return /* css */ `
    .logic-scenario-workspace { display:grid; gap:7px; min-width:0; padding:9px; border-top:1px solid var(--vscode-panel-border); container:scenario-workspace / inline-size; }
    .logic-scenario-workspace-heading { margin:0; font-size:var(--logic-font-body); line-height:1.3; }
    .logic-scenario-workspace-intro, .logic-scenario-workspace-status { margin:0; color:var(--vscode-descriptionForeground); font-size:var(--logic-font-tiny); line-height:1.4; overflow-wrap:anywhere; }
    .logic-scenario-workspace-table { width:100%; min-width:0; table-layout:fixed; border-collapse:collapse; border:1px solid var(--vscode-panel-border); font-size:var(--logic-font-tiny); }
    .logic-scenario-workspace-table th, .logic-scenario-workspace-table td { min-width:0; padding:6px; border-bottom:1px solid var(--vscode-panel-border); vertical-align:top; text-align:left; line-height:1.35; overflow-wrap:anywhere; }
    .logic-scenario-workspace-table thead th { color:var(--vscode-descriptionForeground); background:var(--vscode-keybindingTable-headerBackground, var(--vscode-editorGroupHeader-tabsBackground)); font-weight:700; }
    .logic-scenario-workspace-table thead th:nth-child(1) { width:18%; }
    .logic-scenario-workspace-table thead th:nth-child(2) { width:28%; }
    .logic-scenario-workspace-table thead th:nth-child(3) { width:27%; }
    .logic-scenario-workspace-table thead th:nth-child(4) { width:11%; }
    .logic-scenario-workspace-table thead th:nth-child(5) { width:16%; }
    .logic-scenario-workspace-row.selected { background:var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground)); color:var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); }
    .logic-scenario-workspace-row:hover { background:var(--vscode-list-hoverBackground); }
    .logic-scenario-workspace-row-selector { display:grid; gap:2px; width:100%; min-width:0; padding:0; color:inherit; background:transparent; border:0; text-align:left; cursor:pointer; }
    .logic-scenario-workspace-row-selector strong, .logic-scenario-workspace-row-selector small { min-width:0; overflow-wrap:anywhere; }
    .logic-scenario-workspace-row-selector small { color:var(--vscode-descriptionForeground); font-size:var(--logic-font-tiny); font-weight:400; }
    .logic-scenario-workspace-row-selector:focus-visible, .logic-scenario-workspace-play:focus-visible, .logic-scenario-workspace-detail button:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:2px; }
    .logic-scenario-workspace-action { padding:4px !important; }
    .logic-scenario-workspace-play { width:100%; min-height:30px; padding:4px 7px; color:var(--vscode-button-foreground); background:var(--vscode-button-background); border:1px solid var(--vscode-button-border, var(--vscode-panel-border)); border-radius:3px; cursor:pointer; font-size:var(--logic-font-tiny); overflow-wrap:anywhere; }
    .logic-scenario-workspace-play:hover:not(:disabled) { background:var(--vscode-button-hoverBackground); }
    .logic-scenario-workspace-play:disabled, .logic-scenario-workspace-detail button:disabled { cursor:not-allowed; opacity:.58; }
    .logic-scenario-workspace-detail { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:8px; min-width:0; padding:8px; background:color-mix(in srgb, var(--vscode-editor-background) 84%, var(--vscode-sideBar-background)); border:1px solid var(--vscode-panel-border); border-radius:4px; font-size:var(--logic-font-tiny); }
    .logic-scenario-workspace-detail:empty { display:none; }
    .logic-scenario-workspace-detail > h4, .logic-scenario-workspace-detail > .logic-scenario-workspace-note, .logic-scenario-workspace-detail-actions { grid-column:1 / -1; }
    .logic-scenario-workspace-detail h4, .logic-scenario-workspace-detail h5 { margin:0; line-height:1.35; }
    .logic-scenario-workspace-detail h5 { color:var(--vscode-descriptionForeground); font-size:var(--logic-font-tiny); }
    .logic-scenario-workspace-detail section { display:grid; align-content:start; gap:4px; min-width:0; }
    .logic-scenario-workspace-detail p { margin:0; overflow-wrap:anywhere; }
    .logic-scenario-workspace-note { padding:5px 7px; color:var(--vscode-descriptionForeground); background:color-mix(in srgb, var(--vscode-charts-yellow) 8%, transparent); border:1px solid color-mix(in srgb, var(--vscode-charts-yellow) 48%, var(--vscode-panel-border)); border-radius:3px; }
    .logic-scenario-workspace-detail dl { display:grid; grid-template-columns:minmax(70px, auto) minmax(0, 1fr); gap:3px 7px; margin:0; }
    .logic-scenario-workspace-detail dt { color:var(--vscode-descriptionForeground); font-family:var(--vscode-editor-font-family); }
    .logic-scenario-workspace-detail dd { min-width:0; margin:0; font-family:var(--vscode-editor-font-family); overflow-wrap:anywhere; }
    .logic-scenario-workspace-detail ol { margin:0; padding-left:18px; overflow-wrap:anywhere; }
    .logic-scenario-workspace-detail-actions { display:flex; flex-wrap:wrap; gap:6px; }
    .logic-scenario-workspace-detail button { min-height:30px; padding:4px 8px; color:var(--vscode-button-secondaryForeground); background:var(--vscode-button-secondaryBackground); border:1px solid var(--vscode-button-border, var(--vscode-panel-border)); border-radius:3px; cursor:pointer; }
    .logic-scenario-workspace-row-selector, .logic-scenario-workspace-play, .logic-scenario-workspace-detail button { touch-action:manipulation; }
    .logic-scenario-workspace-detail button:hover:not(:disabled) { background:var(--vscode-button-secondaryHoverBackground); }
    @container scenario-workspace (max-width: 560px) {
      .logic-scenario-workspace-table, .logic-scenario-workspace-table tbody, .logic-scenario-workspace-row, .logic-scenario-workspace-table th, .logic-scenario-workspace-table td { display:block; width:100%; box-sizing:border-box; }
      .logic-scenario-workspace-table thead { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); clip-path:inset(50%); white-space:nowrap; }
      .logic-scenario-workspace-row { padding:5px 0; border-bottom:1px solid var(--vscode-panel-border); }
      .logic-scenario-workspace-table th, .logic-scenario-workspace-table td { display:grid; grid-template-columns:minmax(82px, .38fr) minmax(0, 1fr); gap:6px; border-bottom:0; }
      .logic-scenario-workspace-table th::before, .logic-scenario-workspace-table td::before { color:var(--vscode-descriptionForeground); content:attr(data-label); font-weight:700; }
      .logic-scenario-workspace-row-selector { display:block; }
      .logic-scenario-workspace-action { display:grid !important; }
    }
    @media (pointer:coarse) { .logic-scenario-workspace-play, .logic-scenario-workspace-detail button, .logic-scenario-workspace-row-selector { min-height:44px; } }
    @media (forced-colors: active) { .logic-scenario-workspace-row.selected { outline:1px solid Highlight; } .logic-scenario-workspace-play, .logic-scenario-workspace-detail { border-color:ButtonText; } }
  `;
}
