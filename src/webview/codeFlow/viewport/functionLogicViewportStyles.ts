/** Theme-aware controls and transform surface for the Function Logic canvas. */

/** Returns isolated pan, zoom, Center, Fit, and infinite-grid styles. */
export function getFunctionLogicViewportStyles(): string {
  return /* css */ `
    .logic-graph-controls,
    .logic-viewport-controls {
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }

    .logic-graph-controls {
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .logic-zoom-button {
      min-width: 24px;
      min-height: 22px;
      padding: 1px 6px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 3px;
      font-size: var(--logic-font-small);
      cursor: pointer;
    }

    .logic-zoom-button:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .logic-zoom-level { min-width: 48px; }
    .logic-center-button,
    .logic-fit-button { min-width: 44px; }

    .logic-zoom-button:focus-visible {
      border-color: var(--vscode-focusBorder);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .logic-viewport-announcement {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .logic-graph-viewport {
      --logic-grid-size: 18px;
      --logic-grid-x: 0px;
      --logic-grid-y: 0px;
      position: relative;
      height: 100%;
      min-height: 0;
      max-height: none;
      overflow: hidden;
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
      background-position:
        var(--logic-grid-x) var(--logic-grid-y),
        var(--logic-grid-x) var(--logic-grid-y);
      background-size: var(--logic-grid-size) var(--logic-grid-size);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      outline: none;
      overscroll-behavior: contain;
      touch-action: none;
      cursor: grab;
    }

    .logic-graph-viewport.panning {
      cursor: grabbing;
      user-select: none;
    }

    .logic-graph-viewport:focus-visible {
      border-color: var(--vscode-focusBorder);
      box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
    }

    .logic-graph-stage {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
    }

    .logic-graph-canvas {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
      will-change: transform;
      pointer-events: auto;
    }

    @media (max-width: 520px) {
      .logic-graph-header {
        grid-template-columns: minmax(0, 1fr);
      }

      .logic-graph-controls {
        grid-column: 1;
        justify-content: flex-end;
      }
    }

    @media (forced-colors: active) {
      .logic-zoom-button,
      .logic-graph-viewport {
        border-color: CanvasText;
      }
    }
  `;
}
