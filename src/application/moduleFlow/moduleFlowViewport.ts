/**
 * Pure viewport geometry for the Module Flow canvas.
 *
 * This module owns zoom bounds, fit calculations, centered stage extents, and
 * focal-point preservation. It is independent of DOM and VS Code APIs so the
 * same formulas can be unit-tested and embedded in the Webview runtime.
 */

export const MODULE_FLOW_MIN_SCALE = 0.01;
export const MODULE_FLOW_MAX_SCALE = 3;
export const MODULE_FLOW_FIT_MAX_SCALE = 1;
export const MODULE_FLOW_STAGE_PADDING = 32;

// Exported CommonJS bindings are rewritten as `exports.*` inside Function#toString.
// Browser-portable functions therefore reference these private aliases, which
// get emitted explicitly by getModuleFlowViewportBrowserSource.
const MODULE_FLOW_MIN_SCALE_FOR_VIEWPORT = MODULE_FLOW_MIN_SCALE;
const MODULE_FLOW_MAX_SCALE_FOR_VIEWPORT = MODULE_FLOW_MAX_SCALE;
const MODULE_FLOW_FIT_MAX_SCALE_FOR_VIEWPORT = MODULE_FLOW_FIT_MAX_SCALE;
const MODULE_FLOW_STAGE_PADDING_FOR_VIEWPORT = MODULE_FLOW_STAGE_PADDING;

/** Logical graph and physical viewport dimensions used to size the stage. */
export type ModuleFlowViewportGeometry = {
  worldWidth: number;
  worldHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scale: number;
  padding?: number;
};

/** Scroll extent and centered world offset for one concrete zoom level. */
export type ModuleFlowViewportFrame = {
  scale: number;
  viewportWidth: number;
  viewportHeight: number;
  stageWidth: number;
  stageHeight: number;
  offsetX: number;
  offsetY: number;
  maxScrollLeft: number;
  maxScrollTop: number;
};

/** Inputs for preserving the world point below a viewport-relative focal point. */
export type ModuleFlowFocalZoomInput = ModuleFlowViewportGeometry & {
  scrollLeft: number;
  scrollTop: number;
  focalX: number;
  focalY: number;
  nextScale: number;
};

/** A complete next viewport state produced without reading or writing the DOM. */
export type ModuleFlowFocalZoomResult = ModuleFlowViewportFrame & {
  scrollLeft: number;
  scrollTop: number;
  worldX: number;
  worldY: number;
};

/** Restricts arbitrary wheel/button input to the supported finite scale range. */
export function clampModuleFlowScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(
    MODULE_FLOW_MAX_SCALE_FOR_VIEWPORT,
    Math.max(MODULE_FLOW_MIN_SCALE_FOR_VIEWPORT, scale)
  );
}

/** Restricts scroll positions after a scale or viewport-size change. */
export function clampModuleFlowScroll(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, maximum), Math.max(0, value));
}

/**
 * Creates the scroll surface for a transform. Padding remains screen-sized,
 * while a graph smaller than its viewport is centered instead of top-left.
 */
export function createModuleFlowViewportFrame(
  geometry: ModuleFlowViewportGeometry
): ModuleFlowViewportFrame {
  const scale = clampModuleFlowScale(geometry.scale);
  const viewportWidth = Math.max(0, geometry.viewportWidth);
  const viewportHeight = Math.max(0, geometry.viewportHeight);
  const worldWidth = Math.max(0, geometry.worldWidth);
  const worldHeight = Math.max(0, geometry.worldHeight);
  const padding = Math.max(
    0,
    geometry.padding ?? MODULE_FLOW_STAGE_PADDING_FOR_VIEWPORT
  );
  const scaledWidth = worldWidth * scale;
  const scaledHeight = worldHeight * scale;
  const stageWidth = Math.max(viewportWidth, Math.ceil(scaledWidth + padding * 2));
  const stageHeight = Math.max(viewportHeight, Math.ceil(scaledHeight + padding * 2));
  return {
    scale,
    viewportWidth,
    viewportHeight,
    stageWidth,
    stageHeight,
    offsetX: (stageWidth - scaledWidth) / 2,
    offsetY: (stageHeight - scaledHeight) / 2,
    maxScrollLeft: Math.max(0, stageWidth - viewportWidth),
    maxScrollTop: Math.max(0, stageHeight - viewportHeight)
  };
}

