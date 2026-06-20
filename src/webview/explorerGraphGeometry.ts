/**
 * Small geometry helpers shared by graph layout tests and injected Webview code.
 * The functions stay DOM-free so their source can be embedded in the browser.
 */

/** Bounded two-dimensional coordinate used by SVG graph layout helpers. */
export type GraphPoint = {
  x: number;
  y: number;
};

/**
 * Keeps numeric layout coordinates inside a bounded visual range.
 */
export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Chooses a stable push direction when two nodes share the same coordinate.
 */
export function getSeparationSign(delta: number, leftIndex: number, rightIndex: number): number {
  if (delta !== 0) {
    return Math.sign(delta);
  }

  return (leftIndex + rightIndex) % 2 === 0 ? -1 : 1;
}

/**
 * Moves an edge endpoint away from a node center so strokes and arrows do not
 * obscure the node glyph.
 */
export function moveToward(
  x: number,
  y: number,
  targetX: number,
  targetY: number,
  distance: number
): GraphPoint {
  const deltaX = targetX - x;
  const deltaY = targetY - y;
  const length = Math.hypot(deltaX, deltaY);

  if (length === 0) {
    return { x, y };
  }

  return {
    x: x + (deltaX / length) * distance,
    y: y + (deltaY / length) * distance
  };
}
