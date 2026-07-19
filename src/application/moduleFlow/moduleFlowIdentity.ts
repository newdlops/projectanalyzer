/** Snapshot-local opaque identities used by Module Flow projections. */

import type {
  ModuleFlowEdgeId,
  ModuleFlowFunctionId,
  ModuleFlowModuleId
} from "../../protocol/moduleFlow";
import { createContentHash } from "../../shared/hash";

/** Converts a Host-only module identity into a browser-safe snapshot token. */
export function createModuleFlowModuleId(
  graphVersion: string,
  domainId: string
): ModuleFlowModuleId {
  return `module-flow-module:${hashIdentity(graphVersion, `module\0${domainId}`)}`;
}

/** Creates one stable visual edge identity without exposing its endpoints. */
export function createModuleFlowEdgeId(
  graphVersion: string,
  domainKey: string
): ModuleFlowEdgeId {
  return `module-flow-edge:${hashIdentity(graphVersion, `edge\0${domainKey}`)}`;
}

/** Creates one stable canvas function identity distinct from source tokens. */
export function createModuleFlowFunctionId(
  graphVersion: string,
  nodeId: string
): ModuleFlowFunctionId {
  return `module-flow-function:${hashIdentity(graphVersion, `function\0${nodeId}`)}`;
}

/** The delivery version contains a random panel session component. */
function hashIdentity(graphVersion: string, value: string): string {
  return createContentHash(`${graphVersion}\0${value}`).slice(0, 32);
}
