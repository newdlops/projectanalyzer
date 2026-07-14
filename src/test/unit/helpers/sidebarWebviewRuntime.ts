/**
 * Event-aware sidebar Webview runtime used by generated-script tests.
 * The helper owns fake DOM globals and restores them after each test, keeping
 * feature assertions independent from browser-emulation plumbing.
 */

import assert from "node:assert/strict";

/** Minimal sidebar runtime surface exposed to generated-script tests. */
export type SidebarWebviewRuntime = {
  click(elementId: string): void;
  clickByTitle(title: string): void;
  dispatchMessage(message: unknown): void;
  keydownByTitle(title: string, key: string): void;
  messages: Array<{ type: string; payload: unknown }>;
  restore(): void;
  setValue(elementId: string, value: string): void;
  textValues: string[];
};

/** Installs the small DOM and VS Code API surface used by the sidebar script. */
export function installSidebarWebviewRuntime(): SidebarWebviewRuntime {
  const previousWindow = Reflect.get(globalThis, "window");
  const previousDocument = Reflect.get(globalThis, "document");
  const previousRequestAnimationFrame = Reflect.get(globalThis, "requestAnimationFrame");
  const previousAcquireVsCodeApi = Reflect.get(globalThis, "acquireVsCodeApi");
  const messages: Array<{ type: string; payload: unknown }> = [];
  const textValues: string[] = [];
  const windowListeners = new Map<string, (event: { data: unknown }) => void>();
  const elementListeners = new Map<string, Map<string, SidebarEventHandler[]>>();
  const elements = new Map<string, SidebarFakeElement>();
  let generatedElementId = 0;

  /** Returns one persistent fake element because listeners attach by identity. */
  const getOrCreateElement = (id: string): SidebarFakeElement => {
    const existing = elements.get(id);
    if (existing) {
      return existing;
    }

    const listeners = new Map<string, SidebarEventHandler[]>();
    const classes = new Set<string>();
    const children: SidebarFakeElement[] = [];
    let textContent = "";
    const element: SidebarFakeElement = {
      id,
      children,
      className: "",
      classList: {
        add(...names) {
          for (const name of names) classes.add(name);
        },
        remove(...names) {
          for (const name of names) classes.delete(name);
        },
        toggle(name, force) {
          const enabled = force ?? !classes.has(name);
          if (enabled) classes.add(name);
          else classes.delete(name);
          return enabled;
        }
      },
      dataset: {},
      disabled: false,
      hidden: false,
      style: {},
      textContent: "",
      title: "",
      type: "",
      value: "",
      clientHeight: 220,
      scrollTop: 0,
      addEventListener(type, handler) {
        const handlers = listeners.get(type) ?? [];
        handlers.push(handler);
        listeners.set(type, handlers);
      },
      removeEventListener(type, handler) {
        const handlers = listeners.get(type) ?? [];
        listeners.set(type, handlers.filter((candidate) => candidate !== handler));
      },
      append(...appendedChildren) {
        children.push(...appendedChildren);
      },
      focus() {},
      querySelectorAll(selector) {
        if (selector !== ".explorer-tree") {
          return [];
        }
        if (id === "call-panel") {
          return [getOrCreateElement("call-tree")];
        }
        if (id === "structure-panel") {
          return [
            getOrCreateElement("framework-tree"),
            getOrCreateElement("explorer-tree")
          ];
        }
        return [];
      },
      replaceChildren(...replacementChildren) {
        children.splice(0, children.length, ...replacementChildren);
      },
      setAttribute() {}
    };

    Object.defineProperty(element, "textContent", {
      configurable: true,
      get() {
        return textContent;
      },
      set(value: string) {
        textContent = String(value);
        if (textContent) {
          textValues.push(textContent);
        }
      }
    });

    elementListeners.set(id, listeners);
    elements.set(id, element);
    return element;
  };

  Reflect.set(globalThis, "window", {
    addEventListener(type: string, handler: (event: { data: unknown }) => void) {
      windowListeners.set(type, handler);
    },
    requestAnimationFrame(callback: FrameRequestCallback) {
      callback(0);
      return 0;
    }
  });
  Reflect.set(globalThis, "document", {
    createElement(tagName: string) {
      generatedElementId += 1;
      return getOrCreateElement(`${tagName}:${generatedElementId}`);
    },
    getElementById(id: string) {
      return getOrCreateElement(id);
    }
  });
  Reflect.set(globalThis, "requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  Reflect.set(globalThis, "acquireVsCodeApi", () => ({
    postMessage(message: { type: string; payload: unknown }) {
      messages.push(message);
    }
  }));

  return {
    click(elementId) {
      const handlers = elementListeners.get(elementId)?.get("click") ?? [];
      assert.ok(handlers.length > 0, `missing click handler for ${elementId}`);
      for (const handler of handlers) {
        handler({ preventDefault() {} });
      }
    },
    clickByTitle(title) {
      const element = [...elements.values()].find((candidate) => candidate.title === title);
      assert.ok(element, `missing element titled ${title}`);
      const handlers = elementListeners.get(element.id)?.get("click") ?? [];
      assert.ok(handlers.length > 0, `missing click handler for ${title}`);
      for (const handler of handlers) {
        handler({ preventDefault() {} });
      }
    },
    dispatchMessage(message) {
      const handler = windowListeners.get("message");
      assert.ok(handler, "missing sidebar message listener");
      handler({ data: message });
    },
    keydownByTitle(title, key) {
      const element = [...elements.values()].find((candidate) => candidate.title === title);
      assert.ok(element, `missing element titled ${title}`);
      const handlers = elementListeners.get(element.id)?.get("keydown") ?? [];
      assert.ok(handlers.length > 0, `missing keydown handler for ${title}`);
      for (const handler of handlers) {
        handler({ key, preventDefault() {} });
      }
    },
    messages,
    restore() {
      restoreGlobal("window", previousWindow);
      restoreGlobal("document", previousDocument);
      restoreGlobal("requestAnimationFrame", previousRequestAnimationFrame);
      restoreGlobal("acquireVsCodeApi", previousAcquireVsCodeApi);
    },
    setValue(elementId, value) {
      getOrCreateElement(elementId).value = value;
    },
    textValues
  };
}

/** Restores or removes one global browser shim. */
function restoreGlobal(name: string, value: unknown): void {
  if (value === undefined) {
    Reflect.deleteProperty(globalThis, name);
    return;
  }
  Reflect.set(globalThis, name, value);
}

type SidebarEventHandler = (event: { preventDefault: () => void; key?: string }) => void;

type SidebarFakeElement = {
  id: string;
  children: SidebarFakeElement[];
  className: string;
  classList: {
    add: (...names: string[]) => void;
    remove: (...names: string[]) => void;
    toggle: (name: string, force?: boolean) => boolean;
  };
  dataset: Record<string, string>;
  disabled: boolean;
  hidden: boolean;
  style: Record<string, string>;
  textContent: string;
  title: string;
  type: string;
  value: string;
  clientHeight: number;
  scrollTop: number;
  addEventListener: (type: string, handler: SidebarEventHandler) => void;
  removeEventListener: (type: string, handler: SidebarEventHandler) => void;
  append: (...children: SidebarFakeElement[]) => void;
  focus: () => void;
  querySelectorAll: (selector: string) => SidebarFakeElement[];
  replaceChildren: (...children: SidebarFakeElement[]) => void;
  setAttribute: (name: string, value: string) => void;
};
