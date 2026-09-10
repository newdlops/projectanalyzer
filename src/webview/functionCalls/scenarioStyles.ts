/** Theme-native scenario controls and numbered call trace, with stacked narrow layouts. */
export function getFunctionCallScenarioStyles(): string {
  return /* css */ `
    .calls-relations[hidden], .calls-controls[hidden] { display:none; }
    .calls-view-switch { display:flex; gap:4px; flex-wrap:wrap; }
    .calls-view-switch button { min-height:36px; padding:7px 12px; border:1px solid var(--vscode-panel-border); border-radius:3px; color:var(--vscode-foreground); background:transparent; cursor:pointer; }
    .calls-view-switch button[aria-pressed="true"] { background:color-mix(in srgb,var(--calls-call) 14%,var(--vscode-editor-background)); border-color:var(--vscode-focusBorder); font-weight:600; }
    .calls-view-switch button:hover, .calls-order button:hover { background:var(--vscode-list-hoverBackground); }
    .calls-order { min-width:0; display:grid; gap:12px; }
    .calls-order-toolbar, .calls-order-presets { display:flex; gap:12px; flex-wrap:wrap; align-items:end; }
    .calls-order label { display:grid; gap:6px; min-width:0; font-size:12px; }
    .calls-order-parent { flex:1; max-width:680px; }
    .calls-order button { padding:6px 10px; min-height:34px; max-width:100%; border:1px solid var(--vscode-panel-border); border-radius:3px; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); cursor:pointer; overflow-wrap:anywhere; }
    .calls-order select, .calls-order input, .calls-order textarea { box-sizing:border-box; width:100%; min-width:0; max-width:100%; min-height:34px; padding:7px 9px; border:1px solid var(--vscode-input-border,var(--vscode-panel-border)); border-radius:3px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); font:inherit; }
    .calls-order select:focus-visible, .calls-order input:focus-visible, .calls-order textarea:focus-visible, .calls-order summary:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:2px; }
    .calls-order select:disabled { opacity:.6; }
    .calls-order-signature { margin:0; padding:10px 12px; border:1px solid color-mix(in srgb,var(--calls-call) 40%,var(--vscode-panel-border)); border-radius:3px; background:color-mix(in srgb,var(--calls-call) 7%,var(--vscode-editor-background)); white-space:pre-wrap; overflow-wrap:anywhere; }
    .calls-order code, .calls-order-signature, .calls-order textarea { font-family:var(--vscode-editor-font-family,monospace); font-size:12px; line-height:1.6; }
    .calls-order-note, .calls-order-empty { margin:0; color:var(--vscode-descriptionForeground); font-size:12px; line-height:1.6; overflow-wrap:anywhere; }
    .calls-order-presets label { flex:1; max-width:440px; }
    .calls-order-workspace { display:grid; grid-template-columns:minmax(240px,300px) minmax(0,1fr); border:1px solid var(--vscode-panel-border); min-width:0; }
    .calls-order-workspace h3 { font-size:13px; margin:0 0 14px; }
    .calls-order .calls-order-jump { display:none; }
    .calls-order-conditions, .calls-order-sequence { min-width:0; padding:16px; max-height:65vh; overflow:auto; scrollbar-width:thin; }
    .calls-order-conditions { background:var(--vscode-sideBar-background); border-right:1px solid var(--vscode-panel-border); }
    .calls-order-choice { margin-bottom:12px; padding:10px; border:1px solid var(--calls-border); border-radius:3px; background:var(--calls-tint); }
    .calls-order-choice[data-call-tone="pending"] { border-style:dashed; }
    .calls-order-choice > .calls-cue { padding:0; border:0; background:transparent; font-weight:600; }
    .calls-order-choice:last-child { margin-bottom:0; }
    .calls-order-choice code { white-space:pre-wrap; overflow-wrap:anywhere; }
    .calls-order-choice-caption { color:color-mix(in srgb,var(--vscode-foreground) 82%,var(--calls-tint)); font-size:11px; overflow-wrap:anywhere; }
    .calls-order-steps { position:relative; list-style:none; padding:0; margin:0; }
    .calls-order-steps::before { content:""; position:absolute; left:15px; top:12px; bottom:12px; width:1px; background:color-mix(in srgb,var(--vscode-foreground) 50%,var(--vscode-editor-background)); pointer-events:none; }
    .calls-order-step { position:relative; display:grid; grid-template-columns:32px minmax(0,1fr) auto; align-items:start; gap:12px; padding:12px 0; min-width:0; }
    .calls-order-step-call + .calls-order-step-call .calls-order-call { border-top:1px solid var(--vscode-panel-border); padding-top:8px; }
    .calls-order-number { box-sizing:border-box; display:grid; place-items:center; width:32px; height:32px; border:1px solid var(--calls-ink); border-radius:50%; color:var(--vscode-foreground); background:var(--calls-tint); font-size:13px; font-weight:600; font-variant-numeric:tabular-nums; }
    .calls-order-marker { display:grid; place-items:center; width:32px; min-height:30px; }
    .calls-order-marker .calls-glyph { font-size:22px; }
    .calls-order-call { min-width:0; display:grid; gap:6px; }
    .calls-order-call button { padding:0; border:0; background:transparent; color:var(--vscode-textLink-foreground); text-align:left; min-height:32px; }
    .calls-order-call code { font-weight:600; }
    .calls-order-call code, .calls-order-beat code { white-space:pre-wrap; overflow-wrap:anywhere; }
    .calls-order-call small { color:var(--vscode-descriptionForeground); line-height:1.5; overflow-wrap:anywhere; }
    .calls-order-guard-cues { display:flex; align-items:start; flex-wrap:wrap; gap:4px; }
    .calls-order-step:not(.calls-order-step-call) { grid-template-columns:32px minmax(0,1fr); padding:10px 0; margin:8px 0; border-top:1px solid var(--calls-border); border-bottom:1px solid var(--calls-border); background:var(--calls-tint); font-size:12px; }
    .calls-order-step-deferred, .calls-order-step-unknown { border-style:dashed; }
    .calls-order-beat { display:grid; gap:4px; min-width:0; padding-right:12px; }
    .calls-order .calls-order-decision-action { width:fit-content; min-height:28px; padding:0; border:0; background:transparent; color:var(--vscode-foreground); font-weight:600; text-align:left; }
    .calls-order .calls-order-decision-action:hover { text-decoration:underline; text-underline-offset:3px; }
    .calls-order-decision-edit { margin-left:12px; color:var(--vscode-textLink-foreground); font-weight:400; text-decoration:underline; text-underline-offset:3px; }
    .calls-order-result, .calls-order-feedback { display:flex; align-items:start; gap:8px; padding:12px; border:1px solid var(--calls-border); background:var(--calls-tint); font-size:13px; line-height:1.6; color:var(--vscode-foreground); overflow-wrap:anywhere; }
    .calls-order-result { font-weight:600; margin:16px 0 6px; }
    .calls-order-feedback { margin:0; }
    .calls-order-terminal { display:block; overflow-wrap:anywhere; white-space:pre-wrap; }
    .calls-order-draft { border-top:1px solid var(--vscode-panel-border); padding-top:12px; }
    .calls-order-draft summary { cursor:pointer; min-height:32px; }
    .calls-order-draft label { margin-bottom:12px; }
    .calls-order-draft textarea { resize:vertical; }
    @media(max-width:800px) { .calls-order-workspace { grid-template-columns:minmax(0,1fr); } .calls-order-conditions { border-right:0; border-bottom:1px solid var(--vscode-panel-border); max-height:none; } .calls-order-sequence { max-height:none; } .calls-order .calls-order-jump { display:block; margin:0 0 16px; } }
    @media(max-width:480px) { .calls-order-toolbar, .calls-order-presets { display:grid; grid-template-columns:minmax(0,1fr); } .calls-order-conditions, .calls-order-sequence { padding:12px; } .calls-order-step { gap:8px; grid-template-columns:32px minmax(0,1fr); } .calls-order-step-call > button { grid-column:2; justify-self:start; } .calls-color-key { gap:8px 12px; } }
    @media(pointer:coarse) { .calls-view-switch button, .calls-order button, .calls-order select, .calls-order input, .calls-order summary { min-height:44px; } }
    @media(forced-colors:active) { .calls-view-switch button[aria-pressed="true"] { outline:2px solid Highlight; } .calls-order-number { border-color:CanvasText; color:CanvasText; } }
    @media(forced-colors:active) { .calls-order-steps::before { background:CanvasText; } .calls-order-choice, .calls-order-result, .calls-order-feedback, .calls-order-signature { border-color:CanvasText; } }
  `;
}
