/**
 * Unit tests for generated Webview HTML. These guard the graph browser shell
 * without needing a live VS Code Webview runtime.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getExplorerHtml } from "../../webview/webviewHtml";

test("graph panel HTML exposes canvas viewer controls", () => {
  const html = getExplorerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    extensionUri: {} as never,
    nonce: "nonce",
    defaultDepth: 2,
    initialMode: "file",
    surface: "panel"
  });
  const scriptMatch = html.match(/<script nonce="nonce">([\s\S]*)<\/script>/);

  assert.match(html, /id="graph-canvas"/);
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /id="fit-view"/);
  assert.match(html, /id="center-view"/);
  assert.match(html, /resize: both/);
  assert.ok(scriptMatch, "missing graph panel script");

  const script = scriptMatch[1];

  assert.match(script, /handleGraphClick/);
  assert.match(script, /getSceneBounds/);
  assert.match(script, /screenToCanvas/);
  assert.doesNotThrow(() => new Function("acquireVsCodeApi", script));
});
