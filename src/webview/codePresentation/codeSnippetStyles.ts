/** Theme-token CSS shared by every graph surface that renders source snippets. */

/** Returns editor-theme-aware syntax colors without owning node geometry. */
export function getCodeSnippetStyles(): string {
  return /* css */ `
    .code-snippet,
    .code-snippet-content {
      white-space: pre-wrap;
      tab-size: 2;
    }

    .code-snippet-token { font: inherit; }

    .code-snippet-keyword {
      color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-charts-purple));
      font-weight: 650;
    }

    .code-snippet-literal {
      color: var(--vscode-symbolIcon-constantForeground, var(--vscode-charts-blue));
    }

    .code-snippet-string {
      color: var(--vscode-symbolIcon-stringForeground, var(--vscode-charts-orange));
    }

    .code-snippet-number {
      color: var(--vscode-symbolIcon-numberForeground, var(--vscode-charts-green));
    }

    .code-snippet-comment {
      color: var(--vscode-editorLineNumber-foreground, var(--vscode-descriptionForeground));
      font-style: italic;
    }

    .code-snippet-operator {
      color: var(--vscode-symbolIcon-operatorForeground, var(--vscode-textLink-foreground));
    }

    .code-snippet-type {
      color: var(--vscode-symbolIcon-classForeground, var(--vscode-charts-yellow));
    }

    .code-snippet-function {
      color: var(--vscode-symbolIcon-functionForeground, var(--vscode-charts-blue));
    }
  `;
}
