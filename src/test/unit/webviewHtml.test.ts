/**
 * Unit tests for generated Webview HTML. These guard the graph browser shell
 * without needing a live VS Code Webview runtime.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getExplorerHtml } from "../../webview/webviewHtml";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

test("graph panel HTML exposes canvas viewer controls", () => {
  const html = getExplorerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    extensionUri: {} as never,
    nonce: "nonce",
    defaultDepth: 2,
    maxRenderedNodes: 37,
    initialMode: "file",
    surface: "panel"
  });
  const scriptMatch = html.match(/<script nonce="nonce">([\s\S]*)<\/script>/);

  assert.match(html, /id="graph-canvas"/);
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /id="fit-view"/);
  assert.match(html, /id="center-view"/);
  assert.match(html, /resize: both/);
  assert.ok(scriptMatch, "missing graph panel script");

  const script = scriptMatch[1];

  assert.match(script, /handleGraphClick/);
  assert.match(script, /getSceneBounds/);
  assert.match(script, /screenToCanvas/);
  assert.match(script, /expandedGraphNodeIds: createDefaultExpandedNodeIds/);
  assert.match(script, /getApplicationEntryChildren/);
  assert.match(script, /getImportedFileChildren/);
  assert.match(script, /const maxNodes = 37/);
  assert.match(script, /const stack = \[\{ nodeId: rootNodeId \}\]/);
  assert.equal(script.match(/appendProgressiveBranch\(/g)?.length, 2);
  assert.doesNotThrow(() => new Function("acquireVsCodeApi", script));
});

test("sidebar HTML starts with a bounded reading guide and lazy detail disclosures", () => {
  const html = getExplorerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    extensionUri: {} as never,
    nonce: "nonce",
    defaultDepth: 2,
    maxRenderedNodes: 500,
    initialMode: "file",
    surface: "sidebar"
  });
  const scriptMatch = html.match(/<script nonce="nonce">([\s\S]*)<\/script>/);

  assert.ok(scriptMatch, "missing sidebar script");
  assert.match(html, /role="tree"/);
  assert.match(html, /Project import tree/);
  assert.match(html, /Project reading plan/);
  assert.match(html, /Project Reading Plan/);
  assert.match(html, /id="guide-summary"/);
  assert.match(html, /id="guide-scopes"/);
  assert.match(html, /id="guide-scope-detail"/);
  assert.match(html, /<details class="more-actions">/);
  assert.doesNotMatch(html, /Graph Disabled/);
  assert.doesNotMatch(html, /id="open-graph"/);
  assert.doesNotMatch(html, /id="cancel-analysis"/);
  assert.match(html, /id="project-brief"/);
  assert.match(html, /id="analysis-signals"/);
  assert.doesNotMatch(html, /id="language-summary"/);
  assert.doesNotMatch(html, /id="framework-summary"/);
  assert.match(html, /id="show-workspace"/);
  assert.match(html, /Workspace Scope/);
  assert.match(html, /id="accordion-calls"/);
  assert.match(html, /id="accordion-structure"/);
  assert.match(html, /id="accordion-analysis"/);
  assert.equal((html.match(/class="accordion-header"/g) ?? []).length, 3);
  assert.match(html, /id="call-panel" class="accordion-panel calls-panel" hidden/);
  assert.match(html, /id="structure-panel" class="accordion-panel" hidden/);
  assert.match(html, /id="analysis-panel" class="accordion-panel analysis-panel" hidden/);
  assert.match(html, /Explore Code Flows/);
  assert.match(html, /Browse Structure/);
  assert.match(html, /Analysis Details/);
  assert.match(html, /id="structure-frameworks"/);
  assert.match(html, /id="structure-files"/);
  assert.match(html, /id="framework-tree"/);
  assert.match(html, /Framework semantic tree/);
  assert.match(html, /id="call-tree"/);
  assert.match(html, /Code flow tree/);
  assert.match(html, /id="function-search-input"/);
  assert.match(html, /id="function-search-input"[\s\S]*maxlength="512"/u);
  assert.match(html, /Search all analyzed functions/);
  assert.match(html, /id="function-search-more"/);
  assert.match(scriptMatch[1], /createImportTreeIndex/);
  assert.match(scriptMatch[1], /createFrameworkTreeRows/);
  assert.doesNotMatch(scriptMatch[1], /createFunctionFlowTreeRows/);
  assert.doesNotMatch(scriptMatch[1], /createFunctionUniverse/);
  assert.doesNotMatch(scriptMatch[1], /createAllFunctionsInventoryRows/);
  assert.doesNotMatch(scriptMatch[1], /createFunctionFlowRowsWithInventory/);
  assert.match(scriptMatch[1], /function\/indexLoaded/);
  assert.match(scriptMatch[1], /function\/index/);
  assert.match(scriptMatch[1], /function\/searchLoaded/);
  assert.match(scriptMatch[1], /function\/searchFailed/);
  assert.match(scriptMatch[1], /postRequest\("function\/search"/);
  assert.match(scriptMatch[1], /FUNCTION_SEARCH_PAGE_SIZE = 50/);
  assert.match(scriptMatch[1], /openSourceOnClick/);
  assert.match(scriptMatch[1], /expandedAccordionSections/);
  assert.match(scriptMatch[1], /expandedAccordionSections: new Set\(\)/);
  assert.match(scriptMatch[1], /requestFunctionIndex/);
  assert.match(scriptMatch[1], /functionIndexRequestVersion/);
  assert.match(scriptMatch[1], /function-flows:framework-handlers/);
  assert.match(scriptMatch[1], /functionIndexLoading/);
  assert.match(scriptMatch[1], /selectedFunctionId: undefined/);
  assert.match(scriptMatch[1], /functionId: row\.functionId/);
  assert.match(scriptMatch[1], /getConcreteFunctionId/);
  assert.match(scriptMatch[1], /selectedFunctionId: state\.selectedFunctionId/);
  assert.match(scriptMatch[1], /emits at most one Function Index refresh request/);
  assert.match(scriptMatch[1], /Loading request flows/);
  assert.match(scriptMatch[1], /renderAccordionSections/);
  assert.match(scriptMatch[1], /renderVirtualTree/);
  assert.match(scriptMatch[1], /VIRTUAL_TREE_ROW_HEIGHT/);
  assert.match(scriptMatch[1], /clearAccordionPanel/);
  assert.ok(scriptMatch[1].includes("graph/showWorkspaceScope"));
  assert.doesNotMatch(scriptMatch[1], /graph\/openPanel/);
  assert.match(scriptMatch[1], /childrenByImporterId/);
  assert.match(scriptMatch[1], /tree-file-icon/);
  assert.match(scriptMatch[1], /aria-expanded/);
  assert.match(scriptMatch[1], /project\/overviewLoaded/);
  assert.match(scriptMatch[1], /project\/loadOverview/);
  assert.match(scriptMatch[1], /graph\/loadStructure/);
  assert.match(scriptMatch[1], /graph\/structureLoaded/);
  assert.doesNotMatch(scriptMatch[1], /postRequest\("graph\/load",/);
  assert.match(scriptMatch[1], /structureGraph: undefined/);
  assert.match(scriptMatch[1], /structureRequestVersion/);
  assert.match(scriptMatch[1], /projectOverviewRequestVersion/);
  assert.match(scriptMatch[1], /Loading project structure/);
  assert.match(scriptMatch[1], /createFrameworkTreeRows\(graph\)/);
  assert.match(scriptMatch[1], /createFileTreeRows\(graph\)/);
  assert.doesNotMatch(scriptMatch[1], /createFrameworkTreeRows\(state\.graph\)/);
  assert.doesNotMatch(scriptMatch[1], /createFileTreeRows\(state\.graph\)/);
  assert.match(scriptMatch[1], /project\/readingGuideLoaded/);
  assert.match(scriptMatch[1], /project\/readingGuideScopeLoaded/);
  assert.match(scriptMatch[1], /project\/readingGuideScope/);
  assert.match(scriptMatch[1], /isCurrentGraphVersion/);
  assert.match(scriptMatch[1], /slice\(0, 3\)/);
  assert.match(scriptMatch[1], /slice\(0, 5\)/);
  assert.match(scriptMatch[1], /Recommended entrypoints/);
  assert.match(scriptMatch[1], /formatArchitectureLayer/);
  assert.match(scriptMatch[1], /Workflow bridge candidate found · low confidence/);
  assert.match(scriptMatch[1], /low-confidence topology/);
  assert.match(html, /Candidate does not mean pure or business-critical/);
  assert.match(scriptMatch[1], /area\.representativeFilePaths/);
  assert.match(scriptMatch[1], /guide-area-file/);
  assert.doesNotMatch(scriptMatch[1], /file\.addEventListener/);
  assert.match(scriptMatch[1], /step\.sourceLocation/);
  assert.match(scriptMatch[1], /step\.sourceLocationKind === "callsite"/);
  assert.match(scriptMatch[1], /step\.sourceLocationKind === "evidence"/);
  assert.match(scriptMatch[1], /step\.sourceToken/);
  assert.match(scriptMatch[1], /guide-step-location/);
  assert.match(scriptMatch[1], /renderProjectOverview/);
  assert.match(scriptMatch[1], /appendOverviewFact/);
  assert.match(scriptMatch[1], /appendOverviewSignal/);
  assert.match(scriptMatch[1], /Opening signal evidence/);
  assert.match(scriptMatch[1], /node\/openSource/);
  assert.match(scriptMatch[1], /renderFrameworkTree/);
  assert.match(scriptMatch[1], /renderFunctionCallTree/);
  assert.match(scriptMatch[1], /renderStructureTree/);
  assert.match(scriptMatch[1], /getDetectedFrameworks/);
  assert.match(scriptMatch[1], /getFrameworkUnits/);
  assert.match(scriptMatch[1], /getFrameworkUnitEdges/);
  assert.match(scriptMatch[1], /createFrameworkRelationEdgeIndex/);
  assert.match(scriptMatch[1], /appendDjangoModelBucketRow/);
  assert.match(scriptMatch[1], /displayKind: "subclass"/);
  assert.doesNotMatch(scriptMatch[1], /graph\/focusNode/);
  assert.match(scriptMatch[1], /getFileName/);
  assert.match(scriptMatch[1], /external module usage/);
  assert.doesNotMatch(scriptMatch[1], /insertFileNode/);
  assert.doesNotThrow(() => new Function("acquireVsCodeApi", scriptMatch[1]));
});

test("sidebar loads structure and analysis details once per graph version", () => {
  const html = getExplorerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    extensionUri: {} as never,
    nonce: "nonce",
    defaultDepth: 2,
    maxRenderedNodes: 500,
    initialMode: "file",
    surface: "sidebar"
  });
  const scriptMatch = html.match(/<script nonce="nonce">([\s\S]*)<\/script>/);

  assert.ok(scriptMatch, "missing sidebar script");
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(scriptMatch[1])();

    assert.deepEqual(
      runtime.messages.map((message) => message.type),
      ["ui/ready"]
    );

    runtime.dispatchMessage(createSidebarGraph("graph-v1", "ShellFramework", "shell-only.ts"));
    assert.equal(countSidebarRequests(runtime.messages, "function/index"), 0);
    assert.equal(countSidebarRequests(runtime.messages, "graph/loadStructure"), 0);
    assert.equal(countSidebarRequests(runtime.messages, "project/loadOverview"), 0);

    runtime.click("accordion-calls");
    runtime.click("accordion-structure");
    runtime.click("accordion-analysis");
    assert.equal(countSidebarRequests(runtime.messages, "function/index"), 1);
    assert.equal(countSidebarRequests(runtime.messages, "graph/loadStructure"), 1);
    assert.equal(countSidebarRequests(runtime.messages, "project/loadOverview"), 1);
    assert.ok(!runtime.textValues.includes("ShellFramework"));
    assert.ok(!runtime.textValues.includes("shell-only.ts"));

    // Closing and reopening while requests are in flight must not duplicate
    // any host-side projection.
    runtime.click("accordion-calls");
    runtime.click("accordion-calls");
    runtime.click("accordion-structure");
    runtime.click("accordion-structure");
    runtime.click("accordion-analysis");
    runtime.click("accordion-analysis");
    assert.equal(countSidebarRequests(runtime.messages, "function/index"), 1);
    assert.equal(countSidebarRequests(runtime.messages, "graph/loadStructure"), 1);
    assert.equal(countSidebarRequests(runtime.messages, "project/loadOverview"), 1);

    // All disclosures remain open, so a new immutable graph starts exactly one
    // request per disclosure without accepting the previous graph's replies.
    runtime.dispatchMessage(createSidebarGraph("graph-v2", "AnotherShell", "another-shell.ts"));
    assert.equal(countSidebarRequests(runtime.messages, "function/index"), 2);
    assert.equal(countSidebarRequests(runtime.messages, "graph/loadStructure"), 2);
    assert.equal(countSidebarRequests(runtime.messages, "project/loadOverview"), 2);

    runtime.dispatchMessage({
      type: "graph/structureLoaded",
      payload: createSidebarGraphPayload("graph-v1", "StaleFramework", "stale.ts")
    });
    runtime.dispatchMessage({
      type: "project/overviewLoaded",
      payload: createOverviewPayload("graph-v1", "Stale overview")
    });
    assert.ok(!runtime.textValues.includes("StaleFramework"));
    assert.ok(!runtime.textValues.includes("Stale overview"));

    runtime.dispatchMessage({
      type: "graph/structureLoaded",
      payload: createSidebarGraphPayload("graph-v2", "NestJS", "main.ts")
    });
    runtime.dispatchMessage({
      type: "project/overviewLoaded",
      payload: createOverviewPayload("graph-v2", "Current overview")
    });
    assert.ok(runtime.textValues.includes("NestJS"));
    assert.ok(runtime.textValues.includes("Current overview"));

    runtime.click("structure-files");
    assert.ok(runtime.textValues.includes("main.ts"));
    assert.equal(countSidebarRequests(runtime.messages, "function/index"), 2);
    assert.equal(countSidebarRequests(runtime.messages, "graph/loadStructure"), 2);
    assert.equal(countSidebarRequests(runtime.messages, "project/loadOverview"), 2);
  } finally {
    runtime.restore();
  }
});

test("sidebar searches the complete host function index in bounded pages", () => {
  const html = getExplorerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    extensionUri: {} as never,
    nonce: "nonce",
    defaultDepth: 2,
    maxRenderedNodes: 500,
    initialMode: "file",
    surface: "sidebar"
  });
  const scriptMatch = html.match(/<script nonce="nonce">([\s\S]*)<\/script>/);

  assert.ok(scriptMatch, "missing sidebar script");
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(scriptMatch[1])();
    runtime.dispatchMessage(createSidebarGraph("graph-search", "NestJS", "main.ts"));
    runtime.click("accordion-calls");
    runtime.setValue("function-search-input", "UserService");
    runtime.click("function-search-submit");

    const firstRequest = runtime.messages
      .filter((message) => message.type === "function/search")
      .at(-1);
    assert.deepEqual(firstRequest?.payload, {
      graphVersion: "graph-search",
      requestId: 1,
      query: "UserService",
      limit: 50,
      filters: {
        includeExternal: false,
        includeUnresolved: false
      }
    });

    runtime.dispatchMessage(createFunctionSearchPayload(
      "stale-graph",
      "UserService",
      "StaleService.load",
      undefined
    ));
    assert.ok(!runtime.textValues.includes("StaleService.load"));

    runtime.click("accordion-calls");
    runtime.dispatchMessage(createFunctionSearchPayload(
      "graph-search",
      "UserService",
      "UserService.load",
      "function-search:next"
    ));
    assert.ok(!runtime.textValues.includes("UserService.load"));

    runtime.click("accordion-calls");
    assert.ok(runtime.textValues.includes("UserService.load"));
    assert.ok(runtime.textValues.includes("1 of 2 matching functions"));
    const resultTitle = "Open source: UserService.load · src/user.service.ts:12 · service";
    runtime.clickByTitle(resultTitle);
    assert.deepEqual(
      runtime.messages.filter((message) => message.type === "node/openSource").at(-1)?.payload,
      { nodeId: "source-node:UserService.load" }
    );
    runtime.keydownByTitle(resultTitle, "Enter");
    assert.deepEqual(
      runtime.messages.filter((message) => message.type === "node/openSource").at(-1)?.payload,
      { nodeId: "source-node:UserService.load" }
    );

    runtime.setValue("function-search-input", "edited but not submitted");
    runtime.click("function-search-more");
    const nextRequest = runtime.messages
      .filter((message) => message.type === "function/search")
      .at(-1);
    assert.equal(
      (nextRequest?.payload as { cursor?: string } | undefined)?.cursor,
      "function-search:next"
    );
    assert.equal(
      (nextRequest?.payload as { query?: string } | undefined)?.query,
      "UserService"
    );
    assert.equal(
      (nextRequest?.payload as { requestId?: number } | undefined)?.requestId,
      2
    );

    runtime.dispatchMessage(createFunctionSearchPayload(
      "graph-search",
      "UserService",
      ["UserService.load", "UserService.save"],
      undefined,
      2
    ));
    assert.ok(runtime.textValues.includes("UserService.load"));
    assert.ok(runtime.textValues.includes("UserService.save"));
    assert.ok(runtime.textValues.includes("2 of 2 matching functions"));

    runtime.click("function-search-clear");
    runtime.setValue("function-search-input", "UserService");
    runtime.click("function-search-submit");
    const repeatedRequest = runtime.messages
      .filter((message) => message.type === "function/search")
      .at(-1);
    const repeatedRequestId = (
      repeatedRequest?.payload as { requestId?: number } | undefined
    )?.requestId;
    assert.equal(repeatedRequestId, 3);

    runtime.dispatchMessage(createFunctionSearchPayload(
      "graph-search",
      "UserService",
      "LateService.result",
      undefined,
      2
    ));
    assert.ok(!runtime.textValues.includes("LateService.result"));
    runtime.dispatchMessage(createFunctionSearchPayload(
      "graph-search",
      "UserService",
      "FreshService.result",
      undefined,
      repeatedRequestId
    ));
    assert.ok(runtime.textValues.includes("FreshService.result"));

    runtime.click("function-search-clear");
    runtime.setValue("function-search-input", "ErrorQuery");
    runtime.click("function-search-submit");
    runtime.dispatchMessage({
      type: "function/searchFailed",
      payload: {
        graphVersion: "graph-search",
        requestId: 4,
        query: "ErrorQuery",
        message: "Function search failed; try again"
      }
    });
    assert.ok(runtime.textValues.includes("Function search failed; try again"));
    runtime.click("function-search-submit");
    const retryRequest = runtime.messages
      .filter((message) => message.type === "function/search")
      .at(-1);
    assert.equal(
      (retryRequest?.payload as { requestId?: number } | undefined)?.requestId,
      5
    );

    runtime.click("function-search-clear");
    const requestCountBeforeOversized = countSidebarRequests(runtime.messages, "function/search");
    runtime.setValue("function-search-input", "x".repeat(513));
    runtime.click("function-search-submit");
    assert.equal(
      countSidebarRequests(runtime.messages, "function/search"),
      requestCountBeforeOversized
    );
    assert.ok(runtime.textValues.includes("Search text must be 512 characters or fewer"));
  } finally {
    runtime.restore();
  }
});

test("graph panel script renders a loaded graph without module-loader globals", () => {
  const html = getExplorerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    extensionUri: {} as never,
    nonce: "nonce",
    defaultDepth: 2,
    maxRenderedNodes: 500,
    initialMode: "file",
    surface: "panel"
  });
  const scriptMatch = html.match(/<script nonce="nonce">([\s\S]*)<\/script>/);

  assert.ok(scriptMatch, "missing graph panel script");
  const runtime = installGraphWebviewRuntime();

  try {
    new Function(scriptMatch[1])();

    assert.ok(runtime.messages.some((message) => message.type === "telemetry/log"));
    assert.deepEqual(
      runtime.messages
        .filter((message) => message.type !== "telemetry/log")
        .map((message) => message.type),
      ["ui/ready"]
    );
    runtime.dispatchMessage({
      type: "graph/loaded",
      payload: {
        workspaceRoot: "/workspace",
        version: "test",
        generatedAt: "2026-06-20T00:00:00.000Z",
        nodes: [
          createGraphNode("file-1", "file", "main.ts", "/workspace/src/main.ts"),
          createGraphNode("file-2", "file", "service.ts", "/workspace/src/service.ts")
        ],
        edges: [
          {
            id: "edge::imports::file-1::file-2",
            kind: "imports",
            sourceId: "file-1",
            targetId: "file-2",
            filePath: "/workspace/src/main.ts",
            confidence: "resolved"
          }
        ],
        diagnostics: [],
        metadata: {
          languages: ["typescript"],
          fileCount: 2,
          symbolCount: 2,
          edgeCount: 1
        }
      }
    });
    assert.ok(runtime.labels.includes("main.ts"));
    assert.ok(!runtime.labels.includes("service.ts"));
  } finally {
    runtime.restore();
  }
});

/** Counts one lazy sidebar request type without coupling tests to other traffic. */
function countSidebarRequests(
  messages: Array<{ type: string; payload: unknown }>,
  type: string
): number {
  return messages.filter((message) => message.type === type).length;
}

