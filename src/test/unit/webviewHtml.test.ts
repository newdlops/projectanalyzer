/**
 * Unit tests for generated Webview HTML. These guard the graph browser shell
 * without needing a live VS Code Webview runtime.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getExplorerHtml } from "../../webview/webviewHtml";

test("graph panel HTML exposes canvas viewer controls", () => {
  const html = getExplorerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    extensionUri: {} as never,
    nonce: "nonce",
    defaultDepth: 2,
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
  assert.doesNotThrow(() => new Function("acquireVsCodeApi", script));
});

test("sidebar HTML renders file navigation as an import tree", () => {
  const html = getExplorerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    extensionUri: {} as never,
    nonce: "nonce",
    defaultDepth: 2,
    initialMode: "file",
    surface: "sidebar"
  });
  const scriptMatch = html.match(/<script nonce="nonce">([\s\S]*)<\/script>/);

  assert.ok(scriptMatch, "missing sidebar script");
  assert.match(html, /role="tree"/);
  assert.match(html, /Project import tree/);
  assert.match(html, /Detected project stack/);
  assert.match(html, /id="language-summary"/);
  assert.match(html, /id="framework-summary"/);
  assert.match(html, /id="show-workspace"/);
  assert.match(html, /Workspace Scope/);
  assert.match(html, /Graph Disabled/);
  assert.match(html, /id="accordion-frameworks"/);
  assert.match(html, /id="accordion-calls"/);
  assert.match(html, /id="accordion-files"/);
  assert.match(html, /aria-controls="framework-panel"/);
  assert.match(html, /id="framework-tree"/);
  assert.match(html, /Framework semantic tree/);
  assert.match(html, /id="call-tree"/);
  assert.match(html, /Function call tree/);
  assert.match(html, /Function Calls/);
  assert.match(html, /Files/);
  assert.match(scriptMatch[1], /createImportTreeIndex/);
  assert.match(scriptMatch[1], /createFrameworkTreeRows/);
  assert.match(scriptMatch[1], /createFunctionCallTreeRows/);
  assert.match(scriptMatch[1], /expandedAccordionSections/);
  assert.match(scriptMatch[1], /renderAccordionSections/);
  assert.ok(scriptMatch[1].includes("graph/showWorkspaceScope"));
  assert.doesNotMatch(scriptMatch[1], /graph\/openPanel/);
  assert.match(scriptMatch[1], /Called by/);
  assert.match(scriptMatch[1], /String\(counts\.outgoing\)/);
  assert.match(scriptMatch[1], /childrenByImporterId/);
  assert.match(scriptMatch[1], /tree-file-icon/);
  assert.match(scriptMatch[1], /aria-expanded/);
  assert.match(scriptMatch[1], /renderProjectSummary/);
  assert.match(scriptMatch[1], /renderFrameworkTree/);
  assert.match(scriptMatch[1], /renderFunctionCallTree/);
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

test("graph panel script renders a loaded graph without module-loader globals", () => {
  const html = getExplorerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    extensionUri: {} as never,
    nonce: "nonce",
    defaultDepth: 2,
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
