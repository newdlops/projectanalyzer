/**
 * Pure Function Logic viewport tests cover infinite-style translation, focal
 * zoom, Center, Fit, resize preservation, and browser-runtime serialization.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  clampFunctionLogicPan,
  clampFunctionLogicScale,
  createCenteredFunctionLogicViewportTransform,
  createDefaultFunctionLogicViewportTransform,
  createFitFunctionLogicViewportTransform,
  createFunctionLogicFitScale,
  createFunctionLogicFocalZoom,
  getFunctionLogicViewportGeometryBrowserSource,
  resizeFunctionLogicViewportTransform,
  FUNCTION_LOGIC_MAX_PAN,
  FUNCTION_LOGIC_MAX_SCALE,
  FUNCTION_LOGIC_MIN_SCALE
} from "../../webview/codeFlow/viewport";

const epsilon = 1e-9;

test("clamps zoom and only numerically bounds infinite-style pan", () => {
  assert.equal(clampFunctionLogicScale(Number.NaN), 1);
  assert.equal(clampFunctionLogicScale(0), FUNCTION_LOGIC_MIN_SCALE);
  assert.equal(clampFunctionLogicScale(9), FUNCTION_LOGIC_MAX_SCALE);
  assert.equal(clampFunctionLogicPan(Number.NaN), 0);
  assert.equal(clampFunctionLogicPan(-50_000), -50_000);
  assert.equal(clampFunctionLogicPan(20_000_000), FUNCTION_LOGIC_MAX_PAN);
});

test("uses start-oriented defaults while Center can move a large world past every edge", () => {
  const small = createDefaultFunctionLogicViewportTransform({
    worldWidth: 300,
    worldHeight: 130,
    viewportWidth: 640,
    viewportHeight: 220,
    padding: 32
  });
  assert.deepEqual(small, { scale: 1, x: 170, y: 45 });

  const largeGeometry = {
    worldWidth: 1000,
    worldHeight: 500,
    viewportWidth: 640,
    viewportHeight: 220,
    padding: 32
  };
  assert.deepEqual(
    createDefaultFunctionLogicViewportTransform(largeGeometry),
    { scale: 1, x: 32, y: 32 }
  );
  assert.deepEqual(
    createCenteredFunctionLogicViewportTransform(largeGeometry, 1),
    { scale: 1, x: -180, y: -140 }
  );
});

test("Fit uses both dimensions, centers the graph, and never enlarges it", () => {
  const geometry = {
    worldWidth: 1000,
    worldHeight: 500,
    viewportWidth: 640,
    viewportHeight: 220,
    padding: 32
  };
  assert.equal(createFunctionLogicFitScale(geometry), 0.312);
  assert.deepEqual(createFitFunctionLogicViewportTransform(geometry), {
    scale: 0.312,
    x: 164,
    y: 32
  });
  assert.equal(createFunctionLogicFitScale({
    worldWidth: 200,
    worldHeight: 100,
    viewportWidth: 640,
    viewportHeight: 220,
    padding: 32
  }), 1);
});

test("focal zoom and resize preserve their intended world coordinates", () => {
  const focal = createFunctionLogicFocalZoom({
    worldWidth: 1200,
    worldHeight: 800,
    viewportWidth: 640,
    viewportHeight: 360,
    transform: { scale: 0.8, x: -120, y: 45 },
    focalX: 410,
    focalY: 190,
    nextScale: 1.25
  });
  const worldXBefore = (410 - -120) / 0.8;
  const worldYBefore = (190 - 45) / 0.8;
  assert.ok(Math.abs((410 - focal.x) / focal.scale - worldXBefore) <= epsilon);
  assert.ok(Math.abs((190 - focal.y) / focal.scale - worldYBefore) <= epsilon);

  const resized = resizeFunctionLogicViewportTransform({
    transform: focal,
    previousViewportWidth: 640,
    previousViewportHeight: 360,
    nextViewportWidth: 420,
    nextViewportHeight: 300
  });
  const oldCenterWorldX = (320 - focal.x) / focal.scale;
  const oldCenterWorldY = (180 - focal.y) / focal.scale;
  assert.ok(Math.abs((210 - resized.x) / resized.scale - oldCenterWorldX) <= epsilon);
  assert.ok(Math.abs((150 - resized.y) / resized.scale - oldCenterWorldY) <= epsilon);
});

test("serializes the exact viewport geometry without module bindings", () => {
  const runtime = getFunctionLogicViewportGeometryBrowserSource();
  assert.match(runtime, /function createFunctionLogicFocalZoom\(/u);
  assert.match(runtime, /function createFitFunctionLogicViewportTransform\(/u);
  assert.doesNotMatch(runtime, /\bexports\./u);
  const loadFit = new Function(
    `${runtime}; return createFunctionLogicFitScale;`
  ) as () => typeof createFunctionLogicFitScale;
  assert.equal(loadFit()({
    worldWidth: 1000,
    worldHeight: 500,
    viewportWidth: 640,
    viewportHeight: 220,
    padding: 32
  }), 0.312);
});
