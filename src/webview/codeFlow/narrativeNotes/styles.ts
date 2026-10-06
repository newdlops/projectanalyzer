/** Graph annotations inherit native editor tokens and the existing compact reading rhythm. */
export function getNarrativeGraphNoteStyles(): string {
  return /* css */ `
    .logic-narrative-note-layer { position:absolute; inset:0; z-index:7; pointer-events:none; }
    .logic-narrative-note-layer[hidden] { display:none; }
    .logic-narrative-note-connections { position:absolute; inset:0; overflow:visible; pointer-events:none; }
    .logic-narrative-note-reference { fill:none; stroke:var(--vscode-descriptionForeground); stroke-width:1; stroke-dasharray:3 4; vector-effect:non-scaling-stroke; }
    .logic-narrative-note-reference.selected { stroke:var(--vscode-focusBorder); stroke-width:1.5; }
    .logic-narrative-note-marker { position:absolute; pointer-events:auto; padding:2px 4px; min-width:36px; min-height:26px; border:1px solid var(--vscode-panel-border); border-radius:3px; background:var(--vscode-editor-background); color:var(--vscode-textLink-foreground); font:inherit; font-size:var(--logic-font-tiny); cursor:pointer; }
    .logic-narrative-graph-note { box-sizing:border-box; position:absolute; width:280px; min-height:128px; padding:8px 12px; border:1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border)); border-radius:4px; background:var(--vscode-editorHoverWidget-background, var(--vscode-editor-background)); color:var(--vscode-foreground); pointer-events:auto; font-size:var(--logic-font-small); line-height:1.5; overflow-wrap:anywhere; }
    .logic-narrative-graph-note.selected { outline:1px solid var(--vscode-focusBorder); outline-offset:2px; }
    .logic-narrative-graph-note p { margin:4px 0; }
    .logic-narrative-graph-note h4 { margin:0; font-size:var(--logic-font-small); font-weight:600; }
    .logic-narrative-note-basis { color:var(--vscode-descriptionForeground); font-size:var(--logic-font-tiny); }
    .logic-narrative-note-preview { overflow-wrap:anywhere; }
    .logic-narrative-graph-note summary { cursor:pointer; color:var(--vscode-textLink-foreground); }
    .logic-narrative-note-body { max-height:280px; overflow:auto; overscroll-behavior:contain; touch-action:pan-y; padding-top:8px; }
    .logic-narrative-note-body section + section { margin-top:12px; padding-top:8px; border-top:1px solid var(--vscode-panel-border); }
    .logic-narrative-note-body dl { display:grid; grid-template-columns:minmax(0,1fr); gap:4px; margin:8px 0; }
    .logic-narrative-note-body dt { font-family:var(--vscode-editor-font-family); }
    .logic-narrative-note-body dd { margin:0; font-family:var(--vscode-editor-font-family); white-space:pre-wrap; }
    .logic-narrative-note-marker:focus-visible, .logic-narrative-graph-note summary:focus-visible, .logic-narrative-note-body:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:2px; }
    .logic-narrative-note-marker:hover, .logic-narrative-note-toggle:hover { background:var(--vscode-toolbar-hoverBackground); }
    .logic-narrative-note-toggle[aria-pressed="true"] { border-color:var(--vscode-focusBorder); }
    @media(pointer:coarse) { .logic-narrative-note-marker, .logic-narrative-note-toggle { min-height:44px; min-width:44px; } .logic-narrative-graph-note summary { min-height:44px; } .logic-narrative-graph-note { min-height:176px; } }
    @media(forced-colors:active) { .logic-narrative-graph-note, .logic-narrative-note-marker { background:Canvas; color:CanvasText; border-color:CanvasText; } .logic-narrative-note-reference { stroke:CanvasText; } .logic-narrative-graph-note.selected { outline-color:Highlight; } }
  `;
}
