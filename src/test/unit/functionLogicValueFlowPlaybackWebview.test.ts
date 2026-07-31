/** Focused generated-webview contract checks for bounded localized value playback. */
import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionVisualizerHtml } from "../../webview/functionVisualizer/functionVisualizerHtml";

test("ships an explicit localized playback card with one bounded work scheduler", () => {
  const html = getFunctionVisualizerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    nonce: "value-flow-playback-test-nonce"
  });

  assert.ok(html.includes("Select a value"));
  assert.ok(html.includes("Token follows the real edge"));
  assert.ok(html.includes("값 선택"));
  assert.ok(html.includes("토큰이 실제 간선을 따라감"));
  assert.ok(html.includes("createFunctionLogicValueFlowPlaybackCopy(options.language)"));
  assert.ok(html.includes("ui/language"));
  assert.ok(html.includes("document.addEventListener?.(\"visibilitychange\""));
  assert.ok(html.includes("cancelScheduledWork"));
  assert.ok(html.includes("path.getTotalLength"));
  assert.ok(html.includes("index < 32"));
});