/** Creates the initial shell response used by the sidebar state-machine test. */
function createSidebarGraph(
  version: string,
  frameworkName: string,
  fileName: string
): { type: "graph/loaded"; payload: Record<string, unknown> } {
  return {
    type: "graph/loaded",
    payload: createSidebarGraphPayload(version, frameworkName, fileName)
  };
}

/** Creates a graph-shaped payload with one visible component and source file. */
function createSidebarGraphPayload(
  version: string,
  frameworkName: string,
  fileName: string
): Record<string, unknown> {
  return {
    workspaceRoot: "/workspace",
    version,
    generatedAt: "2026-07-13T00:00:00.000Z",
    nodes: [createGraphNode(`file:${fileName}`, "file", fileName, `/workspace/src/${fileName}`)],
    edges: [],
    diagnostics: [],
    metadata: {
      languages: [],
      frameworks: [{
        name: frameworkName,
        category: "backend",
        rootPath: ".",
        confidence: "resolved",
        evidence: []
      }],
      frameworkUnits: [],
      frameworkUnitEdges: [],
      fileCount: 1,
      symbolCount: 1,
      edgeCount: 0
    }
  };
}

/** Creates the smallest overview payload consumed by the injected renderer. */
function createOverviewPayload(graphVersion: string, value: string): Record<string, unknown> {
  return {
    graphVersion,
    facts: [{ label: "Scope", value, detail: "Current graph evidence" }],
    signals: [],
    omittedSignalCount: 0
  };
}

