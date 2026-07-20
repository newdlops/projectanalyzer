/** Theme-aware, graph-adjacent drawer styles for Function Logic inspectors. */

/** Returns isolated split-layout geometry, transitions, and accessibility styles. */
export function getFunctionLogicInspectorStyles(): string {
  return /* css */ `
    .logic-graph-workspace {
      --logic-workspace-height: clamp(340px, 70vh, 780px);
      --logic-inspector-stacked-height: clamp(300px, 48vh, 480px);
      display: grid;
      grid-template-columns: minmax(0, 1fr) 0;
      grid-template-rows: minmax(0, 1fr);
      height: var(--logic-workspace-height);
      min-width: 0;
      overflow: hidden;
      border-radius: 7px;
      isolation: isolate;
      transition: grid-template-columns 170ms ease-out;
    }

    .logic-graph-workspace.inspector-open {
      grid-template-columns: minmax(0, 1fr) clamp(280px, 32vw, 390px);
    }

    .logic-graph-workspace > .logic-graph-viewport {
      grid-column: 1;
      grid-row: 1;
      min-width: 0;
    }

    .logic-inspector-toggle,
    .logic-inspector-close {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      cursor: pointer;
    }

    .logic-inspector-toggle {
      min-height: 24px;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: var(--logic-font-small);
      font-weight: 700;
    }

    .logic-inspector-toggle[aria-expanded="true"] {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border-color: var(--vscode-focusBorder);
    }

    .logic-inspector-toggle:focus-visible,
    .logic-inspector-close:focus-visible {
      border-color: var(--vscode-focusBorder);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .logic-inspector-drawer {
      position: relative;
      grid-column: 2;
      grid-row: 1;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      width: 100%;
      min-width: 0;
      height: 100%;
      max-height: 100%;
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-editor-background) 97%, var(--vscode-sideBar-background));
      border-left: 1px solid var(--vscode-panel-border);
      opacity: 0;
      overflow: hidden;
      pointer-events: none;
      visibility: hidden;
      transform: translateX(12px);
      transition: transform 170ms ease-out, opacity 120ms linear;
    }

    .logic-graph-workspace.inspector-open .logic-inspector-drawer {
      opacity: 1;
      pointer-events: auto;
      visibility: visible;
      transform: translateX(0);
    }

    .logic-inspector-header {
      display: flex;
      min-width: 0;
      align-items: start;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 12px 10px;
      background: color-mix(in srgb, var(--vscode-sideBar-background) 82%, var(--vscode-editor-background));
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .logic-inspector-heading {
      display: grid;
      min-width: 0;
      gap: 2px;
    }

    .logic-inspector-heading > span:first-child {
      color: var(--vscode-textLink-foreground);
      font-size: var(--logic-font-tiny);
      font-weight: 800;
      letter-spacing: 0.1em;
    }

    .logic-inspector-heading > strong { font-size: var(--logic-font-large); }

    .logic-inspector-selected-label {
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--logic-code-small);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .logic-inspector-close {
      flex: 0 0 auto;
      width: 26px;
      height: 26px;
      padding: 0;
      border-radius: 4px;
      font-size: calc(var(--logic-ui-font-size) * 1.3);
      line-height: 1;
    }

    .logic-inspector-scroll {
      display: grid;
      /* Intrinsic-height rows prevent overflow-capable sections from collapsing
         to a few pixels when selected-block evidence is taller than the drawer. */
      grid-auto-rows: max-content;
      align-content: start;
      gap: 10px;
      min-height: 0;
      padding: 11px;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }

    .logic-inspector-selection {
      padding: 0;
      background: transparent;
      border: 0;
      border-radius: 0;
    }

    .logic-inspector-scroll > .logic-signature,
    .logic-inspector-scroll > .logic-understanding,
    .logic-inspector-scroll > .logic-callees,
    .logic-inspector-scroll > .logic-data-flow-toolbar,
    .logic-inspector-scroll > .logic-value-preview-editor,
    .logic-inspector-scroll > .logic-scenario-trace {
      border-radius: 5px;
    }

    .logic-inspector-scroll .logic-understanding-cards {
      grid-template-columns: 1fr;
    }

    @media (max-width: 720px) {
      .logic-graph-workspace,
      .logic-graph-workspace.inspector-open {
        grid-template-columns: minmax(0, 1fr);
      }

      .logic-graph-workspace.inspector-open {
        grid-template-rows:
          var(--logic-workspace-height)
          var(--logic-inspector-stacked-height);
        height: auto;
      }

      .logic-inspector-drawer {
        display: none;
        grid-column: 1;
        grid-row: 2;
        height: 100%;
        max-height: 100%;
        border-top: 1px solid var(--vscode-panel-border);
        border-left: 0;
        transform: none;
      }

      .logic-graph-workspace.inspector-open .logic-inspector-drawer {
        display: grid;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .logic-graph-workspace { transition: none; }
      .logic-inspector-drawer { transition: none; }
    }

    @media (forced-colors: active) {
      .logic-inspector-drawer,
      .logic-inspector-header,
      .logic-inspector-toggle,
      .logic-inspector-close {
        border-color: CanvasText;
      }
    }
  `;
}
