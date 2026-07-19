/** Theme-aware styles for the single-canvas project Module Flow editor. */

/** Returns graph chrome, variable-size cards, detail rail, and motion rules. */
export function getModuleVisualizerStyles(): string {
  return /* css */ `
    :root {
      color-scheme: light dark;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }

    * { box-sizing: border-box; }

    html, body { width: 100%; height: 100%; }

    body {
      min-width: 480px;
      margin: 0;
      background: var(--vscode-editor-background);
    }

    button { font: inherit; }

    .module-flow-shell {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      width: 100%;
      height: 100%;
    }

    .module-flow-header {
      display: grid;
      gap: 5px;
      padding: 17px 22px 13px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: color-mix(in srgb, var(--vscode-editor-background) 96%, var(--vscode-textLink-foreground));
    }

    .module-flow-eyebrow {
      color: var(--vscode-textLink-foreground);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.13em;
    }

    .module-flow-heading-row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px 20px;
    }

    .module-flow-heading-row h1 {
      margin: 0;
      font-size: clamp(22px, 2.6vw, 32px);
      line-height: 1.15;
    }

    .module-flow-summary,
    .module-flow-semantics,
    .module-flow-status {
      color: var(--vscode-descriptionForeground);
      line-height: 1.45;
    }

    .module-flow-summary { font-size: 12px; font-weight: 650; }

    .module-flow-semantics {
      font-size: 11px;
    }

    .module-flow-toolbar {
      display: flex;
      min-height: 43px;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editorGroupHeader-tabsBackground);
    }

    .mode-button,
    .toolbar-button,
    .zoom-button,
    .zoom-level,
    .detail-action {
      min-height: 28px;
      padding: 4px 10px;
      color: var(--vscode-foreground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 5px;
      cursor: pointer;
    }

    .mode-button:hover,
    .toolbar-button:hover,
    .zoom-button:hover,
    .zoom-level:hover,
    .detail-action:hover {
      border-color: var(--vscode-focusBorder);
    }

    .zoom-button:disabled {
      opacity: 0.42;
      cursor: default;
    }

    .mode-button.active {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    .toolbar-spacer { flex: 1 1 20px; }

    .zoom-controls {
      display: inline-grid;
      grid-template-columns: 30px minmax(54px, auto) 30px;
      align-items: stretch;
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 6px;
      overflow: hidden;
    }

    .zoom-button,
    .zoom-level {
      min-height: 28px;
      padding: 3px 7px;
      color: var(--vscode-foreground);
      background: var(--vscode-button-secondaryBackground);
      border: 0;
      border-right: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 0;
      cursor: pointer;
    }

    .zoom-button:last-child { border-right: 0; }
    .zoom-button { font-size: 16px; line-height: 1; }
    .zoom-level { font-size: 10px; font-variant-numeric: tabular-nums; }

    .toolbar-check {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .module-flow-workspace {
      display: grid;
      min-height: 0;
      grid-template-columns: minmax(0, 1fr) minmax(250px, 320px);
    }

    .module-flow-viewport {
      position: relative;
      min-width: 0;
      min-height: 0;
      overflow: auto;
      background-color: var(--vscode-editor-background);
      background-image:
        linear-gradient(color-mix(in srgb, var(--vscode-panel-border) 22%, transparent) 1px, transparent 1px),
        linear-gradient(90deg, color-mix(in srgb, var(--vscode-panel-border) 22%, transparent) 1px, transparent 1px);
      background-size: 24px 24px;
      scrollbar-width: thin;
      cursor: grab;
      overscroll-behavior: contain;
    }

    .module-flow-viewport.panning {
      cursor: grabbing;
      user-select: none;
    }

    .module-flow-viewport:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .module-flow-stage {
      position: relative;
      min-width: 100%;
      min-height: 100%;
    }

    .module-flow-scene {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
    }

    .module-flow-edges,
    .module-flow-nodes,
    .module-flow-cycles {
      position: absolute;
      inset: 0;
    }

    .module-flow-edges { z-index: 2; overflow: visible; pointer-events: none; }
    .module-flow-cycles { z-index: 1; pointer-events: none; }
    .module-flow-nodes { z-index: 3; pointer-events: none; }

    .cycle-group {
      position: absolute;
      padding: 8px;
      color: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 4%, transparent);
      border: 1px dashed color-mix(in srgb, var(--vscode-textLink-foreground) 45%, var(--vscode-panel-border));
      border-radius: 12px;
      font-size: 10px;
    }

    .module-card {
      --module-depth-hue: calc(205 + var(--module-depth, 0) * 13);
      position: absolute;
      display: grid;
      align-content: start;
      gap: 7px;
      padding: 12px 13px;
      color: var(--vscode-foreground);
      background:
        linear-gradient(
          145deg,
          color-mix(in srgb, hsl(var(--module-depth-hue) 70% 52%) 10%, var(--vscode-editorWidget-background)),
          var(--vscode-editorWidget-background)
        );
      border: 1px solid color-mix(in srgb, hsl(var(--module-depth-hue) 70% 52%) 55%, var(--vscode-panel-border));
      border-radius: 9px;
      box-shadow: 0 5px 18px color-mix(in srgb, #000 15%, transparent);
      text-align: left;
      pointer-events: auto;
      cursor: pointer;
      contain: layout style paint;
      content-visibility: auto;
      contain-intrinsic-size: 280px 140px;
    }

    .module-flow-viewport.overview .module-card { box-shadow: none; }

    .module-card.function {
      background: color-mix(in srgb, var(--vscode-symbolIcon-functionForeground) 9%, var(--vscode-editorWidget-background));
      border-color: color-mix(in srgb, var(--vscode-symbolIcon-functionForeground) 55%, var(--vscode-panel-border));
    }

    .module-card.external {
      border-style: dashed;
      background: color-mix(in srgb, var(--vscode-descriptionForeground) 7%, var(--vscode-editorWidget-background));
    }

    .module-card.selected {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 1px var(--vscode-focusBorder), 0 8px 24px color-mix(in srgb, #000 18%, transparent);
    }

    .module-card.loading { cursor: wait; }

    .module-card.entering {
      animation: module-node-enter 260ms cubic-bezier(.2, .85, .25, 1) both;
    }

    .module-card-kind {
      color: var(--vscode-descriptionForeground);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .module-card-title {
      font-size: 13px;
      font-weight: 750;
      line-height: 1.32;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .module-card-detail,
    .module-card-location,
    .module-card-metric {
      font-size: 10px;
      line-height: 1.38;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .module-card-detail,
    .module-card-location { color: var(--vscode-descriptionForeground); }

    .module-card-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .module-badge {
      padding: 2px 5px;
      color: var(--vscode-descriptionForeground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 999px;
      font-size: 8px;
      font-weight: 700;
    }

    .module-card-hint {
      color: var(--vscode-textLink-foreground);
      font-size: 9px;
      font-weight: 650;
    }

    .module-edge {
      fill: none;
      stroke: color-mix(in srgb, var(--vscode-descriptionForeground) 68%, transparent);
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
      pointer-events: stroke;
      cursor: pointer;
    }

    .module-edge.aggregate { stroke: var(--vscode-textLink-foreground); stroke-width: 1.8; }
    .module-edge.concreteCall { stroke: var(--vscode-symbolIcon-functionForeground); }
    .module-edge.contains { stroke-dasharray: 4 4; opacity: 0.62; }
    .module-edge.selected { stroke: var(--vscode-focusBorder); stroke-width: 3; }
    .module-edge.entering { animation: module-edge-enter 260ms ease-out both; }

    .module-edge-hit {
      fill: none;
      stroke: transparent;
      stroke-width: 12;
      pointer-events: stroke;
      cursor: pointer;
      vector-effect: non-scaling-stroke;
    }

    .edge-label {
      fill: var(--vscode-descriptionForeground);
      font-family: var(--vscode-font-family);
      font-size: 9px;
      paint-order: stroke;
      stroke: var(--vscode-editor-background);
      stroke-width: 4px;
      stroke-linejoin: round;
      pointer-events: none;
    }

    .module-flow-detail {
      min-width: 0;
      overflow: auto;
      padding: 15px;
      border-left: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      scrollbar-width: thin;
    }

    .detail-empty,
    .detail-section,
    .detail-row {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.48;
      overflow-wrap: anywhere;
    }

    .detail-title {
      margin: 0 0 6px;
      color: var(--vscode-foreground);
      font-size: 16px;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }

    .detail-section {
      display: grid;
      gap: 6px;
      margin-top: 15px;
      padding-top: 12px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .detail-section h3 { margin: 0; color: var(--vscode-foreground); font-size: 11px; }
    .detail-row { padding: 6px 7px; background: color-mix(in srgb, var(--vscode-editor-background) 58%, transparent); border-radius: 5px; }
    .detail-action { width: 100%; margin-top: 5px; text-align: left; }

    .module-flow-status {
      position: absolute;
      z-index: 8;
      top: 12px;
      left: 12px;
      max-width: min(460px, calc(100% - 24px));
      padding: 7px 10px;
      background: color-mix(in srgb, var(--vscode-editorWidget-background) 94%, transparent);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
      box-shadow: 0 4px 14px color-mix(in srgb, #000 15%, transparent);
      font-size: 11px;
    }

    .module-flow-status:empty { display: none; }

    .visually-hidden {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: -1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
    }

    button:focus-visible,
    .module-edge:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    @keyframes module-node-enter {
      from { opacity: 0; transform: translateY(14px) scale(.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes module-edge-enter {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @media (max-width: 760px) {
      .module-flow-workspace { grid-template-columns: minmax(0, 1fr); }
      .module-flow-detail { display: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      .module-card.entering,
      .module-edge.entering { animation: none; }
    }
  `;
}