/** Creates one bounded function-search response consumed by the sidebar. */
function createFunctionSearchPayload(
  graphVersion: string,
  query: string,
  label: string | string[],
  nextCursor: string | undefined,
  requestId = 1
): Record<string, unknown> {
  const labels = Array.isArray(label) ? label : [label];
  return {
    type: "function/searchLoaded",
    payload: {
      graphVersion,
      requestId,
      query,
      rows: labels.map((rowLabel) => ({
        id: `function-search:${rowLabel}`,
        sectionId: "allFunctions",
        kind: "function",
        label: rowLabel,
        depth: 0,
        hasChildren: false,
        expanded: false,
        sourceToken: `source-node:${rowLabel}`,
        detail: "src/user.service.ts:12 · service",
        functionKind: "method",
        role: "service"
      })),
      totalMatchCount: 2,
      ...(nextCursor ? { nextCursor } : {})
    }
  };
}

/**
 * Installs enough browser API surface to execute the graph Webview script in
 * Node while still surfacing rendering-time exceptions.
 */
function installGraphWebviewRuntime(): {
  dispatchMessage: (message: unknown) => void;
  labels: string[];
  messages: Array<{ type: string; payload: unknown }>;
  restore: () => void;
} {
  const previousWindow = Reflect.get(globalThis, "window");
  const previousDocument = Reflect.get(globalThis, "document");
  const previousRequestAnimationFrame = Reflect.get(globalThis, "requestAnimationFrame");
  const previousGetComputedStyle = Reflect.get(globalThis, "getComputedStyle");
  const previousAcquireVsCodeApi = Reflect.get(globalThis, "acquireVsCodeApi");
  const messages: Array<{ type: string; payload: unknown }> = [];
  const labels: string[] = [];
  const listeners = new Map<string, (event: { data: unknown }) => void>();
  const elements = new Map<string, FakeElement>();
  const modeButtons = ["file", "call", "class"].map((mode) => createFakeElement(mode, labels));

  for (const button of modeButtons) {
    button.dataset.mode = button.id;
  }

  Reflect.set(globalThis, "window", {
    addEventListener(type: string, handler: (event: { data: unknown }) => void) {
      listeners.set(type, handler);
    },
    devicePixelRatio: 1,
    requestAnimationFrame(callback: FrameRequestCallback) {
      callback(0);
      return 0;
    },
    setTimeout(callback: () => void) {
      callback();
      return 1;
    }
  });
  Reflect.set(globalThis, "document", {
    getElementById(id: string) {
      const existing = elements.get(id);

      if (existing) {
        return existing;
      }

      const created = createFakeElement(id, labels);
      elements.set(id, created);
      return created;
    },
    querySelectorAll(selector: string) {
      return selector === ".mode-button" ? modeButtons : [];
    }
  });
  Reflect.set(globalThis, "requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  Reflect.set(globalThis, "getComputedStyle", () => ({
    getPropertyValue() {
      return "";
    }
  }));
  Reflect.set(globalThis, "acquireVsCodeApi", () => ({
    postMessage(message: { type: string; payload: unknown }) {
      messages.push(message);
    }
  }));

  return {
    dispatchMessage(message: unknown) {
      const handler = listeners.get("message");

      assert.ok(handler, "missing message listener");
      handler({ data: message });
    },
    labels,
    messages,
    restore() {
      restoreGlobal("window", previousWindow);
      restoreGlobal("document", previousDocument);
      restoreGlobal("requestAnimationFrame", previousRequestAnimationFrame);
      restoreGlobal("getComputedStyle", previousGetComputedStyle);
      restoreGlobal("acquireVsCodeApi", previousAcquireVsCodeApi);
    }
  };
}

