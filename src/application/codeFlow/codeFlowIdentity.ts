/** Snapshot-local opaque identities shared by CodeFlow catalog and detail projections. */

import type { CodeFlowId } from "../../protocol/codeFlow";
import { createContentHash } from "../../shared/hash";

/** Creates a stable opaque flow identity scoped to one delivery snapshot. */
export function createCodeFlowIdentity(
  deliveryVersion: string,
  domainIdentity: string
): CodeFlowId {
  return `code-flow:${createContentHash(`${deliveryVersion}\0${domainIdentity}`).slice(0, 32)}`;
}

