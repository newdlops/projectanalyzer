/** Existing VS Code tokens applied to a separate, pannable call graph and readable relationship list. */
export function getFunctionCallsStyles(): string {
  return /* css */ `
    .visualizer-modes { display:flex; flex-wrap:wrap; gap:4px; margin:12px 0; border-bottom:1px solid var(--vscode-panel-border); }
    .visualizer-modes button { min-height:36px; padding:7px 13px; border:0; border-bottom:2px solid transparent; background:transparent; color:var(--vscode-descriptionForeground); cursor:pointer; }
    .visualizer-modes button[aria-pressed="true"] { color:var(--vscode-foreground); border-bottom-color:var(--vscode-focusBorder); background:var(--vscode-list-hoverBackground); font-weight:600; }
    .calls-mode-active #flow-steps, .calls-mode-active #flow-gaps-section, .calls-mode-active #function-origins-section, .calls-mode-active #function-navigation, .calls-mode-active #status { display:none; }
    .function-calls[hidden] { display:none; }
    .function-calls { min-width:0; display:grid; gap:12px; }
    .calls-header { display:flex; flex-wrap:wrap; align-items:start; gap:12px; justify-content:space-between; }
    .calls-header h2 { margin:0 0 6px; font-size:1.1rem; }
    .calls-header p { margin:0; max-width:78ch; line-height:1.55; color:var(--vscode-descriptionForeground); }
    .calls-controls { display:flex; flex-wrap:wrap; align-items:center; gap:6px; font-variant-numeric:tabular-nums; }
    .visualizer-modes button, .function-calls button { touch-action:manipulation; }
    .calls-controls button, .calls-detail button, .calls-list button, .calls-status button { min-height:32px; padding:5px 9px; max-width:100%; overflow-wrap:anywhere; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); border:1px solid var(--vscode-panel-border); border-radius:3px; cursor:pointer; }
    .function-calls button:hover:not(:disabled) { border-color:var(--vscode-focusBorder); }
    .function-calls button:disabled { opacity:.6; cursor:default; }
    .function-calls button:focus-visible, .calls-viewport:focus-visible, .calls-list summary:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:2px; }
    .calls-status { min-height:1.5em; margin:0; color:var(--vscode-descriptionForeground); line-height:1.5; overflow-wrap:anywhere; }
    .calls-workspace { display:grid; grid-template-columns:minmax(0,1fr) minmax(260px,320px); border:1px solid var(--vscode-panel-border); min-width:0; }
    .calls-viewport { position:relative; min-width:0; height:clamp(420px,65vh,760px); overflow:auto; overscroll-behavior:contain; background:var(--vscode-editor-background); scrollbar-width:thin; cursor:grab; }
    .calls-viewport.dragging { cursor:grabbing; user-select:none; }
    .calls-sizer { position:relative; min-width:100%; min-height:100%; }
    .calls-surface { position:relative; transform-origin:0 0; }
    .calls-surface > svg { position:absolute; inset:0; overflow:visible; pointer-events:none; }
    .calls-edge-path { stroke:var(--vscode-descriptionForeground); stroke-width:1.8; fill:none; }
    .calls-edge-path.uncertain { stroke-dasharray:5 4; }
    .calls-edge-path.selected { stroke:var(--vscode-textLink-foreground); stroke-width:3; }
    .calls-node { position:absolute; display:flex; flex-direction:column; align-items:start; justify-content:center; gap:7px; width:204px; height:80px; padding:10px 12px; border:1px solid var(--vscode-panel-border); border-radius:5px; background:var(--vscode-sideBar-background); color:var(--vscode-foreground); text-align:left; cursor:pointer; }
    .calls-node strong { display:block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:600 13px var(--vscode-editor-font-family,monospace); }
    .calls-node small { font-size:11px; color:var(--vscode-descriptionForeground); }
    .calls-node.root { border-left:3px solid var(--vscode-textLink-foreground); }
    .calls-node.unresolved { border-style:dashed; }
    .calls-node[aria-pressed="true"] { border-color:var(--vscode-focusBorder); box-shadow:0 0 0 1px var(--vscode-focusBorder); }
    .calls-edge-label { position:absolute; width:136px; min-height:28px; max-height:58px; padding:4px 6px; border:1px solid var(--vscode-panel-border); border-radius:3px; background:var(--vscode-editor-background); color:var(--vscode-foreground); font-size:11px; line-height:1.35; overflow:hidden; cursor:pointer; }
    .calls-edge-label[aria-pressed="true"] { border-color:var(--vscode-focusBorder); color:var(--vscode-textLink-foreground); }
    .calls-edge-label span { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
    .calls-detail { min-width:0; padding:16px; border-left:1px solid var(--vscode-panel-border); max-height:clamp(420px,65vh,760px); overflow:auto; background:var(--vscode-sideBar-background); }
    .calls-detail h3 { margin:0 0 8px; font:600 14px var(--vscode-editor-font-family,monospace); overflow-wrap:anywhere; }
    .calls-detail h4 { font-size:12px; margin:20px 0 8px; }
    .calls-detail p { margin:6px 0; line-height:1.5; overflow-wrap:anywhere; }
    .calls-detail .calls-muted, .calls-legend { color:var(--vscode-descriptionForeground); font-size:12px; }
    .calls-actions { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; }
    .calls-site { padding:12px 0; border-top:1px solid var(--vscode-panel-border); }
    .calls-site code { font-family:var(--vscode-editor-font-family,monospace); font-size:12px; overflow-wrap:anywhere; white-space:pre-wrap; }
    .calls-site ul { margin:8px 0; padding-left:18px; line-height:1.5; }
    .calls-site li { overflow-wrap:anywhere; }
    .calls-list { min-width:0; border-top:1px solid var(--vscode-panel-border); padding-top:12px; }
    .calls-list summary { cursor:pointer; min-height:32px; line-height:1.5; }
    .calls-list > div { display:grid; gap:1px; margin-top:8px; }
    .calls-list button { display:grid; gap:4px; width:100%; padding:10px 12px; text-align:left; border-radius:0; background:transparent; color:var(--vscode-foreground); content-visibility:auto; contain-intrinsic-size:auto 65px; }
    .calls-list button[aria-pressed="true"] { border-color:var(--vscode-focusBorder); }
    .calls-list small { color:var(--vscode-descriptionForeground); line-height:1.5; }
    .calls-legend { margin:0; line-height:1.5; overflow-wrap:anywhere; }
    @media(max-width:1000px) { .calls-workspace { grid-template-columns:minmax(0,1fr); } .calls-detail { border-left:0; border-top:1px solid var(--vscode-panel-border); max-height:none; } }
    @media(max-width:480px) { .calls-viewport { height:400px; } .calls-header { display:grid; } .calls-detail { padding:12px; } }
    @media(pointer:coarse) { .visualizer-modes button, .function-calls button, .calls-list summary { min-height:44px; } }
    @media(forced-colors:active) { .calls-node[aria-pressed="true"], .calls-edge-label[aria-pressed="true"] { outline:2px solid Highlight; } .calls-edge-path { stroke:CanvasText; } .calls-edge-path.selected { stroke:Highlight; } }
  `;
}
