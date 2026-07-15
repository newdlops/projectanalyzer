/** Tests graph-wide insight reuse across presentation-only explorer refreshes. */

import assert from "node:assert/strict";
import test from "node:test";
import { ProjectInsightCache } from "../../application/projectOverview";
import type { ProjectGraph } from "../../shared/types";

test("ProjectInsightCache reuses one semantic snapshot for the same graph object", () => {
  const cache = new ProjectInsightCache();
  const graph = createGraph("2026-07-13T00:00:00.000Z");
  const first = cache.get(graph);
  const second = cache.get(graph);
  const firstOverview = cache.getOverview(graph);
  const secondOverview = cache.getOverview(graph);

  assert.strictEqual(second, first);
  assert.strictEqual(second.functionArchitecture, first.functionArchitecture);
  assert.strictEqual(second.guidedTour, first.guidedTour);
  assert.strictEqual(second.semanticFlows, first.semanticFlows);
  assert.strictEqual(secondOverview, firstOverview);
  assert.strictEqual(second.projectReadingGuidePayload, first.projectReadingGuidePayload);
  assert.strictEqual(second.readingGuideProjector, first.readingGuideProjector);
  assert.equal("readingGuideScopeIds" in first, false);
});

test("ProjectInsightCache resolves only opaque scope tokens for the supplied graph", () => {
  const cache = new ProjectInsightCache();
  const graph = createGraph("2026-07-13T00:00:00.000Z");
  const snapshot = cache.get(graph);
  const payloadScopeId = snapshot.projectReadingGuidePayload.scopes[0]?.id;

  assert.ok(payloadScopeId);
  const domainScopeId = cache.resolveReadingGuideScopeDomainId(graph, payloadScopeId);
  assert.ok(domainScopeId);
  assert.notEqual(domainScopeId, payloadScopeId);
  assert.ok(snapshot.readingGuideProjector.projectScope(domainScopeId));
  assert.equal(
    cache.resolveReadingGuideScopeDomainId(graph, "reading-scope:ffffffffffffffffffffffff"),
    undefined
  );

  const otherGraph = createGraph("2026-07-13T00:00:00.000Z", "/different-workspace");
  assert.equal(
    cache.resolveReadingGuideScopeDomainId(otherGraph, payloadScopeId),
    undefined
  );
});

test("ProjectInsightCache never reuses a coarse-identity collision", () => {
  const cache = new ProjectInsightCache();
  const firstGraph = createGraph("2026-07-13T00:00:00.000Z");
  const secondGraph = createGraph("2026-07-13T00:00:00.000Z");
  firstGraph.metadata.languages = ["typescript"];
  secondGraph.metadata.languages = ["python"];

  const first = cache.get(firstGraph);
  const second = cache.get(secondGraph);
  const secondOverview = cache.getOverview(secondGraph);

  assert.notStrictEqual(second, first);
  assert.match(secondOverview.facts[0]?.value ?? "", /python/);
  assert.match(second.projectReadingGuidePayload.headline, /python/);
});

test("ProjectInsightCache invalidates on graph change and explicit clear", () => {
  const cache = new ProjectInsightCache();
  const first = cache.get(createGraph("2026-07-13T00:00:00.000Z"));
  const changed = cache.get(createGraph("2026-07-13T00:00:01.000Z"));

  assert.notStrictEqual(changed, first);

  cache.clear();
  const afterClear = cache.get(createGraph("2026-07-13T00:00:01.000Z"));
  assert.notStrictEqual(afterClear, changed);
});

/** Creates an empty immutable graph snapshot for cache lifecycle tests. */
function createGraph(generatedAt: string, workspaceRoot = "/workspace"): ProjectGraph {
  return {
    workspaceRoot,
    version: "cache-test",
    generatedAt,
    nodes: [],
    edges: [],
    diagnostics: [],
    metadata: {
      languages: [],
      frameworkUnits: [],
      frameworkUnitEdges: [],
      fileCount: 0,
      symbolCount: 0,
      edgeCount: 0
    }
  };
}
