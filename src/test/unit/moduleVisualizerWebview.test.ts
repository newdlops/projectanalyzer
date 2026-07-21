/**
 * Contract tests for the generated Module Flow Webview and its Host boundary.
 * They keep the single-canvas graph, keyed rendering, viewport controls, safe
 * text, stale-request guards, and snapshot lifecycle visible without VS Code.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { getModuleVisualizerHtml } from "../../webview/moduleVisualizer/moduleVisualizerHtml";

const nonce = "module-flow-test-nonce";

/** Builds the exact document installed in the editor panel with a stable CSP. */
function createDocument(): string {
  return getModuleVisualizerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    nonce
  });
}

/** Extracts the generated inline browser program and fails on HTML drift. */
function requireBrowserProgram(document: string): string {
  const match = document.match(new RegExp(
    `<script nonce="${nonce}">([\\s\\S]*?)<\\/script>`,
    "u"
  ));
  assert.ok(match, "the generated document must contain one nonce-protected program");
  return match[1];
}

/** Extracts the generated stylesheet so truncation and motion remain testable. */
function requireStyles(document: string): string {
  const match = document.match(/<style>([\s\S]*?)<\/style>/u);
  assert.ok(match, "the generated document must contain its Module Flow stylesheet");
  return match[1];
}

/** Reads an implementation boundary used only for non-runtime Host assertions. */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

