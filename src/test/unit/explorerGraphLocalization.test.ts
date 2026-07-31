/**
 * Contract tests for retained Explorer graph localization. They exercise the
 * renderer's in-place update API and reject language handlers that rebuild the
 * scene, reset viewport state, or post a Host request.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getExplorerCanvasRendererSource } from "../../webview/explorerCanvasRenderer";
import { getExplorerClientScript } from "../../webview/explorerClientScript";

test("canvas renderer updates retained labels and messages without clearing scene state", () => {
  let drawRequests = 0;
  const context = new Proxy({}, { get: () => () => {} });
  const canvas = {
    getBoundingClientRect: () => ({ width: 320, height: 180 }),
    getContext: () => context,
    height: 180,
    width: 320
  };
  const createRenderer = Function(
    "requestAnimationFrame", "window", "getComputedStyle", "document",
    `${getExplorerCanvasRendererSource()}\nreturn createGraphCanvasRenderer;`
  )(
    (callback: () => void) => { drawRequests += 1; callback(); return 0; },
    { devicePixelRatio: 1 },
    () => ({ getPropertyValue: () => "" }),
    { documentElement: {} }
  ) as (canvas: object, options: { width: number; height: number }) => {
    setScene(scene: { nodes: Array<Record<string, unknown>>; edges: unknown[] }): void;
    updateMessage(message: string): void;
    updateNodeLabel(id: string, label: string): void;
    hitTestNode(point: { x: number; y: number }): { label: string } | undefined;
  };
  const renderer = createRenderer(canvas, { width: 320, height: 180 });

  renderer.setScene({ nodes: [{ id: "virtual::workspace-root", label: "Project Root", x: 20, y: 20, radius: 8 }], edges: [] });
  const drawsBeforeUpdate = drawRequests;
  renderer.updateNodeLabel("virtual::workspace-root", "프로젝트 루트");
  renderer.updateMessage("그래프를 렌더링하려면 분석하세요");

  assert.ok(drawRequests > drawsBeforeUpdate);
  assert.equal(renderer.hitTestNode({ x: 20, y: 20 })?.label, "프로젝트 루트");
});

test("language handler patches retained Explorer copy without rebuilding graph state", () => {
  const source = getExplorerClientScript({
    canvasHeight: 180,
    canvasWidth: 320,
    defaultDepth: 2,
    initialMode: "file",
    maxNodes: 20
  });
  const handlerStart = source.indexOf('if (message.type === "ui/language")');
  const handlerEnd = source.indexOf('if (message.type === "ui/ready")');
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const languageHandler = source.slice(handlerStart, handlerEnd);

  assert.match(languageHandler, /applyProjectAnalyzerLanguage/u);
  assert.match(languageHandler, /refreshLocalizedGraphChrome\(\)/u);
  assert.doesNotMatch(languageHandler, /render\(|createGraphScene|setScene|resetViewport|postMessage|graph\/load/u);
  assert.match(source, /graphRenderer\.updateNodeLabel\(virtualRootId, projectAnalyzerText\("graph-project-root"\)\)/u);
  assert.match(source, /graphRenderer\.updateMessage\(projectAnalyzerText\(state\.canvasMessage/u);
  assert.match(source, /graph-projection-bounded/u);
});

test("unknown graph render failures retain a semantic status for later locale changes", () => {
  const source = getExplorerClientScript({
    canvasHeight: 180,
    canvasWidth: 320,
    defaultDepth: 2,
    initialMode: "file",
    maxNodes: 20
  });

  assert.match(source, /isError \? "render-failed" : "graph-render-failed-unknown"/u);
  assert.doesNotMatch(source, /projectAnalyzerText\("graph-render-unknown"\)/u);
});
