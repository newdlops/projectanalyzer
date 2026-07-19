/**
 * Compile- and JSON-shape guards for the bounded Module Flow protocol. Fixtures
 * intentionally use only opaque browser identities and display-safe source labels.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionResponse, WebviewRequest } from "../../protocol/messages";
import type {
  ModuleFlowConfidenceCounts,
  ModuleFlowDetailPayload,
  ModuleFlowEdgePayload,
  ModuleFlowExpandPayload,
  ModuleFlowListPayload,
  ModuleFlowModuleNodePayload
} from "../../protocol/moduleFlow";

const MODULE_ID = "module-flow-module:0123456789abcdef0123456789abcdef" as const;
const TARGET_MODULE_ID = "module-flow-module:abcdef0123456789abcdef0123456789" as const;
const EDGE_ID = "module-flow-edge:0123456789abcdef0123456789abcdef" as const;
const FUNCTION_ID = "module-flow-function:0123456789abcdef0123456789abcdef" as const;
const SOURCE_TOKEN =
  "source-node:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const EVIDENCE_TOKEN =
  "module-flow-evidence:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as const;

test("Module Flow responses remain bounded JSON projections", () => {
  const list = createListPayload();
  const detail = createDetailPayload();
  const expansion = createExpandPayload();
  const responses = [
    { type: "moduleFlow/listLoaded", payload: list },
    { type: "moduleFlow/detailLoaded", payload: detail },
    { type: "moduleFlow/expanded", payload: expansion },
    {
      type: "moduleFlow/requestFailed",
      payload: {
        graphVersion: "sidebar-snapshot:test:1",
        requestId: 4,
        operation: "openSource",
        code: "evidenceNotFound",
        message: "This evidence is no longer available."
      }
    }
  ] satisfies ExtensionResponse[];

  assert.equal(list.summary.omittedModuleCount, 3);
  assert.equal(detail.detail.kind, "edge");
  assert.equal(expansion.anchorModuleId, MODULE_ID);
  assertJsonProtocolValue(responses);
  assertHostIdentitiesAreAbsent(responses);
});

test("Module Flow requests compile as correlated bounded Webview variants", () => {
  const requests = [
    {
      type: "moduleFlow/list",
      payload: {
        graphVersion: "sidebar-snapshot:test:1",
        requestId: 1,
        mode: "execution",
        moduleLimit: 32,
        edgeLimit: 64,
        includeExternal: true,
        includeInferred: false
      }
    },
    {
      type: "moduleFlow/detail",
      payload: {
        graphVersion: "sidebar-snapshot:test:1",
        requestId: 2,
        target: { kind: "edge", id: EDGE_ID },
        relationLimit: 20,
        evidenceLimit: 5
      }
    },
    {
      type: "moduleFlow/expand",
      payload: {
        graphVersion: "sidebar-snapshot:test:1",
        requestId: 3,
        moduleId: MODULE_ID,
        expansion: "boundaryFunctions",
        direction: "both",
        nodeLimit: 24,
        edgeLimit: 48
      }
    },
    {
      type: "moduleFlow/openSource",
      payload: {
        graphVersion: "sidebar-snapshot:test:1",
        requestId: 4,
        target: { kind: "node", sourceToken: SOURCE_TOKEN }
      }
    },
    {
      type: "moduleFlow/openSource",
      payload: {
        graphVersion: "sidebar-snapshot:test:1",
        requestId: 5,
        target: { kind: "evidence", evidenceToken: EVIDENCE_TOKEN }
      }
    }
  ] satisfies WebviewRequest[];

  assert.deepEqual(
    requests.map((request) => request.type),
    [
      "moduleFlow/list",
      "moduleFlow/detail",
      "moduleFlow/expand",
      "moduleFlow/openSource",
      "moduleFlow/openSource"
    ]
  );
  assertJsonProtocolValue(requests);
});

/** Creates one module card without exposing its canonical root or domain ID. */
function createModuleNode(): ModuleFlowModuleNodePayload {
  return {
    id: MODULE_ID,
    kind: "module",
    label: "orders",
    detail: "Workspace package · 2 entrypoints",
    locationLabel: "packages/orders",
    basis: "workspacePackage",
    confidence: "exact",
    external: false,
    ecosystems: ["node"],
    frameworks: ["nestjs"],
    metrics: {
      analyzedFileCount: 12,
      descendantFileCount: 12,
      callableCount: 30,
      descendantCallableCount: 30,
      frameworkUnitCount: 5,
      entrypointCount: 2,
      incomingEvidenceCount: 4,
      outgoingEvidenceCount: 8
    },
    expandable: {
      childModules: false,
      boundaryFunctions: true
    }
  };
}

