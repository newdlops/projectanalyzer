/** Theme-aware styles for the calculated Scenario value progression trace. */

/** Returns isolated drawer styles for bounded calculation/consume/sink steps. */
export function getFunctionLogicScenarioTraceStyles(): string {
  return /* css */ `
    .logic-scenario-trace {
      display: grid;
      min-width: 0;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
      overflow: hidden;
    }

    .logic-scenario-trace-header {
      display: grid;
      min-width: 0;
      gap: 2px;
      padding: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .logic-scenario-trace-header strong { font-size: var(--logic-font-body); }

    .logic-scenario-trace-header span,
    .logic-scenario-trace-empty,
    .logic-scenario-trace-omitted {
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-tiny);
      line-height: 1.35;
    }

    .logic-scenario-trace-selection {
      min-width: 0;
      padding: 6px 8px;
      color: var(--vscode-debugTokenExpression-value, var(--vscode-charts-yellow));
      background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
      border-bottom: 1px solid var(--vscode-panel-border);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--logic-code-small);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .logic-scenario-trace-rows {
      display: grid;
      max-height: clamp(190px, 30vh, 320px);
      min-width: 0;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }

    .logic-scenario-step {
      display: grid;
      grid-template-columns: auto auto minmax(0, 1fr);
      min-width: 0;
      align-items: start;
      gap: 3px 6px;
      padding: 7px 8px;
      border-left: 3px solid var(--vscode-charts-blue, var(--vscode-focusBorder));
    }

    .logic-scenario-step + .logic-scenario-step {
      border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 62%, transparent);
    }

    .logic-scenario-step.consume { border-left-style: dotted; }

    .logic-scenario-step.sink {
      background: color-mix(in srgb, var(--vscode-charts-yellow) 8%, transparent);
      border-left-color: var(--vscode-charts-yellow, var(--vscode-focusBorder));
      border-left-style: double;
    }

    .logic-scenario-step.write,
    .logic-scenario-step.readwrite,
    .logic-scenario-step.calculation {
      border-left-color: var(--vscode-charts-orange, var(--vscode-focusBorder));
    }

    .logic-scenario-step.calculation {
      background: color-mix(in srgb, var(--vscode-charts-orange) 6%, transparent);
    }

    .logic-scenario-step.override {
      background: color-mix(in srgb, var(--vscode-charts-purple) 7%, transparent);
      border-left-color: var(--vscode-charts-purple, var(--vscode-focusBorder));
    }

    .logic-scenario-step.choice-dimmed {
      opacity: 0.3;
      filter: grayscale(0.75);
    }

    .logic-scenario-step-sequence {
      display: inline-grid;
      width: 1.5em;
      height: 1.5em;
      place-items: center;
      color: var(--vscode-badge-foreground);
      background: var(--vscode-badge-background);
      border-radius: 50%;
      font-size: var(--logic-font-tiny);
      font-weight: 800;
      line-height: 1;
    }

    .logic-scenario-step-role {
      color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
      font-size: var(--logic-font-tiny);
      letter-spacing: 0.04em;
      line-height: 1.5;
      white-space: nowrap;
    }

    .logic-scenario-step.sink .logic-scenario-step-role {
      color: var(--vscode-charts-yellow, var(--vscode-textLink-foreground));
    }

    .logic-scenario-step-source {
      min-width: 0;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--logic-code-small);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .logic-scenario-step-value-label {
      grid-column: 2;
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-tiny);
      line-height: 1.4;
    }

    .logic-scenario-step-value {
      grid-column: 3;
      min-width: 0;
      color: var(--vscode-debugTokenExpression-value, var(--vscode-charts-yellow));
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--logic-code-small);
      line-height: 1.4;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .logic-scenario-step.unknown .logic-scenario-step-value {
      color: var(--vscode-debugTokenExpression-error, var(--vscode-errorForeground));
      font-style: italic;
    }

    .logic-scenario-step-status {
      grid-column: 2 / -1;
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-tiny);
    }

    .logic-scenario-trace-empty,
    .logic-scenario-trace-omitted {
      margin: 0;
      padding: 7px 8px;
    }

    .logic-scenario-trace-omitted {
      border-top: 1px solid var(--vscode-panel-border);
    }

    @media (forced-colors: active) {
      .logic-scenario-trace,
      .logic-scenario-step {
        border-color: CanvasText;
      }

      .logic-scenario-step.sink { border-left-style: double; }
    }
  `;
}