test("generates one nonce-protected stage with HTML cards and SVG edges", () => {
  const document = createDocument();
  const program = requireBrowserProgram(document);
  const scriptTags = document.match(/<script\b[^>]*>/gu) ?? [];

  assert.equal(document.match(/id="module-stage"/gu)?.length, 1);
  assert.equal(document.match(/id="module-scene"/gu)?.length, 1);
  assert.equal(document.match(/id="module-nodes"/gu)?.length, 1);
  assert.equal(document.match(/id="module-edges"/gu)?.length, 1);
  assert.match(document, /<div id="module-stage"[\s\S]*<div id="module-scene"[\s\S]*<svg id="module-edges"[\s\S]*<div id="module-nodes"/u);
  assert.deepEqual(scriptTags, [`<script nonce="${nonce}">`]);
  assert.match(
    document,
    /default-src 'none'; style-src vscode-webview: 'unsafe-inline'; script-src 'nonce-module-flow-test-nonce';/u
  );
  assert.match(program, /document\.createElement\("button"\)/u);
  assert.match(program, /document\.createElementNS\(SVG_NS, "path"\)/u);
  assert.match(program, /additions\.appendChild\(card\)/u);
  assert.match(program, /additions\.appendChild\(group\)/u);
  assert.match(program, /path\.setAttribute\("tabindex", "0"\)/u);
  assert.match(program, /event\.key !== "Enter" && event\.key !== " "/u);
  assert.doesNotMatch(program, /\bexports\./u);
  assert.doesNotMatch(program, /\brequire\s*\(/u);
  assert.doesNotThrow(
    () => new Function("acquireVsCodeApi", program),
    "the complete generated browser program must parse"
  );
});

test("embeds the shared layout, SCC, and orthogonal routing runtime", () => {
  const program = requireBrowserProgram(createDocument());

  assert.match(program, /function createModuleFlowGraphLayout\(/u);
  assert.match(program, /function createModuleFlowSccIndex\(/u);
  assert.match(program, /function routeModuleFlowGraphEdges\(/u);
  assert.match(program, /function createModuleFlowEdgeBridges\(/u);
  assert.match(program, /function createModuleFlowEdgePath\(/u);
  assert.match(program, /createModuleFlowGraphLayout\(layoutNodes, layoutEdges\)/u);
  assert.match(program, /reconcileModuleFlowEdges\(layout, scene\.edges\)/u);
  assert.match(program, /reconcileModuleFlowNodes\(layout, scene\.nodes, depthByModuleId\)/u);
  assert.match(program, /state\.layoutCache\.get\(layoutKey\)/u);
});

test("attaches entry function logic to the existing Module Flow scene", () => {
  const program = requireBrowserProgram(createDocument());
  const panelSource = readSource(
    "src/webview/moduleVisualizer/moduleVisualizerPanelProvider.ts"
  );

  assert.match(
    program,
    /node\.expandable && node\.expandable\.boundaryFunctions\s*\? "boundaryFunctions"/u
  );
  assert.match(program, /post\("moduleFlow\/expand"/u);
  assert.match(program, /state\.expansions\.retain\([\s\S]*pending\.key,[\s\S]*payload/u);
  assert.match(
    program,
    /function collectScene\(\)[\s\S]*for \(const expansion of state\.expansions\.values\(\)\)[\s\S]*nodes\.set\(node\.id, node\)[\s\S]*edges\.set\(edge\.id, edge\)/u
  );
  assert.match(
    program,
    /if \(node\.kind === "function"\)[\s\S]*renderFunctionDetail\(node\);[\s\S]*toggleFunctionLogic\(node\)/u
  );
  assert.match(program, /post\("moduleFlow\/functionLogic"/u);
  assert.match(program, /createModuleFlowFunctionLogicScene\(payload\)/u);
  assert.match(
    program,
    /state\.expansions\.retain\([\s\S]*pending\.key,[\s\S]*expansion,[\s\S]*\[ownerExpansionKey\]/u
  );
  assert.match(panelSource, /new ModuleFlowFunctionLogicDelivery\(/u);
  assert.match(panelSource, /type: "moduleFlow\/functionLogicLoaded"/u);
  assert.doesNotMatch(panelSource, /openFunction/u);
  assert.doesNotMatch(program, /window\.open|createWebviewPanel/u);
});

test("keeps attached component graphs scoped to the clicked module", () => {
  const program = requireBrowserProgram(createDocument());

  assert.match(program, /function selectModuleFlowComponentFocus\(/u);
  assert.match(program, /function focusModuleComponents\(moduleId, moduleNode\)/u);
  assert.match(
    program,
    /const focus = focusModuleComponents\(module\.id, module\);[\s\S]*post\("moduleFlow\/expand"/u
  );
  assert.match(
    program,
    /pending\.operation === "expand"[\s\S]*pending\.expansion === "boundaryFunctions"[\s\S]*pending\.moduleId !== moduleId/u
  );
  assert.match(program, /state\.pending\.delete\(requestId\)/u);
  assert.match(program, /renderGraph\(anchor, focus\.focusChanged \|\| focus\.removedBranchCount > 0\)/u);
});

test("shows only the selected module lineage and restores the initial scene", () => {
  const document = createDocument();
  const program = requireBrowserProgram(document);

  assert.match(program, /function createModuleFlowLineageScene\(/u);
  assert.match(
    program,
    /return createModuleFlowLineageScene\([\s\S]*state\.focusedModuleId,[\s\S]*Math\.max\(0, nodes\.size - 1\)/u
  );
  assert.match(program, /"focus:" \+ \(state\.focusedModuleId \|\| "initial"\)/u);
  assert.match(program, /function clearModuleFlowSelection\(\)/u);
  assert.match(
    program,
    /state\.focusedModuleId = undefined;[\s\S]*state\.expansions\.clear\(\);[\s\S]*renderEmptyDetail\(\);[\s\S]*renderGraph\(undefined, hadSceneFocus\)/u
  );
  assert.match(program, /event\.key === "Escape"[\s\S]*clearModuleFlowSelection\(\)/u);
  assert.match(program, /state\.pan\.button === 0[\s\S]*!state\.pan\.moved/u);
  assert.match(document, /Click empty canvas space or press Escape to clear module focus/u);
});

test("preserves the clicked anchor and honors enter-motion preferences", () => {
  const document = createDocument();
  const program = requireBrowserProgram(document);
  const styles = requireStyles(document);

  assert.match(program, /const anchor = captureViewportAnchor\(module\.id\)/u);
  assert.match(
    program,
    /operation: "expand",[\s\S]*expansion: expansion,[\s\S]*key: key,[\s\S]*anchor: anchor,[\s\S]*moduleId: module\.id/u
  );
  assert.match(program, /const currentAnchor = captureViewportAnchor\(pending\.moduleId\) \|\| pending\.anchor/u);
  assert.match(program, /renderGraph\(currentAnchor, true\)/u);
  assert.match(program, /function restoreViewportAnchor\(anchor, layout\)/u);
  assert.match(program, /dom\.viewport\.scrollLeft = clampModuleFlowScroll\(nextLeft, frame\.maxScrollLeft\)/u);
  assert.match(program, /dom\.viewport\.scrollTop = clampModuleFlowScroll\(nextTop, frame\.maxScrollTop\)/u);
  assert.match(
    styles,
    /\.module-card\.entering\s*\{\s*animation: module-node-enter 260ms/u
  );
  assert.match(
    styles,
    /\.module-edge\.entering\s*\{\s*animation: module-edge-enter 260ms/u
  );
  assert.match(styles, /animation-delay: calc\(var\(--entry-order, 0\) \* 16ms\)/u);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.module-card\.entering,[\s\S]*\.module-edge\.entering,[\s\S]*\.module-edge-direction\.entering\s*\{ animation: none; \}/u
  );
});

test("renders crossed edges as curved bridges with local direction cues", () => {
  const document = createDocument();
  const program = requireBrowserProgram(document);
  const styles = requireStyles(document);

  assert.match(program, /const bridges = edgeLayout\.bridges \|\| \[\]/u);
  assert.match(program, /createModuleFlowEdgePath\(edgeLayout\.points, bridges\)/u);
  assert.match(program, /createModuleFlowBridgeDirectionPath\(edgeLayout\.points, bridges\)/u);
  assert.match(program, /record\.direction\.setAttribute\("d", directionData\)/u);
  assert.match(program, /crossed line/u);
  assert.match(program, /marker\.setAttribute\("markerWidth", "8"\)/u);
  assert.match(styles, /\.module-edge-direction\s*\{[\s\S]*paint-order: stroke fill;/u);
  assert.match(styles, /\.module-edge-direction\.selected\s*\{/u);
});

test("offers focal zoom, fit, keyboard controls, resize preservation, and drag pan", () => {
  const document = createDocument();
  const program = requireBrowserProgram(document);

  assert.match(document, /id="zoom-out"[^>]*aria-label="Zoom out"/u);
  assert.match(document, /id="zoom-level"[^>]*>100%<\/button>/u);
  assert.match(document, /id="zoom-in"[^>]*aria-label="Zoom in"/u);
  assert.match(document, /id="module-viewport"[^>]*role="region"[^>]*tabindex="0"/u);
  assert.match(program, /createModuleFlowFocalZoom\(/u);
  assert.match(program, /createModuleFlowFitScale\(/u);
  assert.match(program, /addEventListener\("wheel", handleModuleFlowWheel, \{ passive: false \}\)/u);
  assert.match(program, /if \(!event\.ctrlKey && !event\.metaKey\) return;\s*event\.preventDefault\(\)/u);
  assert.match(program, /event\.key === "f" \|\| event\.key === "F"/u);
  assert.match(program, /new ResizeObserver\(handleModuleFlowResize\)/u);
  assert.match(program, /handleModuleFlowPointerMove/u);
  assert.match(program, /Math\.abs\(event\.clientX - state\.pan\.startX\) > 4/u);
  assert.match(program, /dom\.scene\.style\.transform = "translate3d\("/u);
});

test("coalesces visual writes and reuses keyed graph DOM outside structural changes", () => {
  const program = requireBrowserProgram(createDocument());

  assert.match(program, /new ModuleFlowFrameScheduler\(/u);
  assert.match(program, /new ModuleFlowExpansionStore\(500, 1000\)/u);
  assert.match(program, /new ModuleFlowLayoutCache\(2\)/u);
  assert.match(program, /state\.detailRequestTimer = window\.setTimeout/u);
  assert.match(program, /\}, 60\);/u);
  assert.match(program, /state\.expansions\.retain\(/u);
  assert.match(program, /retention\.evictedKeys\.length/u);
  assert.match(program, /state\.frameScheduler\.schedule\(\)/u);
  assert.match(program, /nodeElementsById: new Map\(\)/u);
  assert.match(program, /edgeElementsById: new Map\(\)/u);
  assert.match(program, /cycleElementsById: new Map\(\)/u);
  assert.match(program, /document\.createDocumentFragment\(\)/u);
  assert.match(program, /renderGraph\(undefined, false\)/u);
  assert.doesNotMatch(program, /dom\.(?:nodes|edges|cycles)\.replaceChildren\(/u);
  assert.match(
    program,
    /function applyPendingModuleFlowZoom\(pending\)[\s\S]*?applyModuleFlowViewportFrame\(layout\)[\s\S]*?updateModuleFlowZoomControls\(pending\.announce\)/u
  );
  assert.doesNotMatch(
    program,
    /function applyPendingModuleFlowZoom\(pending\)[\s\S]*?createModuleFlowGraphLayout\(/u
  );
  assert.match(program, /const layoutKey = state\.baseSceneKey/u);
  assert.doesNotMatch(program, /JSON\.stringify\(\[layoutNodes, layoutEdges\]\)/u);
});

test("releases hidden Webview resources and rehydrates from Host projection state", () => {
  const program = requireBrowserProgram(createDocument());
  const panelSource = readSource(
    "src/webview/moduleVisualizer/moduleVisualizerPanelProvider.ts"
  );

  assert.match(panelSource, /retainContextWhenHidden: false/u);
  assert.match(panelSource, /onDidChangeViewState[\s\S]*this\.webviewReady = false/u);
  assert.match(
    panelSource,
    /case "ui\/ready":[\s\S]*if \(this\.pendingGraph\)[\s\S]*this\.publishActiveScene\(\)/u
  );
  assert.match(panelSource, /private async publishActiveScene\(\): Promise<void>/u);
  assert.match(program, /state\.frameScheduler\.dispose\(\)/u);
  assert.match(program, /state\.resizeObserver\.disconnect\(\)/u);
});

test("keeps complete labels and mounts all Host text through textContent", () => {
  const document = createDocument();
  const program = requireBrowserProgram(document);
  const styles = requireStyles(document);

  assert.match(
    styles,
    /\.module-card-title\s*\{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/u
  );
  assert.match(
    styles,
    /\.module-card-detail,[\s\S]*?\.module-card-metric\s*\{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/u
  );
  assert.doesNotMatch(styles, /\btext-overflow\s*:/u);
  assert.doesNotMatch(styles, /(?:-webkit-)?line-clamp\s*:/u);
  assert.doesNotMatch(document, /…/u);
  assert.match(program, /element\.textContent = value == null \? "" : String\(value\)/u);
  assert.match(program, /label\.textContent = labelValue/u);
  assert.match(program, /dom\.status\.textContent = value \|\| ""/u);
  assert.doesNotMatch(program, /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/u);
});

test("guards stale graph requests and clears every panel snapshot authority", () => {
  const program = requireBrowserProgram(createDocument());
  const panelSource = readSource(
    "src/webview/moduleVisualizer/moduleVisualizerPanelProvider.ts"
  );

  assert.match(program, /payload\.graphVersion !== state\.graphVersion/u);
  assert.match(program, /payload\.requestId < state\.latestListRequestId/u);
  assert.match(
    program,
    /const pending = state\.pending\.get\(payload\.requestId\);\s*if \(!pending \|\| pending\.operation !== "expand"\) return;/u
  );
  assert.match(
    panelSource,
    /this\.graphDelivery\.matches\(request\.graphVersion\)[\s\S]*this\.projection\.matches\(request\.graphVersion\)/u
  );
  assert.match(panelSource, /"staleGraph"/u);
  assert.match(panelSource, /this\.logicEvidenceTokens\.activate\(activation\.snapshot\.version, graph\)/u);
  assert.match(panelSource, /this\.projection\.activate\(activation\.snapshot\.version, graph\)/u);
  assert.match(
    panelSource,
    /private disposePanelState\(\): void \{[\s\S]*this\.pendingGraph = undefined;[\s\S]*this\.graphDelivery\.clear\(\);[\s\S]*this\.projection\.clear\(\);[\s\S]*this\.sourceNodeTokens\.clear\(\);[\s\S]*this\.evidenceTokens\.clear\(\);/u
  );
  assert.match(panelSource, /this\.functionLogicDelivery\.clear\(\)/u);
  assert.match(panelSource, /this\.logicEvidenceTokens\.clear\(\)/u);
});
