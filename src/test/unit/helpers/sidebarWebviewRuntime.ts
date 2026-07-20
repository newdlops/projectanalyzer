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
  countRenderedByClass(elementId: string, className: string): number;
  countRenderedByClassWithinClass(
    elementId: string,
    ancestorClassName: string,
    className: string
  ): number;
  dispatchRenderedEventByClass(
    elementId: string,
    className: string,
    type: string,
    event?: Record<string, unknown>
  ): boolean;
  dispatchMessage(message: unknown): void;
  getAttribute(elementId: string, name: string): string | undefined;
  getRenderedAttributeByClass(
    elementId: string,
    className: string,
    name: string
  ): string | undefined;
  getRenderedAttributeByTitle(
    elementId: string,
    title: string,
    name: string
  ): string | undefined;
  getFocusedElementId(): string | undefined;
  getPersistedState(): unknown;
  getRenderedPositionByTitle(
    elementId: string,
    title: string
  ): { left: number; top: number };
  getRenderedText(elementId: string): string[];
  getRenderedScrollByClass(elementId: string, className: string): { left: number; top: number };
  getRenderedStyleByClass(elementId: string, className: string, name: string): string;
  hasRenderedClassByTitle(elementId: string, title: string, className: string): boolean;
  isDisabled(elementId: string): boolean;
  isHidden(elementId: string): boolean;
  inputByTitle(title: string, value: string): void;
  keydown(elementId: string, key: string): void;
  keydownByClass(elementId: string, className: string, key: string): void;
  keydownByTitle(title: string, key: string): void;
  messages: Array<{ type: string; payload: unknown }>;
  restore(): void;
  setRenderedScrollByClass(
    elementId: string,
    className: string,
    scroll: { left: number; top: number }
  ): void;
  setValue(elementId: string, value: string): void;
  submit(elementId: string): void;
  textValues: string[];
};

