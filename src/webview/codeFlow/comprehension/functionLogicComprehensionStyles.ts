/** Theme-aware central attention styles for the Function Logic graph. */

/** Returns Function Logic comprehension styles without defining a new visual system. */
export function getFunctionLogicComprehensionStyles(): string {
  return /* css */ `
    .logic-graph-key { grid-column: 1 / -1; min-width: 0; }
    .logic-graph-key > summary { width: fit-content; padding: 5px 0; color: var(--vscode-descriptionForeground); font-size: 12px; cursor: pointer; }
    .logic-graph-key > summary:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .logic-graph-key .logic-graph-legend { padding: 6px 0; }

    .logic-graph-node[data-attention],
    .logic-edge[data-attention],
    .logic-edge-label[data-attention] {
      transition: opacity 120ms ease-out;
    }

    .logic-graph-node[data-attention="related"],
    .logic-edge[data-attention="related"],
    .logic-edge-label[data-attention="related"] { opacity: 1; }

    .logic-graph-node[data-attention="context"] { opacity: 0.78; }
    .logic-edge[data-attention="context"],
    .logic-edge-label[data-attention="context"] { opacity: 0.62; }

    .logic-graph-node[data-attention="muted"] { opacity: 0.42; }
    .logic-edge[data-attention="muted"],
    .logic-edge-label[data-attention="muted"] { opacity: 0.28; }

    .logic-graph-node.selected[data-attention],
    .logic-graph-node:focus-visible[data-attention] { opacity: 1; }

    @media (prefers-reduced-motion: reduce) {
      .logic-graph-node[data-attention],
      .logic-edge[data-attention],
      .logic-edge-label[data-attention] { transition: none; }
    }
  `;
}
