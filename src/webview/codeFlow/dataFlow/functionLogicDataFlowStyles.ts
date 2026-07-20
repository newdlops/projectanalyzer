/** Theme-aware styles for Function Logic binding selectors and value-flow overlays. */

/** Returns isolated CSS for parameter/local/constant data-flow presentation. */
export function getFunctionLogicDataFlowStyles(): string {
  return /* css */ `
    .logic-data-flow-toolbar {
      display: grid;
      gap: 6px;
      min-width: 0;
      padding: 8px;
      background: color-mix(in srgb, var(--vscode-charts-blue) 5%, var(--vscode-editor-background));
      border: 1px solid color-mix(in srgb, var(--vscode-charts-blue) 34%, var(--vscode-panel-border));
      border-radius: 6px;
    }

    .logic-data-flow-header {
      display: grid;
      gap: 2px;
    }

    .logic-data-flow-header strong { font-size: var(--logic-font-body); }

    .logic-data-flow-header span {
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-tiny);
      line-height: 1.35;
    }

    .logic-data-flow-bindings {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .logic-data-flow-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .flow-badge.logic-legend.value-consume {
      color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
      border-style: dotted;
    }

    .flow-badge.logic-legend.value-sink {
      color: var(--vscode-charts-yellow, var(--vscode-textLink-foreground));
      border-style: double;
    }

    .logic-data-binding {
      max-width: 100%;
      padding: 3px 6px;
      color: var(--vscode-foreground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--logic-code-tiny);
      line-height: 1.25;
      overflow-wrap: anywhere;
      cursor: pointer;
    }

    .logic-data-binding.parameter { color: var(--vscode-charts-blue, var(--vscode-textLink-foreground)); }
    .logic-data-binding.local { color: var(--vscode-charts-green, var(--vscode-foreground)); }
    .logic-data-binding.constant { color: var(--vscode-charts-purple, var(--vscode-textLink-foreground)); }
    .logic-data-binding.component { color: var(--vscode-charts-yellow, var(--vscode-textLink-foreground)); }
    .logic-data-binding.inferred { border-style: dashed; }

    .logic-data-binding.selected,
    .logic-data-binding:focus-visible {
      background: color-mix(in srgb, var(--vscode-focusBorder) 16%, var(--vscode-button-secondaryBackground));
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 42%, transparent);
      outline: none;
    }

    .logic-data-flow-layer {
      position: absolute;
      inset: 0;
      z-index: 1;
      overflow: visible;
      pointer-events: none;
    }

    .logic-data-flow-edge {
      display: none;
      fill: none;
      stroke: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
      stroke-dasharray: 2 4;
      stroke-linecap: round;
      stroke-width: 2.2;
      vector-effect: non-scaling-stroke;
    }

    .logic-data-flow-edge.selected { display: block; }
    .logic-data-flow-edge.consume { stroke-dasharray: 2 4; }
    .logic-data-flow-edge.sink {
      stroke: var(--vscode-charts-yellow, var(--vscode-textLink-foreground));
      stroke-dasharray: 9 3;
      stroke-width: 2.8;
    }
    .logic-data-flow-edge.inferred { stroke-dasharray: 7 4; }
    .logic-data-flow-edge.choice-dimmed { opacity: 0.16; }

    .logic-data-flow-arrow-head {
      fill: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
    }

    .logic-data-flow-arrow-head.sink {
      fill: var(--vscode-charts-yellow, var(--vscode-textLink-foreground));
    }

    .logic-graph-node.data-flow-related {
      border-color: var(--vscode-charts-blue, var(--vscode-focusBorder));
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-charts-blue) 35%, transparent);
    }

    .logic-graph-node.data-flow-definition {
      border-left-width: 5px;
    }

    .logic-graph-node.data-flow-consume { border-left-style: dotted; }

    .logic-graph-node.data-flow-sink {
      border-right: 5px double var(--vscode-charts-yellow, var(--vscode-focusBorder));
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-charts-yellow) 38%, transparent);
    }

    .logic-node-value-accesses,
    .logic-selection-value-accesses {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    .logic-value-access {
      display: flex;
      flex-wrap: wrap;
      min-width: 0;
      align-items: baseline;
      gap: 4px;
      padding: 2px 4px;
      background: color-mix(in srgb, var(--vscode-charts-blue) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-charts-blue) 42%, var(--vscode-panel-border));
      border-radius: 4px;
    }

    .logic-value-access.inferred { border-style: dashed; }

    .logic-value-access.consume { border-left-style: dotted; }

    .logic-value-access.sink {
      background: color-mix(in srgb, var(--vscode-charts-yellow) 9%, transparent);
      border-color: color-mix(in srgb, var(--vscode-charts-yellow) 58%, var(--vscode-panel-border));
      border-right-style: double;
    }

    .logic-value-access-role {
      flex: 0 0 auto;
      color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
      font-size: var(--logic-font-tiny);
      font-weight: 800;
      letter-spacing: 0.035em;
      white-space: nowrap;
    }

    .logic-value-access.local .logic-value-access-role {
      color: var(--vscode-charts-green, var(--vscode-foreground));
    }

    .logic-value-access.constant .logic-value-access-role {
      color: var(--vscode-charts-purple, var(--vscode-textLink-foreground));
    }

    .logic-value-access.component .logic-value-access-role {
      color: var(--vscode-charts-yellow, var(--vscode-textLink-foreground));
    }

    .logic-value-access.sink .logic-value-access-role {
      color: var(--vscode-charts-yellow, var(--vscode-textLink-foreground));
    }

    .logic-value-access code {
      min-width: 0;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--logic-code-tiny);
      line-height: 1.3;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .logic-selection-access-section {
      display: grid;
      gap: 4px;
      padding-top: 5px;
      border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, transparent);
    }

    .logic-selection-access-section > strong { font-size: var(--logic-font-small); }

    .flow-badge.logic-legend.value-flow {
      color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
      border-style: dotted;
    }

    @media (forced-colors: active) {
      .logic-data-flow-toolbar,
      .logic-data-binding,
      .logic-value-access {
        border-color: CanvasText;
      }

      .logic-data-flow-edge,
      .logic-data-flow-arrow-head {
        stroke: Highlight;
        fill: Highlight;
      }
    }
  `;
}
