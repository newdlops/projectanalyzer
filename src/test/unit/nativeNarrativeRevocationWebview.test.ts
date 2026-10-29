/** Production widget revocation follows a Host publication after terminal ready, rather than relying on an in-flight request. */
import assert from "node:assert/strict";
import test from "node:test";
import { installRootPublicationUi, installCallPublicationUi, publicationFixtureId } from "../helpers/narrativePublicationUi";

/** Terminal failures arrive after the request registry has already consumed ready. */
const revoked = (ready: Record<string, any>, status = "failed") => ({ ...ready, status, narrative: undefined, publicationRevoked: true });
const rootCount = (f: ReturnType<typeof installRootPublicationUi>) => f.runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario");
const callCount = (f: ReturnType<typeof installCallPublicationUi>) => f.runtime.countRenderedByClass("narrative-root", "calls-reading-facts");

for (const status of ["failed", "stale", "cancelled", "memory-pressure", "parameter-limit"]) {
test("root late " + status + " publication clears prose, graph notes, source actions and the cached mount without altering edited inputs", () => {
  const f = installRootPublicationUi();
  try {
    f.click("request"); const ready = f.response(); f.browser.accept(ready);
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 1); f.values.set("input", "99");
    f.browser.accept(revoked(ready, status));
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 0);
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "logic-narrative-source"), 0); assert.equal(f.notes.at(-1), undefined); assert.equal(f.values.get("input"), "99");
    f.unmount(); f.mount(); assert.equal(f.runtime.countRenderedByClass("narrative-root", "logic-narrative-scenario"), 0);
    assert.equal(f.posts.filter(post => post.type === "codeFlow/requestFunctionNarratives").length, 1);
  } finally { f.dispose(); }
});

test("call late " + status + " publication clears saved pages and source actions across route changes", () => {
  const f = installCallPublicationUi();
  try {
    f.click("request"); const ready = f.response(); f.widget.accept(ready);
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "calls-reading-facts"), 1);
    f.widget.accept(revoked(ready, status));
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "calls-reading-facts"), 0);
    f.widget.view({ ...f.view, scope: "call", connectionId: "other" }); f.widget.view(f.view);
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "calls-reading-facts"), 0);
    assert.equal(f.posts.filter(post => post.type === "functionCalls/explain").length, 1);
  } finally { f.dispose(); }
});
}

test("a memory-limited call request displays its cause and permits retry instead of remaining pending", () => {
  const f = installCallPublicationUi();
  try {
    f.click("request"); const response = f.response();
    f.widget.accept({ ...response, status: "memory-pressure", narrative: undefined });
    assert.ok(f.runtime.getRenderedText("narrative-root").some(text => text.includes("configured reserve")));
    f.click("request"); assert.equal(f.posts.filter(post => post.type === "functionCalls/explain").length, 2);
  } finally { f.dispose(); }
});

test("memory admission failure retains completed Guide scenarios for continuation", () => {
  const f = installRootPublicationUi();
  try {
    f.click("request"); const partial = f.response(); partial.status = "progress"; partial.coverage.complete = false;
    f.browser.accept(partial);
    f.browser.accept({ ...partial, status: "memory-pressure", narrative: undefined });
    assert.equal(rootCount(f), 1);
    assert.ok(f.runtime.getRenderedText("narrative-root").some(text => text.includes("configured reserve")));
    f.click("request"); assert.equal(f.posts.filter(post => post.type === "codeFlow/requestFunctionNarratives").length, 2);
  } finally { f.dispose(); }
});

test("root rejects an old publication failure after a newer generation and preserves its own graph notes", () => {
  const f = installRootPublicationUi();
  try {
    f.click("request"); const old = f.response(); old.coverage.complete = false; f.browser.accept(old);
    f.click("request"); const fresh = f.response(2); f.browser.accept(fresh); const notes = f.notes.at(-1);
    f.browser.accept(revoked(old)); assert.equal(rootCount(f), 1); assert.equal(f.notes.at(-1), notes);
    f.unmount(); f.mount(); assert.equal(rootCount(f), 1);
  } finally { f.dispose(); }
});

test("call rejects an old publication failure after a newer generation without inheriting old cached calls", () => {
  const f = installCallPublicationUi();
  try {
    f.click("request"); const old = f.response(); old.coverage.complete = false; f.widget.accept(old);
    f.click("request"); const fresh = f.response(2); fresh.narrative.calls[0].role = "This fresh generation describes the current supplied source callee."; f.widget.accept(fresh);
    f.widget.accept(revoked(old)); assert.equal(callCount(f), 1);
    assert.ok(f.runtime.getRenderedText("narrative-root").includes(fresh.narrative.calls[0].role));
    f.widget.view({ ...f.view, scope: "call", connectionId: "other" }); f.widget.view(f.view); assert.equal(callCount(f), 1);
  } finally { f.dispose(); }
});

