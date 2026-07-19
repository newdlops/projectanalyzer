/**
 * Product-shell tests for the flow-first Webview. They protect the reading
 * frame, visible module launcher, source-backed reader, and retained panel shell.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getExplorerHtml } from "../../webview/webviewHtml";

test("sidebar exposes the Code Flow reading mindset and one start question", () => {
  const html = createHtml("sidebar");
  const script = requireInlineScript(html);

  assert.match(html, /CODE FLOW READER/u);
  assert.match(html, /Understand this codebase/u);
  assert.match(html, /Boundary[\s\S]*Responsibility[\s\S]*Decision[\s\S]*Effect[\s\S]*Verify/u);
  assert.match(html, /id="flow-start"/u);
  assert.match(html, /Choose one question/u);
  assert.match(html, /id="mode-entrypoints"/u);
  assert.match(html, /id="mode-functions"/u);
  assert.match(html, /id="flow-search-input"[\s\S]*maxlength="512"/u);
  assert.match(html, /id="flow-reader"/u);
  assert.match(html, /id="open-module-flow"/u);
  assert.match(html, /See how modules connect/u);
  assert.match(html, /title="Open Project Module Flow in a new editor tab"/u);
  assert.match(
    html,
    /aria-describedby="module-flow-description module-flow-action-hint"/u
  );
  assert.match(html, /STATIC FLOW · POSSIBLE CALL PATH/u);
  assert.match(html, /statically discoverable call relationships, not observed runtime order/u);
  assert.match(html, /What remains unknown/u);
  assert.match(html, /Export Evidence JSON/u);
  assert.match(html, /\.logic-node-label[\s\S]*white-space: normal/u);
  assert.match(html, /\.logic-node-meta[\s\S]*white-space: normal/u);
  assert.doesNotMatch(html, /-webkit-line-clamp/u);

  assert.doesNotMatch(html, /Project Reading Plan|Explore Code Flows|Browse Structure|Analysis Details|Guided Tour/u);
  assert.doesNotMatch(html, /accordion-|project-brief|analysis-signals|framework-tree|call-tree/u);
  assert.doesNotMatch(script, /innerHTML/u);
  assert.doesNotThrow(() => new Function("acquireVsCodeApi", script));
});

test("sidebar script uses bounded, correlated CodeFlow protocol routes", () => {
  const script = requireInlineScript(createHtml("sidebar"));

  assert.match(script, /CATALOG_LIMIT = 24/u);
  assert.match(script, /FUNCTION_PAGE_LIMIT = 30/u);
  assert.match(script, /codeFlow\/catalog/u);
  assert.match(script, /codeFlow\/select/u);
  assert.match(script, /codeFlow\/selectSource/u);
  assert.match(script, /codeFlow\/openEvidence/u);
  assert.match(script, /type: "moduleFlow\/open", payload: \{\}/u);
  assert.match(script, /message\.type === "moduleFlow\/openCompleted"/u);
  assert.match(script, /"aria-busy"/u);
  assert.match(script, /function\/search/u);
  assert.match(script, /message\.payload\.requestId !== state\.catalogPendingRequestId/u);
  assert.match(script, /payload\.requestId === state\.functionPendingRequestId/u);
  assert.match(script, /isCurrentGraph/u);
  assert.match(script, /includeExternal: false, includeUnresolved: false/u);
  assert.match(script, /node\/openSource/u);
  assert.match(script, /createLogicEdgeSvg/u);
  assert.match(script, /logic-graph-node/u);
  assert.match(script, /Zoom out function graph/u);
  assert.match(script, /createElementNS/u);
  assert.doesNotMatch(script, /project\/readingGuide|project\/guidedTour|graph\/loadStructure|project\/loadOverview/u);
});

test("graph panel remains a CSP-safe compatibility renderer", () => {
  const html = createHtml("panel");
  const script = requireInlineScript(html);

  assert.match(html, /id="graph-canvas"/u);
  assert.match(html, /id="fit-view"/u);
  assert.match(html, /id="center-view"/u);
  assert.doesNotMatch(html, /<svg/u);
  assert.match(script, /handleGraphClick/u);
  assert.match(script, /const maxNodes = 37/u);
  assert.doesNotThrow(() => new Function("acquireVsCodeApi", script));
});

/** Creates deterministic HTML without a live VS Code Webview. */
function createHtml(surface: "sidebar" | "panel"): string {
  return getExplorerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    extensionUri: {} as never,
    nonce: "code-flow-nonce",
    defaultDepth: 2,
    maxRenderedNodes: 37,
    initialMode: "file",
    surface
  });
}

/** Extracts the nonce-bound inline program from generated HTML. */
function requireInlineScript(html: string): string {
  const match = html.match(/<script nonce="code-flow-nonce">([\s\S]*)<\/script>/u);
  assert.ok(match, "missing generated Webview script");
  return match[1];
}