/** Installs the small DOM and VS Code API surface used by the sidebar script. */
export function installSidebarWebviewRuntime(initialWebviewState?: unknown): SidebarWebviewRuntime {
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
  let webviewState = initialWebviewState;
  let focusedElementId: string | undefined;

  /** Returns one persistent fake element because listeners attach by identity. */
  const getOrCreateElement = (id: string): SidebarFakeElement => {
    const existing = elements.get(id);
    if (existing) {
      return existing;
    }

    const listeners = new Map<string, SidebarEventHandler[]>();
    const attributes = new Map<string, string>();
    const classes = new Set<string>();
    const children: SidebarFakeElement[] = [];
    const styles = new Map<string, string>();
    const capturedPointers = new Set<number>();
    let textContent = "";
    const element: SidebarFakeElement = {
      id,
      attributes,
      children,
      className: "",
      classList: {
        add(...names) {
          for (const name of names) classes.add(name);
        },
        remove(...names) {
          for (const name of names) classes.delete(name);
        },
        contains(name) {
          return classes.has(name);
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
      style: {
        getPropertyValue(name) {
          return styles.get(name) ?? "";
        },
        setProperty(name, value) {
          styles.set(name, value);
        }
      },
      textContent: "",
      title: "",
      type: "",
      value: "",
      clientWidth: 640,
      clientHeight: 220,
      scrollLeft: 0,
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
      removeChild(child) {
        const index = children.indexOf(child);
        if (index >= 0) {
          children.splice(index, 1);
        }
        return child;
      },
      focus() {
        focusedElementId = id;
      },
      closest() {
        return undefined;
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: element.clientWidth, height: element.clientHeight };
      },
      setPointerCapture(pointerId) {
        capturedPointers.add(pointerId);
      },
      hasPointerCapture(pointerId) {
        return capturedPointers.has(pointerId);
      },
      releasePointerCapture(pointerId) {
        capturedPointers.delete(pointerId);
      },
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
      setAttribute(name, value) {
        attributes.set(name, value);
        if (name === "class") {
          element.className = value;
        }
      }
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
    Object.defineProperty(element, "firstChild", {
      configurable: true,
      get() {
        return children[0];
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
    createElementNS(_namespace: string, tagName: string) {
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
    getState() {
      return webviewState;
    },
    postMessage(message: { type: string; payload: unknown }) {
      messages.push(message);
    },
    setState(nextState: unknown) {
      webviewState = nextState;
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
    countRenderedByClass(elementId, className) {
      return countDescendantsByClass(getOrCreateElement(elementId), className);
    },
    countRenderedByClassWithinClass(elementId, ancestorClassName, className) {
      const ancestor = findRenderedByClass(
        getOrCreateElement(elementId),
        ancestorClassName
      );
      assert.ok(ancestor, `missing rendered .${ancestorClassName} below ${elementId}`);
      return countDescendantsByClass(ancestor, className);
    },
    dispatchRenderedEventByClass(elementId, className, type, event = {}) {
      const element = findRenderedByClass(getOrCreateElement(elementId), className);
      assert.ok(element, `missing rendered .${className} below ${elementId}`);
      const handlers = elementListeners.get(element.id)?.get(type) ?? [];
      assert.ok(handlers.length > 0, `missing ${type} handler for .${className}`);
      let prevented = false;
      const payload = {
        target: element,
        ...event,
        preventDefault() {
          prevented = true;
        }
      };
      for (const handler of handlers) handler(payload);
      return prevented;
    },
    dispatchMessage(message) {
      const handler = windowListeners.get("message");
      assert.ok(handler, "missing sidebar message listener");
      handler({ data: message });
    },
    getAttribute(elementId, name) {
      getOrCreateElement(elementId);
      return elements.get(elementId)?.attributes.get(name);
    },
    getRenderedAttributeByClass(elementId, className, name) {
      const element = findRenderedByClass(getOrCreateElement(elementId), className);
      assert.ok(element, `missing rendered .${className} below ${elementId}`);
      return element.attributes.get(name);
    },
    getRenderedAttributeByTitle(elementId, title, name) {
      const element = findRenderedByTitle(getOrCreateElement(elementId), title);
      assert.ok(element, `missing rendered element titled ${title} below ${elementId}`);
      return element.attributes.get(name);
    },
    getFocusedElementId() {
      return focusedElementId;
    },
    getPersistedState() {
      return webviewState;
    },
    getRenderedPositionByTitle(elementId, title) {
      const element = findRenderedByTitle(getOrCreateElement(elementId), title);
      assert.ok(element, `missing rendered element titled ${title} below ${elementId}`);
      return {
        left: Number.parseFloat(element.style.getPropertyValue("left")) || 0,
        top: Number.parseFloat(element.style.getPropertyValue("top")) || 0
      };
    },
    getRenderedText(elementId) {
      return collectRenderedText(getOrCreateElement(elementId));
    },
    getRenderedScrollByClass(elementId, className) {
      const element = findRenderedByClass(getOrCreateElement(elementId), className);
      assert.ok(element, `missing rendered .${className} below ${elementId}`);
      return { left: element.scrollLeft, top: element.scrollTop };
    },
    getRenderedStyleByClass(elementId, className, name) {
      const element = findRenderedByClass(getOrCreateElement(elementId), className);
      assert.ok(element, `missing rendered .${className} below ${elementId}`);
      return element.style.getPropertyValue(name);
    },
    hasRenderedClassByTitle(elementId, title, className) {
      const element = findRenderedByTitle(getOrCreateElement(elementId), title);
      assert.ok(element, `missing rendered element titled ${title} below ${elementId}`);
      return element.classList.contains(className);
    },
    isDisabled(elementId) {
      return getOrCreateElement(elementId).disabled;
    },
    isHidden(elementId) {
      return getOrCreateElement(elementId).hidden;
    },
    inputByTitle(title, value) {
      const element = [...elements.values()].find((candidate) => candidate.title === title);
      assert.ok(element, `missing element titled ${title}`);
      element.value = value;
      const handlers = elementListeners.get(element.id)?.get("input") ?? [];
      assert.ok(handlers.length > 0, `missing input handler for ${title}`);
      for (const handler of handlers) {
        handler({ preventDefault() {} });
      }
    },
    keydown(elementId, key) {
      const handlers = elementListeners.get(elementId)?.get("keydown") ?? [];
      assert.ok(handlers.length > 0, `missing keydown handler for ${elementId}`);
      for (const handler of handlers) {
        handler({ key, preventDefault() {} });
      }
    },
    keydownByClass(elementId, className, key) {
      const element = findRenderedByClass(getOrCreateElement(elementId), className);
      assert.ok(element, `missing rendered .${className} below ${elementId}`);
      const handlers = elementListeners.get(element.id)?.get("keydown") ?? [];
      assert.ok(handlers.length > 0, `missing keydown handler for .${className}`);
      for (const handler of handlers) {
        handler({ key, preventDefault() {} });
      }
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
    setRenderedScrollByClass(elementId, className, scroll) {
      const element = findRenderedByClass(getOrCreateElement(elementId), className);
      assert.ok(element, `missing rendered .${className} below ${elementId}`);
      element.scrollLeft = scroll.left;
      element.scrollTop = scroll.top;
    },
    setValue(elementId, value) {
      getOrCreateElement(elementId).value = value;
    },
    submit(elementId) {
      const handlers = elementListeners.get(elementId)?.get("submit") ?? [];
      assert.ok(handlers.length > 0, `missing submit handler for ${elementId}`);
      for (const handler of handlers) {
        handler({ preventDefault() {} });
      }
    },
    textValues
  };
}

/** Counts one concrete class beneath a currently attached fake DOM root. */
function countDescendantsByClass(root: SidebarFakeElement, className: string): number {
  let count = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    if (current.className.split(/\s+/u).includes(className)) count += 1;
    for (const child of current.children) pending.push(child);
  }
  return count;
}

/** Finds the first currently attached descendant carrying one concrete class. */
function findRenderedByClass(
  root: SidebarFakeElement,
  className: string
): SidebarFakeElement | undefined {
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) continue;
    if (current.className.split(/\s+/u).includes(className)) return current;
    pending.push(...current.children);
  }
  return undefined;
}

/** Finds a titled element only inside the currently attached fake DOM subtree. */
function findRenderedByTitle(
  root: SidebarFakeElement,
  title: string
): SidebarFakeElement | undefined {
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) continue;
    if (current.title === title) return current;
    pending.push(...current.children);
  }
  return undefined;
}

/** Collects only text still attached below one fake DOM root after rerenders. */
function collectRenderedText(root: SidebarFakeElement): string[] {
  const values: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    if (current.textContent) {
      values.push(current.textContent);
    }
    for (let index = current.children.length - 1; index >= 0; index -= 1) {
      pending.push(current.children[index]);
    }
  }
  return values;
}

/** Restores or removes one global browser shim. */
function restoreGlobal(name: string, value: unknown): void {
  if (value === undefined) {
    Reflect.deleteProperty(globalThis, name);
    return;
  }
  Reflect.set(globalThis, name, value);
}

type SidebarEventHandler = (event: Record<string, unknown> & {
  preventDefault: () => void;
  key?: string;
}) => void;

type SidebarFakeElement = {
  attributes: Map<string, string>;
  id: string;
  children: SidebarFakeElement[];
  readonly firstChild?: SidebarFakeElement;
  className: string;
  classList: {
    add: (...names: string[]) => void;
    remove: (...names: string[]) => void;
    contains: (name: string) => boolean;
    toggle: (name: string, force?: boolean) => boolean;
  };
  dataset: Record<string, string>;
  disabled: boolean;
  hidden: boolean;
  style: {
    getPropertyValue: (name: string) => string;
    setProperty: (name: string, value: string) => void;
  };
  textContent: string;
  title: string;
  type: string;
  value: string;
  clientWidth: number;
  clientHeight: number;
  scrollLeft: number;
  scrollTop: number;
  addEventListener: (type: string, handler: SidebarEventHandler) => void;
  removeEventListener: (type: string, handler: SidebarEventHandler) => void;
  append: (...children: SidebarFakeElement[]) => void;
  removeChild: (child: SidebarFakeElement) => SidebarFakeElement;
  focus: () => void;
  closest: (selector: string) => SidebarFakeElement | undefined;
  getBoundingClientRect: () => {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  setPointerCapture: (pointerId: number) => void;
  hasPointerCapture: (pointerId: number) => boolean;
  releasePointerCapture: (pointerId: number) => void;
  querySelectorAll: (selector: string) => SidebarFakeElement[];
  replaceChildren: (...children: SidebarFakeElement[]) => void;
  setAttribute: (name: string, value: string) => void;
};