for (const surface of ["root", "call"] as const) {
test(surface + " revocation removes the old reading while a newer explicit generation keeps its request ownership", () => {
  const f = surface === "root" ? installRootPublicationUi() : installCallPublicationUi();
  try {
    const accept = (value: Record<string, any>) => "browser" in f ? f.browser.accept(value) : f.widget.accept(value);
    f.click("request"); const old = f.response(); old.coverage.complete = false; accept(old);
    f.click("request"); const fresh = f.response(2); accept(revoked(old));
    assert.equal(f.runtime.countRenderedByClass("narrative-root", surface === "root" ? "logic-narrative-scenario" : "calls-reading-facts"), 0);
    assert.equal(f.runtime.getAttribute(f.element().id, "aria-busy"), "true"); accept(fresh);
    assert.equal(f.runtime.countRenderedByClass("narrative-root", surface === "root" ? "logic-narrative-scenario" : "calls-reading-facts"), 1);
    assert.equal(f.runtime.getAttribute(f.element().id, "aria-busy"), "false");
  } finally { f.dispose(); }
});

test(surface + " page request uses another correlation id but the same revoked result cannot return from a late cache response", () => {
  const f = surface === "root" ? installRootPublicationUi() : installCallPublicationUi();
  try {
    const accept = (value: Record<string, any>) => "browser" in f ? f.browser.accept(value) : f.widget.accept(value);
    f.click("request"); const first = f.response(); accept(first); f.click("next"); const page = f.response(1, 1);
    assert.notEqual(first.requestId, page.requestId); accept(revoked(first)); accept(page);
    assert.equal(f.runtime.countRenderedByClass("narrative-root", surface === "root" ? "logic-narrative-scenario" : "calls-reading-facts"), 0);
    assert.equal(f.runtime.getAttribute(f.element().id, "aria-busy"), "false");
    assert.equal(f.posts.filter(post => post.type === (surface === "root" ? "codeFlow/requestFunctionNarratives" : "functionCalls/explain") && post.payload.pageIndex === undefined && post.payload.nodeId === undefined).length, 1);
  } finally { f.dispose(); }
});

test(surface + " malformed, data-bearing and foreign revocations cannot withdraw a valid reading", () => {
  const f = surface === "root" ? installRootPublicationUi() : installCallPublicationUi();
  try {
    const accept = (value: Record<string, any>) => "browser" in f ? f.browser.accept(value) : f.widget.accept(value);
    f.click("request"); const ready = f.response(); accept(ready);
    for (const change of [ { publicationId: "browser-selected" }, { publicationId: publicationFixtureId(2) }, { publicationRevoked: false },
      { language: undefined }, { language: "ko" }, { graphVersion: "old" }, { status: "ready" }, { status: "working" },
      { narrative: ready.narrative }, { requestId: -1 }, surface === "root" ? { flowId: "other" } : { contextId: "other" },
      ...(surface === "call" ? [{ sourceToken: "other" }] : []) ]) {
      accept({ ...revoked(ready), ...change });
      assert.equal(f.runtime.countRenderedByClass("narrative-root", surface === "root" ? "logic-narrative-scenario" : "calls-reading-facts"), 1, JSON.stringify(change));
    }
  } finally { f.dispose(); }
});

test(surface + " removed reading focus moves to the existing retry or refresh action", () => {
  const f = surface === "root" ? installRootPublicationUi() : installCallPublicationUi();
  try {
    const accept = (value: Record<string, any>) => "browser" in f ? f.browser.accept(value) : f.widget.accept(value);
    f.click("request"); const ready = f.response(); accept(ready);
    if (surface === "root") f.runtime.focusRenderedByClassNth("narrative-root", "logic-narrative-source", 0);
    else f.element().querySelector<HTMLSelectElement>(".calls-reading-select")!.focus();
    accept(revoked(ready, "stale"));
    if (surface === "root") assert.equal(document.activeElement, f.element().querySelector(".logic-narrative-refresh"));
    else assert.equal((document.activeElement as HTMLElement).dataset.callKey, "reading-refresh");
  } finally { f.dispose(); }
});

test(surface + " revocation does not steal focus from an edited input outside the reading", () => {
  const f = surface === "root" ? installRootPublicationUi() : installCallPublicationUi();
  try {
    const accept = (value: Record<string, any>) => "browser" in f ? f.browser.accept(value) : f.widget.accept(value);
    f.click("request"); const ready = f.response(); accept(ready);
    const input = document.createElement("input"); input.value = "99"; document.getElementById("narrative-root")!.append(input); input.focus();
    accept(revoked(ready)); assert.equal(document.activeElement, input); assert.equal(input.value, "99");
  } finally { f.dispose(); }
});

test(surface + " legacy partial prose without a publication identity retains the established cancellation behavior", () => {
  const f = surface === "root" ? installRootPublicationUi() : installCallPublicationUi();
  try {
    const accept = (value: Record<string, any>) => "browser" in f ? f.browser.accept(value) : f.widget.accept(value);
    f.click("request"); const ready: Record<string, any> = f.response(); delete ready.publicationId; ready.status = "progress"; ready.coverage.complete = false; accept(ready);
    f.click("cancel");
    assert.equal(f.runtime.countRenderedByClass("narrative-root", surface === "root" ? "logic-narrative-scenario" : "calls-reading-facts"), 1);
  } finally { f.dispose(); }
});
}

