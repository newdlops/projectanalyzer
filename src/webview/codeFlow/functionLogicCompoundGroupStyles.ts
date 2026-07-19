/**
 * Decorative compound-body styles shared by the sidebar and editor visualizer.
 * Frames sit behind routes and remain pointer-transparent so graph interaction
 * continues to belong exclusively to statement nodes and evidence controls.
 */

/** Returns nested body-frame CSS with theme and forced-color support. */
export function getFunctionLogicCompoundGroupStyles(): string {
  return /* css */ `
    .logic-compound-group-layer {
      position: absolute;
      inset: 0;
      z-index: 0;
      overflow: visible;
      pointer-events: none;
    }

    .logic-compound-group {
      --logic-compound-accent: var(--vscode-charts-purple, var(--vscode-focusBorder));
      --logic-compound-fill: 4%;
      position: absolute;
      background: color-mix(
        in srgb,
        var(--logic-compound-accent) var(--logic-compound-fill),
        transparent
      );
      border: 1px dashed color-mix(
        in srgb,
        var(--logic-compound-accent) 42%,
        var(--vscode-panel-border)
      );
      border-radius: 18px;
      box-shadow: inset 0 0 0 1px color-mix(
        in srgb,
        var(--logic-compound-accent) 5%,
        transparent
      );
    }

    .logic-compound-loop {
      --logic-compound-accent: var(--vscode-charts-blue, var(--vscode-focusBorder));
    }

    .logic-compound-try {
      --logic-compound-accent: var(--vscode-charts-yellow, var(--vscode-focusBorder));
    }

    .logic-compound-depth-2 { --logic-compound-fill: 5%; }
    .logic-compound-depth-3 { --logic-compound-fill: 6%; }
    .logic-compound-depth-4 { --logic-compound-fill: 7%; }
    .logic-compound-depth-5 { --logic-compound-fill: 8%; }

    .logic-compound-caption {
      position: absolute;
      top: 4px;
      left: 9px;
      color: color-mix(
        in srgb,
        var(--logic-compound-accent) 78%,
        var(--vscode-foreground)
      );
      font-family: var(--vscode-font-family);
      font-size: 7px;
      font-weight: 800;
      letter-spacing: 0.08em;
      line-height: 10px;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .logic-graph-node.logic-node-body-owner {
      border-width: 2px;
      box-shadow: 0 0 0 2px color-mix(
        in srgb,
        var(--vscode-charts-purple) 10%,
        transparent
      );
    }

    @media (forced-colors: active) {
      .logic-compound-group {
        background: transparent;
        border-color: CanvasText;
      }
      .logic-compound-caption { color: CanvasText; }
    }
  `;
}
