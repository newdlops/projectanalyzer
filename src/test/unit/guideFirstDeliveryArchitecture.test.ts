/**
 * Architecture guard for guide-first delivery. It prevents a future sidebar
 * refactor from rebuilding and posting the large Function Index during initial
 * graph publication instead of waiting for an explicit disclosure request.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(__dirname, "../../..");

test("initial graph publication sends a bounded shell and guide without lazy details", () => {
  const providerPath = path.join(projectRoot, "src", "webview", "explorerViewProvider.ts");
  const source = fs.readFileSync(providerPath, "utf8");
  const readingGuideDeliverySource = fs.readFileSync(
    path.join(
      projectRoot,
      "src",
      "webview",
      "projectReadingGuide",
      "projectReadingGuideHostDelivery.ts"
    ),
    "utf8"
  );
  const method = extractBetween(
    source,
    "public async publishGraph(graph: ProjectGraph): Promise<void>",
    "private async handleMessage(message: WebviewRequest): Promise<void>"
  );
  const scopeMethod = extractBetween(
    readingGuideDeliverySource,
    "public async publishScope(",
    "/** Records a lazy request rejected because another graph is now active. */"
  );

  assert.match(method, /projectGraphForSidebarShell\(graph\)/u);
  assert.match(method, /projectReadingGuideDelivery\.publishInitial\(graph, activation\.snapshot\.version\)/u);
  assert.match(method, /createGuidedTourPayload\(/u);
  assert.match(method, /guidedTourDelivery\.publish\(guidedTour\)/u);
  assert.doesNotMatch(method, /projectGraphForSidebar\(graph\)/u);
  assert.doesNotMatch(method, /publishFunctionIndex\(graph/u);
  assert.doesNotMatch(method, /publishProjectOverview/u);
  assert.match(source, /case "project\/readingGuideScope"/u);
  assert.match(source, /case "graph\/loadStructure"/u);
  assert.match(source, /case "project\/loadOverview"/u);
  assert.match(source, /case "function\/index"/u);
  assert.match(source, /graphDelivery\.matches\(request\.graphVersion\)/u);
  assert.match(scopeMethod, /type: "project\/readingGuideScopeFailed"/u);
  assert.match(scopeMethod, /graphVersion: snapshot\.version,\s+scopeId/u);
  assert.doesNotMatch(scopeMethod, /type: "error"/u);
});

/** Extracts a stable source region and fails clearly when method boundaries drift. */
function extractBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}