test("root unmounted cache is revoked without retaining a mounted observer", () => {
  const f = installRootPublicationUi();
  try {
    f.click("request"); const ready = f.response(); f.browser.accept(ready); f.unmount(); f.browser.accept(revoked(ready)); f.mount();
    assert.equal(rootCount(f), 0); assert.equal(f.notes.at(-1), undefined);
  } finally { f.dispose(); }
});

test("root old source and graph-note callbacks no longer authorize opening after revocation", () => {
  const f = installRootPublicationUi();
  try {
    f.click("request"); const ready = f.response(); f.browser.accept(ready);
    const source = f.runtime.getRenderedIdentityByClassNth("narrative-root", "logic-narrative-source", 0), notes = f.notes.at(-1);
    const nodeSource = f.runtime.getRenderedIdentityByClassNth("narrative-root", "logic-narrative-node-source", 0);
    f.browser.accept(revoked(ready)); f.runtime.click(source); f.runtime.click(nodeSource); notes.openSource(0);
    assert.equal(f.posts.filter(post => post.type === "codeFlow/openFunctionNarrativeSource").length, 0);
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "logic-narrative-node-detail"), 0);
  } finally { f.dispose(); }
});

test("root out-of-page node response cannot resurrect a revoked or replaced reading", () => {
  const f = installRootPublicationUi();
  try {
    f.click("request"); const ready = f.response(); ready.coverage.complete = false; f.browser.accept(ready);
    const outside = "function-logic-block:" + "e".repeat(32); f.selectNode(outside);
    const lookup = f.response(); lookup.narrative.scenarios[0].nodeDetails![0].nodeId = outside;
    assert.equal(lookup.nodeId, outside); f.click("request"); const fresh = f.response(2); f.browser.accept(fresh);
    f.browser.accept(lookup); assert.equal(f.runtime.countRenderedByClass("narrative-root", "logic-narrative-node-detail"), 0);
    f.browser.accept(revoked(fresh)); f.browser.accept(lookup); assert.equal(rootCount(f), 0);
    assert.equal(f.runtime.countRenderedByClass("narrative-root", "logic-narrative-node-detail"), 0);
  } finally { f.dispose(); }
});

test("call old source handlers become inert after publication revocation", () => {
  const f = installCallPublicationUi();
  try {
    f.click("request"); const ready = f.response(); f.widget.accept(ready);
    const source = Array.from(f.element().querySelectorAll<HTMLButtonElement>("button")).find(button => button.dataset.callKey === "reading-caller")!;
    f.widget.accept(revoked(ready)); f.runtime.click(source.id);
    assert.equal(f.posts.filter(post => post.type === "fixture/source").length, 0);
  } finally { f.dispose(); }
});

test("call cache paging restores an enabled sibling when the focused page action becomes disabled", () => {
  const f = installCallPublicationUi();
  try {
    const control = (key: string) => Array.from(f.element().querySelectorAll<HTMLButtonElement>("button")).find(button => button.dataset.callKey === key)!;
    f.click("request"); f.widget.accept(f.response()); control("reading-next").focus(); f.click("next"); f.widget.accept(f.response(1, 1));
    assert.equal((document.activeElement as HTMLElement).dataset.callKey, "reading-previous");
    const requests = f.posts.length; f.click("previous");
    assert.equal((document.activeElement as HTMLElement).dataset.callKey, "reading-next"); assert.equal(f.posts.length, requests);
  } finally { f.dispose(); }
});

test("call page completion preserves an external input's newer keyboard focus", () => {
  const f = installCallPublicationUi();
  try {
    f.click("request"); f.widget.accept(f.response());
    const next = Array.from(f.element().querySelectorAll<HTMLButtonElement>("button")).find(button => button.dataset.callKey === "reading-next")!;
    next.focus(); f.click("next"); const page = f.response(1, 1), input = document.createElement("input"); document.getElementById("narrative-root")!.append(input); input.focus();
    f.widget.accept(page); assert.equal(document.activeElement, input);
  } finally { f.dispose(); }
});
