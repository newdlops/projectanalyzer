/** Tests Webview snapshot identity independently from analyzer schema versions. */

import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionExplorerPayload } from "../../protocol/functionExplorer";
import type { ProjectGraph } from "../../shared/types";
import {
  SidebarGraphDelivery,
  withFunctionExplorerVersion,
  withSidebarGraphVersion
} from "../../webview/sidebarGraphDelivery";

test("SidebarGraphDelivery differentiates graph objects with the same engine version", () => {
  const delivery = new SidebarGraphDelivery();
  const firstGraph = createGraph();
  const first = delivery.activate(firstGraph);
  const repeated = delivery.activate(firstGraph);
  const replacement = delivery.activate(createGraph());

  assert.equal(first.changed, true);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.snapshot.version, first.snapshot.version);
  assert.notEqual(replacement.snapshot.version, first.snapshot.version);
  assert.equal(delivery.matches(first.snapshot.version), false);
  assert.equal(delivery.matches(replacement.snapshot.version), true);
});

test("SidebarGraphDelivery clear rejects late responses and keeps tokens monotonic", () => {
  const delivery = new SidebarGraphDelivery();
  const beforeClear = delivery.activate(createGraph()).snapshot.version;

  delivery.clear();
  assert.equal(delivery.current(), undefined);
  assert.equal(delivery.matches(beforeClear), false);

  const afterClear = delivery.activate(createGraph()).snapshot.version;
  assert.notEqual(afterClear, beforeClear);
});

test("delivery projection replaces both Function Explorer stale-guard versions", () => {
  const graph = createGraph();
  const projectedGraph = withSidebarGraphVersion(graph, "sidebar-snapshot:9");
  const payload = {
    graphVersion: "0.1.0-rust",
    summary: { graphVersion: "0.1.0-rust" }
  } as FunctionExplorerPayload;
  const projectedPayload = withFunctionExplorerVersion(payload, "sidebar-snapshot:9");

  assert.equal(projectedGraph.version, "sidebar-snapshot:9");
  assert.equal(graph.version, "0.1.0-rust");
  assert.equal(projectedPayload.graphVersion, "sidebar-snapshot:9");
  assert.equal(projectedPayload.summary.graphVersion, "sidebar-snapshot:9");
  assert.equal(payload.graphVersion, "0.1.0-rust");
});

/** Creates distinct immutable snapshots that deliberately share one engine version. */
function createGraph(): ProjectGraph {
  return {
    workspaceRoot: "/workspace/private",
    version: "0.1.0-rust",
    generatedAt: "2026-07-13T00:00:00.000Z",
    nodes: [],
    edges: [],
    diagnostics: [],
    metadata: {
      languages: [],
      fileCount: 0,
      symbolCount: 0,
      edgeCount: 0
    }
  };
}
