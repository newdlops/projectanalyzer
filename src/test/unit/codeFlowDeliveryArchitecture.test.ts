/**
 * Architecture guards for the production CodeFlow delivery path. They ensure
 * graph publication cannot silently restore the retired guide/dashboard UX.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(__dirname, "../../..");

test("initial publication sends a bounded shell followed by the CodeFlow catalog", () => {
  const provider = readSource("src/webview/explorerViewProvider.ts");
  const publishGraph = extractBetween(
    provider,
    "public async publishGraph(graph: ProjectGraph): Promise<void>",
    "private async handleMessage(message: WebviewRequest): Promise<void>"
  );

  assert.match(publishGraph, /projectGraphForSidebarShell\(graph\)/u);
  assert.match(publishGraph, /codeFlowDelivery\.publishInitial\(graph, activation\.snapshot\.version\)/u);
  assert.doesNotMatch(publishGraph, /publishFunctionIndex|ProjectReadingGuide|GuidedTour|ProjectOverview/u);
  assert.match(provider, /case "codeFlow\/catalog"/u);
  assert.match(provider, /case "codeFlow\/select"/u);
  assert.match(provider, /case "codeFlow\/selectSource"/u);
  assert.match(provider, /case "codeFlow\/openEvidence"/u);
  assert.doesNotMatch(provider, /case "project\/readingGuideScope"|case "project\/guidedTourOpenSource"/u);
  assert.doesNotMatch(provider, /case "graph\/loadStructure"|case "project\/loadOverview"/u);
});

test("CodeFlow owns its insight cache and Host delivery public boundary", () => {
  const provider = readSource("src/webview/explorerViewProvider.ts");
  const cache = readSource("src/application/codeFlow/codeFlowInsightCache.ts");
  const host = readSource("src/webview/codeFlow/codeFlowHostDelivery.ts");
  const publicSurface = readSource("src/webview/codeFlow/index.ts");

  assert.match(provider, /CodeFlowInsightCache/u);
  assert.doesNotMatch(provider, /ProjectInsightCache/u);
  assert.match(cache, /createSemanticFlowIndex/u);
  assert.match(cache, /createFunctionArchitectureIndex/u);
  assert.doesNotMatch(cache, /createProjectReadingGuide|createGuidedTourProjection|createProjectOverview/u);
  assert.match(host, /resolveActiveGraph/u);
  assert.match(host, /sourceNodeTokens\.createToken/u);
  assert.match(host, /analyzeFunctionLogic/u);
  assert.match(host, /createFunctionLogicCodeFlowDetail/u);
  assert.match(host, /evidenceTokens\.createToken/u);
  assert.match(host, /evidenceTokens\.resolve/u);
  assert.match(host, /this\.dependencies\.projectionOptions/u);
  assert.match(provider, /projectionOptions: dependencies\.config\.codeFlow/u);
  assert.match(publicSurface, /CodeFlowHostDelivery/u);
  assert.match(provider, /from "\.\/codeFlow"/u);
  assert.doesNotMatch(provider, /codeFlow\/codeFlowHostDelivery/u);
});

test("Function Logic graph layout stays pure, bounded, and iterative", () => {
  const layout = readSource("src/application/codeFlow/functionLogicGraphLayout.ts");

  assert.match(layout, /createFunctionLogicGraphLayout/u);
  assert.match(layout, /while \(readyIndex < ready\.length\)/u);
  assert.match(layout, /backEdgeIds/u);
  assert.match(layout, /isLongForwardEdge/u);
  assert.match(layout, /measureNodeDimensions/u);
  assert.match(layout, /createRankBounds/u);
  assert.match(layout, /CHANNEL_CONNECTOR_CLEARANCE/u);
  assert.doesNotMatch(layout, /const NODE_(?:WIDTH|HEIGHT)\s*=/u);
  assert.doesNotMatch(layout, /from ".*(?:webview|vscode|extension)/u);
  assert.doesNotMatch(layout, /createFunctionLogicGraphLayout\([^)]*\)[\s\S]*createFunctionLogicGraphLayout\(/u);
});

/** Reads one repository source file for a stable dependency-boundary assertion. */
function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

/** Extracts a method region and reports drift as a focused test failure. */
function extractBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}
