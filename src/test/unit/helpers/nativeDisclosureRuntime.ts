/**
 * Adds coalesced native <details> toggle tasks to the small Webview test DOM.
 * Programmatic open changes queue events even before a listener is attached,
 * which exposes renderer feedback loops that synchronous toggles miss.
 */
export function installNativeDisclosureTasks(): { flush(limit?: number): number } {
  const originalCreate = document.createElement.bind(document);
  const pending = new Map<HTMLElement, () => void>();
  document.createElement = ((tagName: string) => {
    const element = originalCreate(tagName);
    if (tagName !== "details") return element;
    let open = false;
    const handlers: Array<EventListenerOrEventListenerObject> = [];
    const originalListen = element.addEventListener.bind(element);
    element.addEventListener = ((type: string, handler: EventListenerOrEventListenerObject) => {
      if (type === "toggle") handlers.push(handler);
      originalListen(type, handler);
    }) as typeof element.addEventListener;
    Object.defineProperty(element, "open", {
      configurable: true,
      get: () => open,
      set(value: boolean) {
        if (open === Boolean(value)) return;
        open = Boolean(value);
        pending.set(element, () => {
          const event = { target: element, currentTarget: element } as unknown as Event;
          for (const handler of handlers) {
            if (typeof handler === "function") handler.call(element, event);
            else handler.handleEvent(event);
          }
        });
      }
    });
    return element;
  }) as typeof document.createElement;
  return {
    /** Drains real renderer callbacks with a finite limit so a regression cannot hang the suite. */
    flush(limit = 32) {
      let count = 0;
      while (pending.size && count < limit) {
        const tasks = [...pending.values()];
        pending.clear();
        for (const task of tasks) { task(); count += 1; }
      }
      if (pending.size) throw new Error("Guide disclosure keeps scheduling toggle tasks while idle");
      return count;
    }
  };
}
