/**
 * Pure transform geometry for the Function Logic infinite-style canvas.
 * DOM-free formulas keep pan, focal zoom, Center, Fit, and resize behavior
 * deterministic and reusable inside the generated Webview runtime.
 */

export const FUNCTION_LOGIC_MIN_SCALE = 0.01;
export const FUNCTION_LOGIC_MAX_SCALE = 3;
export const FUNCTION_LOGIC_FIT_MAX_SCALE = 1;
export const FUNCTION_LOGIC_VIEW_PADDING = 32;
export const FUNCTION_LOGIC_MAX_PAN = 10_000_000;

// Function#toString browser serialization cannot retain CommonJS export
// bindings, so portable formulas reference aliases emitted by the serializer.
const FUNCTION_LOGIC_MIN_SCALE_FOR_VIEWPORT = FUNCTION_LOGIC_MIN_SCALE;
const FUNCTION_LOGIC_MAX_SCALE_FOR_VIEWPORT = FUNCTION_LOGIC_MAX_SCALE;
const FUNCTION_LOGIC_FIT_MAX_SCALE_FOR_VIEWPORT = FUNCTION_LOGIC_FIT_MAX_SCALE;
const FUNCTION_LOGIC_VIEW_PADDING_FOR_VIEWPORT = FUNCTION_LOGIC_VIEW_PADDING;
const FUNCTION_LOGIC_MAX_PAN_FOR_VIEWPORT = FUNCTION_LOGIC_MAX_PAN;

/** Screen-space translation and scale for one logical graph world. */
export type FunctionLogicViewportTransform = {
  scale: number;
  x: number;
  y: number;
};

/** Logical graph and visible viewport dimensions shared by viewport formulas. */
export type FunctionLogicViewportGeometry = {
  worldWidth: number;
  worldHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
};

/** Focal zoom input that preserves one world point under the same screen point. */
export type FunctionLogicFocalZoomInput = FunctionLogicViewportGeometry & {
  transform: FunctionLogicViewportTransform;
  focalX: number;
  focalY: number;
  nextScale: number;
};

/** Resize input that preserves the world coordinate at the viewport center. */
export type FunctionLogicResizeTransformInput = {
  transform: FunctionLogicViewportTransform;
  previousViewportWidth: number;
  previousViewportHeight: number;
  nextViewportWidth: number;
  nextViewportHeight: number;
};

/** Restricts arbitrary wheel/button zoom to a finite supported range. */
export function clampFunctionLogicScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(
    FUNCTION_LOGIC_MAX_SCALE_FOR_VIEWPORT,
    Math.max(FUNCTION_LOGIC_MIN_SCALE_FOR_VIEWPORT, scale)
  );
}

/** Keeps unbounded-feeling pan numerically safe without exposing UI edges. */
export function clampFunctionLogicPan(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(
    FUNCTION_LOGIC_MAX_PAN_FOR_VIEWPORT,
    Math.max(-FUNCTION_LOGIC_MAX_PAN_FOR_VIEWPORT, value)
  );
}

/** Normalizes persisted or caller-produced viewport state. */
export function normalizeFunctionLogicViewportTransform(
  transform: FunctionLogicViewportTransform
): FunctionLogicViewportTransform {
  return {
    scale: clampFunctionLogicScale(transform?.scale),
    x: clampFunctionLogicPan(transform?.x),
    y: clampFunctionLogicPan(transform?.y)
  };
}

/** Centers small worlds while keeping the start of a large world visible. */
export function createDefaultFunctionLogicViewportTransform(
  geometry: FunctionLogicViewportGeometry,
  scale = 1
): FunctionLogicViewportTransform {
  const normalizedScale = clampFunctionLogicScale(scale);
  const viewportWidth = Math.max(0, geometry.viewportWidth);
  const viewportHeight = Math.max(0, geometry.viewportHeight);
  const worldWidth = Math.max(0, geometry.worldWidth) * normalizedScale;
  const worldHeight = Math.max(0, geometry.worldHeight) * normalizedScale;
  const padding = Math.max(
    0,
    geometry.padding ?? FUNCTION_LOGIC_VIEW_PADDING_FOR_VIEWPORT
  );
  return normalizeFunctionLogicViewportTransform({
    scale: normalizedScale,
    x: worldWidth + padding * 2 <= viewportWidth
      ? (viewportWidth - worldWidth) / 2
      : padding,
    y: worldHeight + padding * 2 <= viewportHeight
      ? (viewportHeight - worldHeight) / 2
      : padding
  });
}

/** Centers the complete graph at the current or requested scale. */
export function createCenteredFunctionLogicViewportTransform(
  geometry: FunctionLogicViewportGeometry,
  scale: number
): FunctionLogicViewportTransform {
  const normalizedScale = clampFunctionLogicScale(scale);
  return normalizeFunctionLogicViewportTransform({
    scale: normalizedScale,
    x: (Math.max(0, geometry.viewportWidth)
      - Math.max(0, geometry.worldWidth) * normalizedScale) / 2,
    y: (Math.max(0, geometry.viewportHeight)
      - Math.max(0, geometry.worldHeight) * normalizedScale) / 2
  });
}

