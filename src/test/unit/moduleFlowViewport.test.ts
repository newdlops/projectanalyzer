/**
 * Pure Module Flow viewport tests cover focal zoom invariants, centered stage
 * sizing, fit bounds, and browser-source portability without a DOM runtime.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  clampModuleFlowScale,
  createModuleFlowFitScale,
  createModuleFlowFocalZoom,
  createModuleFlowViewportFrame,
  getModuleFlowViewportBrowserSource,
  MODULE_FLOW_MAX_SCALE,
  MODULE_FLOW_MIN_SCALE
} from "../../application/moduleFlow/moduleFlowViewport";

const epsilon = 1e-9;

test("clamps non-finite and out-of-range zoom values", () => {
  assert.equal(clampModuleFlowScale(Number.NaN), 1);
  assert.equal(clampModuleFlowScale(Number.POSITIVE_INFINITY), 1);
  assert.equal(clampModuleFlowScale(0), MODULE_FLOW_MIN_SCALE);
  assert.equal(clampModuleFlowScale(9), MODULE_FLOW_MAX_SCALE);
  assert.equal(clampModuleFlowScale(0.8), 0.8);
});

test("centers a small graph and preserves screen-sized padding for a large graph", () => {
  const small = createModuleFlowViewportFrame({
    worldWidth: 400,
    worldHeight: 240,
    viewportWidth: 1000,
    viewportHeight: 700,
    scale: 1,
    padding: 32
  });
  assert.equal(small.stageWidth, 1000);
  assert.equal(small.stageHeight, 700);
  assert.equal(small.offsetX, 300);
  assert.equal(small.offsetY, 230);
  assert.equal(small.maxScrollLeft, 0);

  const large = createModuleFlowViewportFrame({
    worldWidth: 2400,
    worldHeight: 1600,
    viewportWidth: 1000,
    viewportHeight: 700,
    scale: 0.75,
    padding: 32
  });
  assert.equal(large.stageWidth, 1864);
  assert.equal(large.stageHeight, 1264);
  assert.equal(large.offsetX, 32);
  assert.equal(large.offsetY, 32);
});

test("keeps the same world coordinate below a cursor during focal zoom", () => {
  const input = {
    worldWidth: 2400,
    worldHeight: 1600,
    viewportWidth: 1000,
    viewportHeight: 700,
    scale: 0.75,
    scrollLeft: 280,
    scrollTop: 190,
    focalX: 425,
    focalY: 260,
    nextScale: 0.9,
    padding: 32
  };
  const result = createModuleFlowFocalZoom(input);
  const projectedWorldX = (result.scrollLeft + input.focalX - result.offsetX) / result.scale;
  const projectedWorldY = (result.scrollTop + input.focalY - result.offsetY) / result.scale;

  assert.ok(Math.abs(projectedWorldX - result.worldX) <= epsilon);
  assert.ok(Math.abs(projectedWorldY - result.worldY) <= epsilon);
  assert.equal(result.scrollLeft, 414.6);
  assert.ok(Math.abs(result.scrollTop - 273.6) <= epsilon);
});

test("fit uses both dimensions, fixed padding, and never enlarges a small graph", () => {
  assert.equal(createModuleFlowFitScale({
    worldWidth: 400,
    worldHeight: 200,
    viewportWidth: 1000,
    viewportHeight: 700,
    padding: 32
  }), 1);

  const fit = createModuleFlowFitScale({
    worldWidth: 4000,
    worldHeight: 1600,
    viewportWidth: 1000,
    viewportHeight: 700,
    padding: 32
  });
  assert.equal(fit, 0.234);
  const frame = createModuleFlowViewportFrame({
    worldWidth: 4000,
    worldHeight: 1600,
    viewportWidth: 1000,
    viewportHeight: 700,
    scale: fit,
    padding: 32
  });
  assert.equal(frame.maxScrollLeft, 0);
  assert.equal(frame.maxScrollTop, 0);
});

test("serializes the exact viewport math as a standalone browser runtime", () => {
  const runtime = getModuleFlowViewportBrowserSource();
  assert.match(runtime, /function createModuleFlowFocalZoom\(/u);
  assert.match(runtime, /function createModuleFlowFitScale\(/u);
  assert.doesNotMatch(runtime, /\bexports\./u);
  const loadFrame = new Function(
    `${runtime}; return createModuleFlowViewportFrame;`
  ) as () => typeof createModuleFlowViewportFrame;
  const createFrame = loadFrame();
  assert.deepEqual(createFrame({
    worldWidth: 400,
    worldHeight: 200,
    viewportWidth: 1000,
    viewportHeight: 700,
    scale: 1
  }), createModuleFlowViewportFrame({
    worldWidth: 400,
    worldHeight: 200,
    viewportWidth: 1000,
    viewportHeight: 700,
    scale: 1
  }));
});
