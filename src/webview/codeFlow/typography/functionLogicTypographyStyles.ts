/**
 * Shared Function Logic typography tokens. UI text follows the VS Code UI
 * font while source-shaped labels follow the configured editor font.
 */

/** Returns scalable typography tokens for every Function Logic surface. */
export function getFunctionLogicTypographyStyles(): string {
  return /* css */ `
    .logic-graph {
      --logic-ui-font-size: var(--vscode-font-size, 13px);
      --logic-code-font-size: var(--vscode-editor-font-size, var(--logic-ui-font-size));
      --logic-font-large: calc(var(--logic-ui-font-size) * 1.08);
      --logic-font-body: calc(var(--logic-ui-font-size) * 0.92);
      --logic-font-small: calc(var(--logic-ui-font-size) * 0.78);
      --logic-font-tiny: calc(var(--logic-ui-font-size) * 0.68);
      --logic-code-body: calc(var(--logic-code-font-size) * 0.92);
      --logic-code-small: calc(var(--logic-code-font-size) * 0.78);
      --logic-code-tiny: calc(var(--logic-code-font-size) * 0.68);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--logic-ui-font-size);
    }

    .logic-graph button,
    .logic-graph input {
      font: inherit;
    }

    .logic-graph code,
    .logic-graph .logic-code-font {
      font-family: var(--vscode-editor-font-family, monospace);
    }

    .logic-graph .flow-badge {
      font-size: var(--logic-font-tiny);
    }

    .logic-graph .logic-button {
      font-size: var(--logic-font-small);
    }
  `;
}