/**
 * Computes the next transform while keeping the focal world coordinate under
 * the same cursor or viewport-center point whenever scroll bounds permit it.
 */
export function createModuleFlowFocalZoom(
  input: ModuleFlowFocalZoomInput
): ModuleFlowFocalZoomResult {
  const current = createModuleFlowViewportFrame(input);
  const worldX = (input.scrollLeft + input.focalX - current.offsetX) / current.scale;
  const worldY = (input.scrollTop + input.focalY - current.offsetY) / current.scale;
  const next = createModuleFlowViewportFrame({
    worldWidth: input.worldWidth,
    worldHeight: input.worldHeight,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    scale: input.nextScale,
    padding: input.padding
  });
  return {
    ...next,
    scrollLeft: clampModuleFlowScroll(
      next.offsetX + worldX * next.scale - input.focalX,
      next.maxScrollLeft
    ),
    scrollTop: clampModuleFlowScroll(
      next.offsetY + worldY * next.scale - input.focalY,
      next.maxScrollTop
    ),
    worldX,
    worldY
  };
}

/** Returns a whole-graph scale with fixed screen padding and no upscaling. */
export function createModuleFlowFitScale(
  geometry: Omit<ModuleFlowViewportGeometry, "scale">
): number {
  if (geometry.worldWidth <= 0 || geometry.worldHeight <= 0) return 1;
  const padding = Math.max(
    0,
    geometry.padding ?? MODULE_FLOW_STAGE_PADDING_FOR_VIEWPORT
  );
  const availableWidth = Math.max(1, geometry.viewportWidth - padding * 2);
  const availableHeight = Math.max(1, geometry.viewportHeight - padding * 2);
  return Math.min(
    MODULE_FLOW_FIT_MAX_SCALE_FOR_VIEWPORT,
    Math.max(
      MODULE_FLOW_MIN_SCALE_FOR_VIEWPORT,
      Math.min(availableWidth / geometry.worldWidth, availableHeight / geometry.worldHeight)
    )
  );
}

/** Returns the exact pure runtime declarations for the nonce Webview script. */
export function getModuleFlowViewportBrowserSource(): string {
  const constants = [
    `const MODULE_FLOW_MIN_SCALE=${MODULE_FLOW_MIN_SCALE};`,
    `const MODULE_FLOW_MAX_SCALE=${MODULE_FLOW_MAX_SCALE};`,
    `const MODULE_FLOW_FIT_MAX_SCALE=${MODULE_FLOW_FIT_MAX_SCALE};`,
    `const MODULE_FLOW_STAGE_PADDING=${MODULE_FLOW_STAGE_PADDING};`,
    "const MODULE_FLOW_MIN_SCALE_FOR_VIEWPORT=MODULE_FLOW_MIN_SCALE;",
    "const MODULE_FLOW_MAX_SCALE_FOR_VIEWPORT=MODULE_FLOW_MAX_SCALE;",
    "const MODULE_FLOW_FIT_MAX_SCALE_FOR_VIEWPORT=MODULE_FLOW_FIT_MAX_SCALE;",
    "const MODULE_FLOW_STAGE_PADDING_FOR_VIEWPORT=MODULE_FLOW_STAGE_PADDING;"
  ];
  return [
    ...constants,
    clampModuleFlowScale,
    clampModuleFlowScroll,
    createModuleFlowViewportFrame,
    createModuleFlowFocalZoom,
    createModuleFlowFitScale
  ].map((value) => typeof value === "string" ? value : value.toString()).join("\n");
}