/** Creates one pair-aggregated route to avoid parallel edge overlap. */
function createEdge(): ModuleFlowEdgePayload {
  return {
    id: EDGE_ID,
    sourceId: MODULE_ID,
    targetId: TARGET_MODULE_ID,
    presentationKind: "aggregate",
    relations: [
      { kind: "calls", count: 4 },
      { kind: "routesTo", count: 1 }
    ],
    confidenceCounts: createConfidenceCounts({ exact: 2, resolved: 3 }),
    evidenceCount: 5,
    omittedEvidenceCount: 0,
    hasDetails: true
  };
}

/** Creates one initial graph scene with exact visible/omitted coverage. */
function createListPayload(): ModuleFlowListPayload {
  return {
    graphVersion: "sidebar-snapshot:test:1",
    requestId: 1,
    mode: "execution",
    nodes: [createModuleNode()],
    edges: [createEdge()],
    summary: {
      analyzedFileCount: 40,
      ownedFileCount: 40,
      totalModuleCount: 4,
      visibleModuleCount: 1,
      omittedModuleCount: 3,
      totalEdgeCount: 6,
      visibleEdgeCount: 1,
      omittedEdgeCount: 5,
      crossModuleEvidenceCount: 20,
      internalRelationEvidenceCount: 30,
      externalRelationEvidenceCount: 2,
      unownedRelationEvidenceCount: 1
    }
  };
}

/** Creates edge evidence without serializing the Host edge ID or source path. */
function createDetailPayload(): ModuleFlowDetailPayload {
  return {
    graphVersion: "sidebar-snapshot:test:1",
    requestId: 2,
    detail: {
      kind: "edge",
      edge: createEdge(),
      evidence: [{
        label: "orders/controller.ts:18",
        source: "graphEdge",
        confidence: "resolved",
        evidenceToken: EVIDENCE_TOKEN
      }],
      omittedEvidenceCount: 4
    }
  };
}

/** Creates one idempotent function expansion delta around the module anchor. */
function createExpandPayload(): ModuleFlowExpandPayload {
  return {
    graphVersion: "sidebar-snapshot:test:1",
    requestId: 3,
    anchorModuleId: MODULE_ID,
    expansion: "boundaryFunctions",
    nodes: [{
      id: FUNCTION_ID,
      kind: "function",
      label: "OrdersController.create",
      detail: "Interface · outgoing module boundary",
      locationLabel: "orders/controller.ts:18",
      sourceToken: SOURCE_TOKEN,
      architectureLayer: "interface",
      confidence: "resolved",
      incomingBoundaryCount: 0,
      outgoingBoundaryCount: 2
    }],
    edges: [{
      id: "module-flow-edge:abcdef0123456789abcdef0123456789",
      sourceId: MODULE_ID,
      targetId: FUNCTION_ID,
      presentationKind: "contains",
      relations: [],
      confidenceCounts: createConfidenceCounts({ exact: 1 }),
      evidenceCount: 1,
      omittedEvidenceCount: 0,
      hasDetails: false
    }],
    replacedEdgeIds: [],
    summary: {
      candidateNodeCount: 3,
      visibleNodeCount: 1,
      omittedNodeCount: 2,
      candidateEdgeCount: 3,
      visibleEdgeCount: 1,
      omittedEdgeCount: 2
    }
  };
}

/** Creates all confidence buckets while keeping fixtures focused on non-zero values. */
function createConfidenceCounts(
  overrides: Partial<ModuleFlowConfidenceCounts>
): ModuleFlowConfidenceCounts {
  return {
    exact: 0,
    resolved: 0,
    inferred: 0,
    unresolved: 0,
    ...overrides
  };
}

/** Rejects accidental protocol exposure of known Host-only identity field names. */
function assertHostIdentitiesAreAbsent(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const forbidden of ["rootPath", "moduleIdByNodeId", "edgeId", "filePath", "/workspace/"]) {
    assert.equal(serialized.includes(forbidden), false, `unexpected Host identity: ${forbidden}`);
  }
}

/** Verifies every fixture is plain JSON using an iterative, cycle-safe walk. */
function assertJsonProtocolValue(value: unknown): void {
  const stack: unknown[] = [value];
  const visited = new Set<object>();

  while (stack.length > 0) {
    const next = stack.pop();
    if (next === null) {
      continue;
    }
    const valueType = typeof next;
    if (valueType === "string" || valueType === "number" || valueType === "boolean") {
      continue;
    }
    if (valueType !== "object") {
      assert.fail(`Expected JSON protocol value, received ${valueType}`);
    }

    const objectValue = next as object;
    if (visited.has(objectValue)) {
      continue;
    }
    visited.add(objectValue);
    if (next instanceof Map || next instanceof Set || next instanceof Date) {
      assert.fail("Module Flow protocol values must not contain Map, Set, or Date");
    }
    if (Array.isArray(next)) {
      stack.push(...next);
      continue;
    }
    for (const [key, child] of Object.entries(next as Record<string, unknown>)) {
      assert.notEqual(child, undefined, `Property ${key} must be omitted instead of undefined`);
      stack.push(child);
    }
  }

  assert.doesNotThrow(() => JSON.stringify(value));
}
