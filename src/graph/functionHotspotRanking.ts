/**
 * Evidence-based callable concentration ranking for Function Explorer.
 *
 * Repeated call sites are deliberately collapsed: only distinct caller and
 * callee identities contribute so one loop or duplicated invocation does not
 * masquerade as broad change impact.
 */

import type { FunctionIndexNode } from "./functionIndexTypes";

/** Returns the strongest distinct-call relationship count for one callable. */
export function getFunctionHotspotScore(node: FunctionIndexNode): number {
  return Math.max(
    node.metrics.directCallerCount,
    node.metrics.directCalleeCount
  );
}

/** Explains a hotspot using distinct identities rather than raw call sites. */
export function getFunctionHotspotDetail(node: FunctionIndexNode): string {
  const fanIn = node.metrics.directCallerCount;
  const fanOut = node.metrics.directCalleeCount;
  const role = fanIn === fanOut
    ? "high fan-in/out"
    : fanIn > fanOut ? "high fan-in" : "high fan-out";

  return role + " / distinct callers " + fanIn + " / distinct callees " + fanOut;
}