/** Computes a whole-graph scale with fixed screen padding and no upscaling. */
export function createFunctionLogicFitScale(
  geometry: FunctionLogicViewportGeometry
): number {
  if (geometry.worldWidth <= 0 || geometry.worldHeight <= 0) return 1;
  const padding = Math.max(
    0,
    geometry.padding ?? FUNCTION_LOGIC_VIEW_PADDING_FOR_VIEWPORT
  );
  const availableWidth = Math.max(1, geometry.viewportWidth - padding * 2);
  const availableHeight = Math.max(1, geometry.viewportHeight - padding * 2);
  return Math.min(
    FUNCTION_LOGIC_FIT_MAX_SCALE_FOR_VIEWPORT,
    Math.max(
      FUNCTION_LOGIC_MIN_SCALE_FOR_VIEWPORT,
      Math.min(availableWidth / geometry.worldWidth, availableHeight / geometry.worldHeight)
    )
  );
}

/** Fits and centers the complete graph in one deterministic operation. */
export function createFitFunctionLogicViewportTransform(
  geometry: FunctionLogicViewportGeometry
): FunctionLogicViewportTransform {
  return createCenteredFunctionLogicViewportTransform(
    geometry,
    createFunctionLogicFitScale(geometry)
  );
}

/** Preserves the world coordinate beneath a cursor or viewport-center focal point. */
export function createFunctionLogicFocalZoom(
  input: FunctionLogicFocalZoomInput
): FunctionLogicViewportTransform {
  const current = normalizeFunctionLogicViewportTransform(input.transform);
  const worldX = (input.focalX - current.x) / current.scale;
  const worldY = (input.focalY - current.y) / current.scale;
  const scale = clampFunctionLogicScale(input.nextScale);
  return normalizeFunctionLogicViewportTransform({
    scale,
    x: input.focalX - worldX * scale,
    y: input.focalY - worldY * scale
  });
}

/** Preserves the old viewport-center world point after responsive resizing. */
export function resizeFunctionLogicViewportTransform(
  input: FunctionLogicResizeTransformInput
): FunctionLogicViewportTransform {
  const current = normalizeFunctionLogicViewportTransform(input.transform);
  const worldX = (input.previousViewportWidth / 2 - current.x) / current.scale;
  const worldY = (input.previousViewportHeight / 2 - current.y) / current.scale;
  return normalizeFunctionLogicViewportTransform({
    scale: current.scale,
    x: input.nextViewportWidth / 2 - worldX * current.scale,
    y: input.nextViewportHeight / 2 - worldY * current.scale
  });
}

/** Emits the exact pure formulas for the nonce-protected browser program. */
export function getFunctionLogicViewportGeometryBrowserSource(): string {
  const constants = [
    `const FUNCTION_LOGIC_MIN_SCALE=${FUNCTION_LOGIC_MIN_SCALE};`,
    `const FUNCTION_LOGIC_MAX_SCALE=${FUNCTION_LOGIC_MAX_SCALE};`,
    `const FUNCTION_LOGIC_FIT_MAX_SCALE=${FUNCTION_LOGIC_FIT_MAX_SCALE};`,
    `const FUNCTION_LOGIC_VIEW_PADDING=${FUNCTION_LOGIC_VIEW_PADDING};`,
    `const FUNCTION_LOGIC_MAX_PAN=${FUNCTION_LOGIC_MAX_PAN};`,
    "const FUNCTION_LOGIC_MIN_SCALE_FOR_VIEWPORT=FUNCTION_LOGIC_MIN_SCALE;",
    "const FUNCTION_LOGIC_MAX_SCALE_FOR_VIEWPORT=FUNCTION_LOGIC_MAX_SCALE;",
    "const FUNCTION_LOGIC_FIT_MAX_SCALE_FOR_VIEWPORT=FUNCTION_LOGIC_FIT_MAX_SCALE;",
    "const FUNCTION_LOGIC_VIEW_PADDING_FOR_VIEWPORT=FUNCTION_LOGIC_VIEW_PADDING;",
    "const FUNCTION_LOGIC_MAX_PAN_FOR_VIEWPORT=FUNCTION_LOGIC_MAX_PAN;"
  ];
  return [
    ...constants,
    clampFunctionLogicScale,
    clampFunctionLogicPan,
    normalizeFunctionLogicViewportTransform,
    createDefaultFunctionLogicViewportTransform,
    createCenteredFunctionLogicViewportTransform,
    createFunctionLogicFitScale,
    createFitFunctionLogicViewportTransform,
    createFunctionLogicFocalZoom,
    resizeFunctionLogicViewportTransform
  ].map((value) => typeof value === "string" ? value : value.toString()).join("\n");
}
