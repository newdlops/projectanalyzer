/**
 * Architecture guard for the sidebar's server-side function search route.
 * The provider must reject stale snapshot tokens before querying the cached
 * Function Index or publishing a search page.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { FunctionExplorerProjectionService } from "../../application/functionExplorer";
import type { ProjectAnalyzerLogger } from "../../observability/logger";
import type { ExtensionResponse } from "../../protocol/messages";
import type { ProjectGraph } from "../../shared/types";
import { deliverFunctionSearch } from "../../webview/functionSearch";
import { SidebarGraphDelivery } from "../../webview/sidebarGraphDelivery";

const projectRoot = path.resolve(__dirname, "../../..");

test("provider delegates function search to the snapshot-guarded host adapter", () => {
  const providerPath = path.join(projectRoot, "src", "webview", "explorerViewProvider.ts");
  const deliveryPath = path.join(
    projectRoot,
    "src",
    "webview",
    "functionSearch",
    "functionSearchHostDelivery.ts"
  );
  const providerSource = fs.readFileSync(providerPath, "utf8");
  const deliverySource = fs.readFileSync(deliveryPath, "utf8");
  const guardIndex = deliverySource.indexOf("dependencies.graphDelivery.matches(request.graphVersion)");
  const queryIndex = deliverySource.indexOf("dependencies.projectionService.search(");
  const tokenIndex = deliverySource.indexOf("dependencies.createSourceToken");
  const publishIndex = deliverySource.indexOf('type: "function/searchLoaded"');

  assert.match(
    providerSource,
    /case "function\/search":\s+await deliverFunctionSearch\(message\.payload,/u
  );
  assert.ok(guardIndex >= 0, "missing search snapshot guard");
  assert.ok(queryIndex > guardIndex, "search must run after the snapshot guard");
  assert.ok(tokenIndex > queryIndex, "search rows must receive opaque source tokens");
  assert.ok(publishIndex > queryIndex, "search response must publish after the cached query");
  assert.doesNotMatch(deliverySource, /cacheStore\.getLatestGraph/u);
  assert.ok(fs.readFileSync(providerPath, "utf8").split("\n").length <= 801);
});

test("host adapter publishes, drops stale requests, and correlates failures", async () => {
  const graphDelivery = new SidebarGraphDelivery();
  const graph = createGraph();
  const snapshot = graphDelivery.activate(graph).snapshot;
  const posted: ExtensionResponse[] = [];
  const debugMessages: string[] = [];
  const dependencies = {
    graphDelivery,
    projectionService: new FunctionExplorerProjectionService(),
    logger: createLogger(debugMessages),
    createSourceToken() {
      return "source-node:test-token" as const;
    },
    postMessage(message: ExtensionResponse): Promise<void> {
      posted.push(message);
      return Promise.resolve();
    }
  };

  await deliverFunctionSearch({
    graphVersion: snapshot.version,
    requestId: 1,
    query: "handler",
    limit: 20
  }, dependencies);
  assert.equal(posted[0]?.type, "function/searchLoaded");
  assert.equal(
    posted[0]?.type === "function/searchLoaded" ? posted[0].payload.totalMatchCount : undefined,
    1
  );
  assert.equal(
    posted[0]?.type === "function/searchLoaded"
      ? posted[0].payload.rows[0]?.sourceToken
      : undefined,
    "source-node:test-token"
  );
  assert.equal(
    posted[0]?.type === "function/searchLoaded"
      ? posted[0].payload.rows[0]?.functionId
      : undefined,
    undefined
  );

  posted.length = 0;
  await deliverFunctionSearch({
    graphVersion: "sidebar-snapshot:stale",
    requestId: 2,
    query: "handler",
    limit: 20
  }, dependencies);
  assert.deepEqual(posted, []);
  assert.deepEqual(debugMessages, ["sidebar.lazyRequest.stale"]);

  graphDelivery.clear();
  posted.length = 0;
  await deliverFunctionSearch({
    graphVersion: snapshot.version,
    requestId: 3,
    query: "handler",
    limit: 20
  }, dependencies);
  const missingGraphResponse = readFirstResponse(posted);
  assert.equal(missingGraphResponse?.type, "function/searchFailed");
  assert.equal(
    missingGraphResponse?.type === "function/searchFailed"
      ? missingGraphResponse.payload.requestId
      : undefined,
    3
  );

  const replacementSnapshot = graphDelivery.activate(graph).snapshot;
  dependencies.createSourceToken = () => {
    throw new Error("token projection failed");
  };
  posted.length = 0;
  await deliverFunctionSearch({
    graphVersion: replacementSnapshot.version,
    requestId: 4,
    query: "handler",
    limit: 20
  }, dependencies);
  const failedProjectionResponse = readFirstResponse(posted);
  assert.equal(failedProjectionResponse?.type, "function/searchFailed");
  assert.equal(
    failedProjectionResponse?.type === "function/searchFailed"
      ? failedProjectionResponse.payload.requestId
      : undefined,
    4
  );
});

/** Reads posted messages across awaited callbacks without array CFA assumptions. */
function readFirstResponse(messages: ExtensionResponse[]): ExtensionResponse | undefined {
  return messages[0];
}

/** Creates a no-op logger that retains selected debug events for assertions. */
function createLogger(debugMessages: string[]): ProjectAnalyzerLogger {
  return {
    debug(message): void {
      debugMessages.push(message);
    },
    error(): void {},
    info(): void {},
    warn(): void {}
  };
}

/** Creates one concrete callable under the workspace root. */
function createGraph(): ProjectGraph {
  const range = { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 7 };
  return {
    workspaceRoot: "/workspace",
    version: "engine-v1",
    generatedAt: "2026-07-14T00:00:00.000Z",
    nodes: [{
      id: "handler",
      kind: "function",
      name: "handler",
      qualifiedName: "Api.handler",
      filePath: "/workspace/src/handler.ts",
      range,
      selectionRange: range,
      language: "typescript"
    }],
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: 1,
      symbolCount: 1,
      edgeCount: 0
    }
  };
}
