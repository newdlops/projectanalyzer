/** Existing VS Code tokens applied to a separate, pannable call graph and readable relationship list. */
import { getFunctionCallScenarioStyles } from "./scenarioStyles";
export function getFunctionCallsStyles(): string {
  return /* css */ `
    .function-calls {
      --calls-call:var(--vscode-charts-blue,var(--vscode-textLink-foreground));
      --calls-condition:var(--vscode-charts-purple,var(--vscode-textLink-foreground));
      --calls-loop:var(--vscode-charts-orange,var(--vscode-editorWarning-foreground));
      --calls-return:var(--vscode-charts-green,var(--vscode-textLink-foreground));
      --calls-exception:var(--vscode-editorError-foreground,var(--vscode-foreground));
      --calls-pending:var(--vscode-editorWarning-foreground,var(--vscode-foreground));
      --calls-deferred:var(--vscode-descriptionForeground);
    }
    .function-calls [data-call-tone] {
      --calls-accent:var(--calls-call);
      --calls-ink:color-mix(in srgb,var(--calls-accent) 60%,var(--vscode-foreground));
      --calls-tint:color-mix(in srgb,var(--calls-accent) 9%,var(--vscode-editor-background));
      --calls-border:color-mix(in srgb,var(--calls-accent) 48%,var(--vscode-panel-border));
    }
    .function-calls [data-call-tone="condition"] { --calls-accent:var(--calls-condition); }
    .function-calls [data-call-tone="loop"] { --calls-accent:var(--calls-loop); }
    .function-calls [data-call-tone="return"] { --calls-accent:var(--calls-return); }
    .function-calls [data-call-tone="exception"] { --calls-accent:var(--calls-exception); }
    .function-calls [data-call-tone="pending"] { --calls-accent:var(--calls-pending); }
    .function-calls [data-call-tone="deferred"] { --calls-accent:var(--calls-deferred); }
    .calls-glyph { display:inline-grid; place-items:center; flex:none; width:18px; line-height:1.2; color:var(--calls-ink,var(--vscode-foreground)); font-size:16px; font-weight:600; }
    .calls-cue { display:inline-flex; align-items:start; gap:4px; width:fit-content; max-width:100%; box-sizing:border-box; padding:3px 6px; border:1px solid var(--calls-border); border-radius:3px; background:var(--calls-tint); color:var(--vscode-foreground); font-size:11px; line-height:1.5; }
    .calls-cue > span:last-child { min-width:0; overflow-wrap:anywhere; }
    .calls-color-key { display:flex; flex-wrap:wrap; align-items:center; gap:6px 16px; list-style:none; padding:0; margin:0; }
    .calls-color-key .calls-cue { border:0; padding:0; background:transparent; }
    .calls-relations > .calls-color-key { margin-bottom:10px; }
    ${getFunctionCallScenarioStyles()}
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
    .calls-edge-path { stroke:var(--calls-ink); stroke-width:2; fill:none; }
    .calls-edge-path.uncertain { stroke-dasharray:5 4; }
    .calls-edge-path.selected { stroke-width:3.5; }
    .calls-node { position:absolute; display:flex; flex-direction:column; align-items:start; justify-content:center; gap:7px; width:204px; height:80px; padding:10px 12px; border:1px solid var(--vscode-panel-border); border-radius:5px; background:var(--vscode-sideBar-background); color:var(--vscode-foreground); text-align:left; cursor:pointer; }
    .calls-node strong { display:block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:600 13px var(--vscode-editor-font-family,monospace); }
    .calls-node small { font-size:11px; color:var(--vscode-descriptionForeground); }
    .calls-node { border-color:color-mix(in srgb,var(--calls-call) 45%,var(--vscode-panel-border)); background:color-mix(in srgb,var(--calls-call) 6%,var(--vscode-editor-background)); }
    .calls-node.root { border-color:var(--vscode-textLink-foreground); background:color-mix(in srgb,var(--calls-call) 14%,var(--vscode-editor-background)); }
    .calls-node.unresolved { border-style:dashed; }
    .calls-node[aria-pressed="true"] { border-color:var(--vscode-focusBorder); box-shadow:0 0 0 1px var(--vscode-focusBorder); }
    .calls-edge-label { position:absolute; width:136px; min-height:28px; max-height:58px; padding:4px 6px; border:1px solid var(--vscode-panel-border); border-radius:3px; background:var(--vscode-editor-background); color:var(--vscode-foreground); font-size:11px; line-height:1.35; overflow:hidden; cursor:pointer; }
    .calls-edge-label { border-color:var(--calls-border); background:var(--calls-tint); }
    .calls-edge-label[aria-pressed="true"] { border-color:var(--vscode-focusBorder); outline:1px solid var(--vscode-focusBorder); outline-offset:1px; }
    .calls-edge-label span { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
    .calls-edge-label .calls-edge-kind { display:flex; align-items:center; justify-content:center; gap:3px; font-weight:600; }
    .calls-edge-label .calls-glyph { display:inline-grid; width:14px; font-size:14px; }
    .calls-detail { min-width:0; padding:16px; border-left:1px solid var(--vscode-panel-border); max-height:clamp(420px,65vh,760px); overflow:auto; background:var(--vscode-sideBar-background); }
    .calls-detail h3 { margin:0 0 8px; font:600 14px var(--vscode-editor-font-family,monospace); overflow-wrap:anywhere; }
    .calls-detail h4 { font-size:12px; margin:20px 0 8px; }
    .calls-detail p { margin:6px 0; line-height:1.5; overflow-wrap:anywhere; }
    .calls-detail .calls-muted, .calls-legend { color:var(--vscode-descriptionForeground); font-size:12px; }
    .calls-actions { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; }
    .calls-site { padding:12px 0; border-top:1px solid var(--vscode-panel-border); }
    .calls-site > .calls-cue { margin-bottom:6px; }
    .calls-site > code { display:block; }
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
    .calls-reading { min-width:0; padding:12px 0; border-top:1px solid var(--vscode-panel-border); }
    .calls-reading [hidden] { display:none !important; }
    .calls-reading h3 { margin:0 0 8px; font-size:14px; }
    .calls-reading p { margin:8px 0; line-height:1.6; overflow-wrap:anywhere; max-width:75ch; }
    .calls-reading-help,.calls-reading-inference,.calls-reading-status { color:var(--vscode-descriptionForeground); font-size:12px; }
    .calls-reading-summary { font-weight:600; }
    .calls-reading-selector { display:grid; gap:6px; margin:12px 0; min-width:0; }
    .calls-reading-selector select { width:100%; min-width:0; max-width:100%; min-height:32px; padding:6px 8px; border:1px solid var(--vscode-dropdown-border,var(--vscode-panel-border)); background:var(--vscode-dropdown-background); color:var(--vscode-dropdown-foreground); font:inherit; }
    .calls-reading-code { white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.6 var(--vscode-editor-font-family,monospace); background:var(--vscode-textCodeBlock-background); padding:8px; }
    .calls-reading-facts { display:grid; grid-template-columns:minmax(100px,150px) minmax(0,1fr); gap:8px 12px; line-height:1.6; }
    .calls-reading-facts dt { font-weight:600; overflow-wrap:anywhere; }
    .calls-reading-facts dd { margin:0; min-width:0; overflow-wrap:anywhere; }
    .calls-reading-pager { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:12px; font-variant-numeric:tabular-nums; }
    .calls-reading-limitations { line-height:1.6; padding-left:18px; overflow-wrap:anywhere; }
    .calls-reading :is(button,select):focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:2px; }
    @media(max-width:560px) { .calls-reading-facts { grid-template-columns:minmax(0,1fr); gap:4px; } .calls-reading-facts dd { margin-bottom:8px; } }
    @media(max-width:1000px) { .calls-workspace { grid-template-columns:minmax(0,1fr); } .calls-detail { border-left:0; border-top:1px solid var(--vscode-panel-border); max-height:none; } }
    @media(max-width:480px) { .calls-viewport { height:400px; } .calls-header { display:grid; } .calls-detail { padding:12px; } }
    @media(pointer:coarse) { .visualizer-modes button, .function-calls button, .calls-list summary { min-height:44px; } }
    @media(forced-colors:active) { .calls-node[aria-pressed="true"], .calls-edge-label[aria-pressed="true"] { outline:2px solid Highlight; } .calls-edge-path { stroke:CanvasText; } .calls-edge-path.selected { stroke:Highlight; } }
    @media(forced-colors:active) { .function-calls [data-call-tone] { --calls-ink:CanvasText; --calls-border:CanvasText; --calls-tint:Canvas; } .calls-node { border-color:CanvasText; } }
  `;
}
