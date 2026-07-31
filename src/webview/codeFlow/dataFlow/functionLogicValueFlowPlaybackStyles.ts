/** Theme-aware controls and active-hop treatment for value-flow playback. */

/** Returns isolated CSS for explicit, reduced-motion-safe playback controls. */
export function getFunctionLogicValueFlowPlaybackStyles(): string {
  return /* css */ `
    .logic-value-flow-playback {
      display: grid;
      gap: 6px;
      min-width: 0;
      padding: 7px 8px;
      background: color-mix(in srgb, var(--vscode-charts-blue) 7%, var(--vscode-editor-background));
      border: 1px solid color-mix(in srgb, var(--vscode-charts-blue) 38%, var(--vscode-panel-border));
      border-radius: 6px;
    }

    .logic-value-flow-playback-header {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .logic-value-flow-playback-header strong { font-size: var(--logic-font-small); }

    .logic-value-flow-playback-status {
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-tiny);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .logic-value-flow-playback-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .logic-value-flow-playback-button {
      min-height: 26px;
      padding: 3px 7px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 4px;
      cursor: pointer;
      font-size: var(--logic-font-tiny);
    }

    .logic-value-flow-playback-button:hover:not(:disabled) {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .logic-value-flow-playback-button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .logic-value-flow-playback-button:disabled {
      cursor: default;
      opacity: 0.55;
    }

    .logic-data-flow-edge.playback-active {
      display: block;
      opacity: 1;
      stroke-width: 3.4;
    }

    .logic-data-flow-edge.playback-past { opacity: 0.58; }

    .logic-graph-node.data-flow-playback-source,
    .logic-graph-node.data-flow-playback-target,
    .logic-graph-node.data-flow-playback-current {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-focusBorder) 32%, transparent);
    }

    .logic-graph-node.data-flow-playback-change {
      position: relative;
      border-color: var(--vscode-charts-orange, var(--vscode-focusBorder));
      animation: logic-value-flow-change-ring 440ms ease-out 1;
    }

    .logic-graph-node.data-flow-playback-change::after {
      content: "Δ";
      position: absolute;
      top: -0.7em;
      right: -0.45em;
      z-index: 2;
      display: grid;
      width: 1.45em;
      height: 1.45em;
      place-items: center;
      color: var(--vscode-editor-background);
      background: var(--vscode-charts-orange, var(--vscode-focusBorder));
      border: 1px solid var(--vscode-editor-background);
      border-radius: 50%;
      font-size: var(--logic-font-tiny);
      font-weight: 800;
      line-height: 1;
      pointer-events: none;
    }

    @keyframes logic-value-flow-change-ring {
      from { box-shadow: 0 0 0 0 var(--vscode-charts-orange, var(--vscode-focusBorder)); }
      to { box-shadow: 0 0 0 5px transparent; }
    }

    .logic-graph-node.data-flow-playback-target.data-flow-sink {
      border-color: var(--vscode-charts-yellow, var(--vscode-focusBorder));
    }

    .logic-data-flow-traveler {
      pointer-events: none;
    }

    .logic-data-flow-traveler-body {
      fill: var(--vscode-button-background, var(--vscode-focusBorder));
      stroke: var(--vscode-editor-background);
      stroke-width: 1.5;
    }

    .logic-data-flow-traveler-label {
      fill: var(--vscode-button-foreground, var(--vscode-editor-background));
      font-family: var(--vscode-font-family);
      font-size: var(--logic-font-tiny);
      font-weight: 700;
      pointer-events: none;
    }

    @media (prefers-reduced-motion: reduce) {
      .logic-data-flow-traveler { display: none; }
      .logic-graph-node.data-flow-playback-change { animation: none; }
    }

    @media (forced-colors: active) {
      .logic-value-flow-playback { border-color: CanvasText; }
      .logic-data-flow-edge.playback-active { stroke: Highlight; }
      .logic-data-flow-traveler-body { fill: Highlight; stroke: Canvas; }
      .logic-data-flow-traveler-label { fill: HighlightText; }
      .logic-graph-node.data-flow-playback-source,
      .logic-graph-node.data-flow-playback-target,
      .logic-graph-node.data-flow-playback-current,
      .logic-graph-node.data-flow-playback-change { outline: 2px solid Highlight; }
      .logic-graph-node.data-flow-playback-change::after {
        color: HighlightText;
        background: Highlight;
        border-color: Canvas;
      }
    }
  `;
}
