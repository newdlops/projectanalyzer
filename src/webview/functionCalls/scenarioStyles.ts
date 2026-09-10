/** Theme-native scenario controls and numbered call trace, with stacked narrow layouts. */
export function getFunctionCallScenarioStyles(): string {
  return /* css */ `
    .calls-relations[hidden], .calls-controls[hidden] { display:none; }
    .calls-view-switch { display:flex; gap:4px; flex-wrap:wrap; }
    .calls-view-switch button { min-height:36px; padding:7px 12px; border:1px solid var(--vscode-panel-border); border-radius:3px; color:var(--vscode-foreground); background:transparent; cursor:pointer; }
    .calls-view-switch button[aria-pressed="true"] { background:var(--vscode-list-hoverBackground); border-color:var(--vscode-focusBorder); font-weight:600; }
    .calls-view-switch button:hover, .calls-order button:hover { background:var(--vscode-list-hoverBackground); }
    .calls-order { min-width:0; display:grid; gap:12px; }
    .calls-order-toolbar, .calls-order-presets { display:flex; gap:12px; flex-wrap:wrap; align-items:end; }
    .calls-order label { display:grid; gap:6px; min-width:0; font-size:12px; }
    .calls-order-parent { flex:1; max-width:680px; }
    .calls-order button { padding:6px 10px; min-height:34px; max-width:100%; border:1px solid var(--vscode-panel-border); border-radius:3px; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); cursor:pointer; overflow-wrap:anywhere; }
    .calls-order select, .calls-order input, .calls-order textarea { box-sizing:border-box; width:100%; min-width:0; max-width:100%; min-height:34px; padding:7px 9px; border:1px solid var(--vscode-input-border,var(--vscode-panel-border)); border-radius:3px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); font:inherit; }
    .calls-order select:focus-visible, .calls-order input:focus-visible, .calls-order textarea:focus-visible, .calls-order summary:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:2px; }
    .calls-order select:disabled { opacity:.6; }
    .calls-order-signature { margin:0; padding:10px 12px; border-left:2px solid var(--vscode-textLink-foreground); background:var(--vscode-textCodeBlock-background); white-space:pre-wrap; overflow-wrap:anywhere; }
    .calls-order code, .calls-order-signature, .calls-order textarea { font-family:var(--vscode-editor-font-family,monospace); font-size:12px; line-height:1.6; }
    .calls-order-note, .calls-order-empty { margin:0; color:var(--vscode-descriptionForeground); font-size:12px; line-height:1.6; overflow-wrap:anywhere; }
    .calls-order-presets label { flex:1; max-width:440px; }
    .calls-order-workspace { display:grid; grid-template-columns:minmax(220px,280px) minmax(0,1fr); border:1px solid var(--vscode-panel-border); min-width:0; }
    .calls-order-workspace h3 { font-size:13px; margin:0 0 14px; }
    .calls-order .calls-order-jump { display:none; }
    .calls-order-conditions, .calls-order-sequence { min-width:0; padding:16px; max-height:65vh; overflow:auto; scrollbar-width:thin; }
    .calls-order-conditions { background:var(--vscode-sideBar-background); border-right:1px solid var(--vscode-panel-border); }
    .calls-order-choice { margin-bottom:16px; }
    .calls-order-choice:last-child { margin-bottom:0; }
    .calls-order-choice code { white-space:pre-wrap; overflow-wrap:anywhere; }
    .calls-order-choice-caption { color:var(--vscode-descriptionForeground); font-size:11px; overflow-wrap:anywhere; }
    .calls-order-steps { list-style:none; padding:0; margin:0; }
    .calls-order-step { padding:10px 0; border-bottom:1px solid var(--vscode-panel-border); min-width:0; }
    .calls-order-step-call { display:flex; align-items:start; gap:12px; }
    .calls-order-number { display:grid; place-items:center; flex:none; width:26px; height:26px; border:1px solid var(--vscode-textLink-foreground); border-radius:50%; color:var(--vscode-textLink-foreground); font-size:12px; font-variant-numeric:tabular-nums; }
    .calls-order-call { min-width:0; flex:1; display:grid; gap:4px; }
    .calls-order-call button { padding:0; border:0; background:transparent; color:var(--vscode-textLink-foreground); text-align:left; min-height:26px; }
    .calls-order-call code, .calls-order-step > code { white-space:pre-wrap; overflow-wrap:anywhere; }
    .calls-order-call small { color:var(--vscode-descriptionForeground); line-height:1.5; overflow-wrap:anywhere; }
    .calls-order-step-loop, .calls-order-step-loopEnd, .calls-order-step-continue, .calls-order-step-break, .calls-order-step-deferred, .calls-order-step-unknown { display:grid; gap:4px; padding:10px 12px; background:var(--vscode-list-hoverBackground); font-size:12px; }
    .calls-order-result { font-size:13px; font-weight:600; margin:16px 0 6px; }
    .calls-order-terminal { display:block; overflow-wrap:anywhere; white-space:pre-wrap; }
    .calls-order-draft { border-top:1px solid var(--vscode-panel-border); padding-top:12px; }
    .calls-order-draft summary { cursor:pointer; min-height:32px; }
    .calls-order-draft label { margin-bottom:12px; }
    .calls-order-draft textarea { resize:vertical; }
    @media(max-width:800px) { .calls-order-workspace { grid-template-columns:minmax(0,1fr); } .calls-order-conditions { border-right:0; border-bottom:1px solid var(--vscode-panel-border); max-height:none; } .calls-order-sequence { max-height:none; } .calls-order .calls-order-jump { display:block; margin:0 0 16px; } }
    @media(max-width:480px) { .calls-order-toolbar, .calls-order-presets { display:grid; grid-template-columns:minmax(0,1fr); } .calls-order-conditions, .calls-order-sequence { padding:12px; } .calls-order-step-call { gap:8px; flex-wrap:wrap; } .calls-order-call { min-width:calc(100% - 40px); } .calls-order-step-call > button { margin-left:34px; } }
    @media(pointer:coarse) { .calls-view-switch button, .calls-order button, .calls-order select, .calls-order input, .calls-order summary { min-height:44px; } }
    @media(forced-colors:active) { .calls-view-switch button[aria-pressed="true"] { outline:2px solid Highlight; } .calls-order-number { border-color:CanvasText; color:CanvasText; } }
  `;
}
