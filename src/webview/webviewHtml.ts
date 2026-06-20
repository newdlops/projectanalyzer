/**
 * Webview HTML factory. The shell intentionally avoids external assets until
 * the frontend build pipeline is introduced.
 */

import * as vscode from "vscode";

/** Data required to construct the explorer Webview HTML. */
export type WebviewHtmlOptions = {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  nonce: string;
};

/**
 * Builds the initial Visual Explorer HTML document.
 */
export function getExplorerHtml(options: WebviewHtmlOptions): string {
  const cspSource = options.webview.cspSource;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
  <title>Project Analyzer</title>
  <style>
    body {
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
    }

    .layout {
      display: grid;
      grid-template-columns: 260px 1fr 320px;
      height: 100vh;
    }

    aside,
    main {
      padding: 12px;
      border-right: 1px solid var(--vscode-panel-border);
    }

    main {
      border-right: 1px solid var(--vscode-panel-border);
    }

    h1,
    h2 {
      margin: 0 0 12px;
      font-size: 13px;
      font-weight: 600;
    }

    .placeholder {
      display: grid;
      place-items: center;
      height: calc(100vh - 24px);
      color: var(--vscode-descriptionForeground);
      border: 1px dashed var(--vscode-panel-border);
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside>
      <h1>Project Analyzer</h1>
      <div>Search and filters will be added here.</div>
    </aside>
    <main>
      <div class="placeholder">Graph canvas scaffold</div>
    </main>
    <aside>
      <h2>Details</h2>
      <div>Select a graph node to inspect it.</div>
    </aside>
  </div>
  <script nonce="${options.nonce}">
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ type: "graph/load", payload: { mode: "file", depth: 1 } });
  </script>
</body>
</html>`;
}