/**
 * Creates a fake DOM element or canvas element for Webview runtime tests.
 */
function createFakeElement(id: string, labels: string[]): FakeElement {
  return {
    id,
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    dataset: {},
    textContent: "",
    addEventListener() {},
    focus() {},
    getBoundingClientRect() {
      return {
        bottom: 560,
        height: 560,
        left: 0,
        right: 960,
        top: 0,
        width: 960,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        }
      };
    },
    getContext() {
      return createFakeCanvasContext(labels);
    },
    hasPointerCapture() {
      return false;
    },
    releasePointerCapture() {},
    setPointerCapture() {}
  };
}

/**
 * Creates a symbol node payload accepted by the graph browser script.
 */
function createGraphNode(id: string, kind: string, name: string, filePath: string): Record<string, unknown> {
  return {
    id,
    kind,
    name,
    qualifiedName: name,
    filePath,
    range: {
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: 0
    },
    selectionRange: {
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: 0
    },
    language: "typescript"
  };
}

/**
 * Restores or removes a global test shim.
 */
function restoreGlobal(name: string, value: unknown): void {
  if (value === undefined) {
    Reflect.deleteProperty(globalThis, name);
    return;
  }

  Reflect.set(globalThis, name, value);
}

/**
 * Canvas context calls are not under test, but layout-time exceptions must
 * surface, so every context operation is a harmless callable placeholder.
 */
function createFakeCanvasContext(labels: string[]): CanvasRenderingContext2D {
  return new Proxy<Record<PropertyKey, unknown>>({}, {
    get(target, property) {
      if (property === "fillText") {
        return (text: unknown) => {
          labels.push(String(text));
        };
      }

      if (!(property in target)) {
        target[property] = () => undefined;
      }

      return target[property];
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  }) as unknown as CanvasRenderingContext2D;
}

type FakeElement = {
  classList: {
    add: () => void;
    remove: () => void;
    toggle: () => void;
  };
  dataset: Record<string, string>;
  id: string;
  textContent: string;
  addEventListener: () => void;
  focus: () => void;
  getBoundingClientRect: () => DOMRect;
  getContext: () => CanvasRenderingContext2D;
  hasPointerCapture: () => boolean;
  releasePointerCapture: () => void;
  setPointerCapture: () => void;
};
