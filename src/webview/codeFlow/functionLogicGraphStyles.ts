/** Theme-aware styles for the bounded function-local control-flow graph. */

/** Returns CSS for graph nodes, routed edges, lanes, and selection evidence. */
export function getFunctionLogicGraphStyles(): string {
  return /* css */ `
    .logic-signature {
      display: grid;
      gap: 4px;
      min-width: 0;
      padding: 8px;
      background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
    }

    .logic-signature > span {
      color: var(--vscode-descriptionForeground);
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.08em;
    }

    .logic-signature code {
      min-width: 0;
      color: var(--vscode-textPreformat-foreground, var(--vscode-foreground));
      font-family: var(--vscode-editor-font-family);
      font-size: 9px;
      line-height: 1.45;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .logic-understanding {
      display: grid;
      gap: 8px;
      min-width: 0;
      padding: 10px;
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 5%, var(--vscode-editor-background));
      border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 26%, var(--vscode-panel-border));
      border-radius: 7px;
    }

    .logic-understanding-header {
      display: grid;
      gap: 2px;
    }

    .logic-understanding-header > span {
      color: var(--vscode-textLink-foreground);
      font-size: 8px;
      font-weight: 800;
      letter-spacing: 0.08em;
    }

    .logic-understanding-header > strong {
      font-size: 11px;
    }

    .logic-understanding-cards {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 5px;
    }

    .logic-understanding-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: start;
      gap: 6px;
      min-width: 0;
      padding: 7px;
      background: color-mix(in srgb, var(--vscode-editor-background) 92%, transparent);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
    }

    .logic-understanding-number {
      display: grid;
      width: 19px;
      height: 19px;
      place-items: center;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border-radius: 50%;
      font-size: 8px;
      font-weight: 800;
    }

    .logic-understanding-card strong {
      font-size: 9px;
    }

    .logic-understanding-card p {
      margin: 2px 0 0;
      color: var(--vscode-descriptionForeground);
      font-size: 8px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .logic-callees {
      display: grid;
      gap: 7px;
      min-width: 0;
      padding: 9px;
      background: color-mix(in srgb, var(--vscode-charts-green) 5%, var(--vscode-editor-background));
      border: 1px solid color-mix(in srgb, var(--vscode-charts-green) 30%, var(--vscode-panel-border));
      border-radius: 7px;
    }

    .logic-callees-header {
      display: flex;
      min-width: 0;
      align-items: start;
      justify-content: space-between;
      gap: 8px;
    }

    .logic-callees-header strong { font-size: 10px; }

    .logic-callees-header p {
      margin: 2px 0 0;
      color: var(--vscode-descriptionForeground);
      font-size: 8px;
      line-height: 1.4;
    }

    .logic-callee-list,
    .logic-selection-callees {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .logic-callee-button {
      display: grid;
      gap: 2px;
      min-width: 0;
      padding: 6px 8px;
      color: var(--vscode-foreground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 4px;
      text-align: left;
      cursor: pointer;
    }

    .logic-callee-button:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
    }

    .logic-callee-button strong {
      min-width: 0;
      font-family: var(--vscode-editor-font-family);
      font-size: 9px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .logic-callee-button span,
    .logic-callee-omitted {
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 7px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .logic-selection-callees {
      padding-top: 6px;
      border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, transparent);
    }

    .logic-selection-callees > strong {
      font-size: 8px;
    }

    .flow-badge.logic-node-callee {
      color: var(--vscode-charts-green, var(--vscode-textLink-foreground));
      font-size: 7px;
      text-transform: none;
    }

    .flow-badge.logic-node-function {
      max-width: 100%;
      color: var(--vscode-textLink-foreground);
      border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 55%, var(--vscode-panel-border));
      font-size: 7px;
      overflow: hidden;
      text-overflow: ellipsis;
      text-transform: none;
      white-space: nowrap;
    }

    .logic-graph {
      display: grid;
      gap: 7px;
      min-width: 0;
    }

    .logic-graph-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 7px;
    }

    .logic-graph-header > strong {
      font-size: 10px;
    }

    .logic-graph-legend {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 3px;
    }

    .logic-graph-controls {
      display: inline-flex;
      gap: 2px;
    }

    .logic-zoom-button {
      min-width: 24px;
      min-height: 20px;
      padding: 1px 5px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 3px;
      font-size: 8px;
      cursor: pointer;
    }

    .logic-zoom-button:focus-visible {
      border-color: var(--vscode-focusBorder);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .flow-badge.logic-legend {
      font-size: 7px;
      text-transform: none;
    }

    .flow-badge.logic-legend.inferred {
      border-style: dashed;
    }

    .flow-badge.logic-legend.repeat {
      color: var(--vscode-charts-purple, var(--vscode-textLink-foreground));
    }

    .logic-graph-viewport {
      position: relative;
      min-height: 260px;
      max-height: min(58vh, 620px);
      overflow: auto;
      background-color: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent);
      background-image:
        linear-gradient(
          color-mix(in srgb, var(--vscode-panel-border) 28%, transparent) 1px,
          transparent 1px
        ),
        linear-gradient(
          90deg,
          color-mix(in srgb, var(--vscode-panel-border) 28%, transparent) 1px,
          transparent 1px
        );
      background-size: 18px 18px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      outline: none;
      overscroll-behavior: contain;
    }

    .logic-graph-viewport:focus-visible {
      border-color: var(--vscode-focusBorder);
      box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
    }

    .logic-graph-stage,
    .logic-graph-canvas {
      position: relative;
    }

    .logic-graph-stage {
      min-width: 100%;
    }

    .logic-graph-canvas {
      transform-origin: top left;
    }

    .logic-edge-layer {
      position: absolute;
      inset: 0;
      z-index: 0;
      overflow: visible;
      pointer-events: none;
    }

    .logic-edge {
      fill: none;
      stroke: var(--vscode-descriptionForeground);
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.4;
      vector-effect: non-scaling-stroke;
    }

    .logic-edge.dimmed,
    .logic-edge-label.dimmed {
      opacity: 0.28;
    }

    .logic-edge.active {
      opacity: 1;
      stroke-width: 2.6;
    }

    .logic-edge-label.active {
      font-weight: 700;
      opacity: 1;
    }

    .logic-edge.inferred,
    .logic-edge-exception,
    .logic-edge.back-edge {
      stroke-dasharray: 5 4;
    }

    .logic-edge-true,
    .logic-edge-iterate {
      stroke: var(--vscode-charts-green, var(--vscode-descriptionForeground));
    }

    .logic-edge-false,
    .logic-edge-exit,
    .logic-edge-throw,
    .logic-edge-exception {
      stroke: var(--vscode-charts-orange, var(--vscode-descriptionForeground));
    }

    .logic-edge-repeat,
    .logic-edge-continue,
    .logic-edge.back-edge {
      stroke: var(--vscode-charts-purple, var(--vscode-textLink-foreground));
      stroke-width: 1.8;
    }

    .logic-edge-call {
      stroke: var(--vscode-textLink-foreground);
      stroke-width: 2;
    }

    .logic-edge-call-return {
      stroke: var(--vscode-charts-green, var(--vscode-textLink-foreground));
      stroke-dasharray: 3 3;
      stroke-width: 1.8;
    }

    .logic-arrow-head {
      fill: var(--vscode-descriptionForeground);
    }

    .logic-edge-label {
      fill: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family);
      font-size: 8px;
      paint-order: stroke;
      stroke: var(--vscode-editor-background);
      stroke-linejoin: round;
      stroke-width: 4px;
    }

    .logic-edge-label-true,
    .logic-edge-label-iterate {
      fill: var(--vscode-charts-green, var(--vscode-foreground));
    }

    .logic-edge-label-false,
    .logic-edge-label-exit,
    .logic-edge-label-throw {
      fill: var(--vscode-charts-orange, var(--vscode-descriptionForeground));
    }

    .logic-edge-label-repeat,
    .logic-edge-label-continue {
      fill: var(--vscode-charts-purple, var(--vscode-textLink-foreground));
    }

    .logic-edge-label-call {
      fill: var(--vscode-textLink-foreground);
      font-weight: 700;
    }

    .logic-edge-label-call-return {
      fill: var(--vscode-charts-green, var(--vscode-textLink-foreground));
      font-weight: 700;
    }

    .logic-graph-node {
      position: absolute;
      z-index: 1;
      display: grid;
      grid-template-rows: auto auto auto;
      align-content: start;
      gap: 4px;
      min-width: 0;
      box-sizing: border-box;
      padding: 7px 8px;
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-editor-background) 96%, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-panel-border);
      border-left: 3px solid var(--vscode-charts-blue, var(--vscode-focusBorder));
      border-radius: 6px;
      text-align: left;
      cursor: pointer;
      overflow: hidden;
    }

    .logic-graph-node:hover {
      background: color-mix(in srgb, var(--vscode-list-hoverBackground) 72%, var(--vscode-editor-background));
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 58%, var(--vscode-panel-border));
    }

    .logic-graph-node:focus-visible,
    .logic-graph-node.selected {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-focusBorder) 45%, transparent);
      outline: none;
    }

    .logic-node-entry,
    .logic-node-exit {
      border-left-color: var(--vscode-charts-green, var(--vscode-focusBorder));
      border-radius: 18px;
    }

    .logic-node-condition,
    .logic-node-switch,
    .logic-node-loop,
    .logic-node-try {
      background: color-mix(in srgb, var(--vscode-charts-purple) 8%, var(--vscode-editor-background));
      border-left-color: var(--vscode-charts-purple, var(--vscode-charts-blue));
      border-radius: 14px;
    }

    .logic-node-effect,
    .logic-node-mutation {
      background: color-mix(in srgb, var(--vscode-charts-orange) 8%, var(--vscode-editor-background));
      border-left-color: var(--vscode-charts-orange, var(--vscode-charts-yellow));
    }

    .logic-node-return,
    .logic-node-throw,
    .logic-node-break,
    .logic-node-continue {
      border-left-color: var(--vscode-charts-yellow, var(--vscode-descriptionForeground));
    }

    .logic-node-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 4px;
    }

    .logic-node-branch {
      min-width: 0;
      color: var(--vscode-textLink-foreground);
      font-size: 7px;
      font-weight: 700;
      overflow-wrap: anywhere;
      text-transform: uppercase;
      white-space: normal;
    }

    .logic-node-label {
      display: block;
      min-width: 0;
      font-family: var(--vscode-editor-font-family);
      font-size: 9px;
      line-height: 1.3;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .logic-node-meta {
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family);
      font-size: 7px;
      line-height: 1.35;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .logic-selection {
      display: grid;
      gap: 5px;
      min-width: 0;
      padding: 9px;
      background: color-mix(in srgb, var(--vscode-focusBorder) 6%, var(--vscode-editor-background));
      border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 38%, var(--vscode-panel-border));
      border-radius: 6px;
    }

    .logic-selection-header {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 5px;
    }

    .logic-selection-header > strong {
      min-width: 0;
      flex: 1;
      font-family: var(--vscode-editor-font-family);
      font-size: 10px;
      overflow-wrap: anywhere;
    }

    .logic-selection-detail,
    .logic-selection-meta {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 8px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .logic-selection-meta {
      font-family: var(--vscode-editor-font-family);
    }

    .logic-selection-transfers {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
      padding-top: 4px;
      border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, transparent);
    }

    .flow-badge.logic-transfer {
      max-width: 100%;
      color: var(--vscode-textLink-foreground);
      text-transform: none;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .flow-badge.logic-transfer.inferred {
      border-style: dashed;
    }

    .flow-badge.logic-transfer.true,
    .flow-badge.logic-transfer.iterate {
      color: var(--vscode-charts-green, var(--vscode-foreground));
    }

    .flow-badge.logic-transfer.false,
    .flow-badge.logic-transfer.exit,
    .flow-badge.logic-transfer.throw,
    .flow-badge.logic-transfer.exception {
      color: var(--vscode-charts-orange, var(--vscode-descriptionForeground));
    }

    .flow-badge.logic-transfer.repeat,
    .flow-badge.logic-transfer.continue {
      color: var(--vscode-charts-purple, var(--vscode-textLink-foreground));
    }

    .flow-badge.logic-transfer.callReturn {
      color: var(--vscode-charts-green, var(--vscode-textLink-foreground));
      border-style: dashed;
    }

    .logic-open-statement {
      margin-top: 2px;
    }

    @media (forced-colors: active) {
      .logic-graph-viewport,
      .logic-graph-node,
      .logic-selection {
        border-color: CanvasText;
      }

      .logic-edge,
      .logic-arrow-head {
        stroke: CanvasText;
        fill: CanvasText;
      }
    }

    @media (max-width: 760px) {
      .logic-understanding-cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 430px) {
      .logic-understanding-cards {
        grid-template-columns: 1fr;
      }
    }
  `;
}
