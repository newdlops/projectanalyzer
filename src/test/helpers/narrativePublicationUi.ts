/** Explicit CPU pages drive production reading widgets; no model or analyzed source program executes. */
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import { getFunctionNarrativesBrowserSource } from "../../webview/functionNarratives";
import { getFunctionCallReadingBrowserSource } from "../../webview/functionCalls/readingBrowserSource";
import { installSidebarWebviewRuntime } from "../unit/helpers/sidebarWebviewRuntime";
import { completeNativePageFixture } from "./completeNativeNarrativeRoot";

export const publicationFixtureId = (index = 1) => "narrative-publication:" + index.toString(16).padStart(32, "0");
export const publicationFixtureFlow = "code-flow:" + "a".repeat(32);
export const publicationFixtureContext = "narrative-context:" + "c".repeat(32);
export const publicationFixtureSource = "source-node:" + "d".repeat(64);
export type PublicationUiMessage = { type: string; payload: Record<string, any> };

/** Real strict-decoded root page plus independent Host metadata; tests may select a cache page without any inference. */
export function rootPublicationUiResponse<Request extends Record<string, any>>(request: Request, index = 1, pageIndex = 0) {
  const f = completeNativePageFixture("computed");
  return { ...request, status: "ready", language: "en", publicationId: publicationFixtureId(index), modelName: "Explicit CPU UI fixture", cacheHit: Boolean(request.pageIndex !== undefined), limited: false,
    narrative: f.page, snippets: f.context.snippets.map(({ id, startLine, endLine }) => ({ id, startLine, endLine })),
    evidenceTokens: [f.page.scenarios[0].steps.map(() => "code-evidence:" + "b".repeat(64))],
    coverage: { completed: 2, discovered: 2, total: 2, complete: true, sourceLimited: false }, page: { index: pageIndex, count: 2, offset: pageIndex } };
}

/** Static relationship identities are fixtures; role/input/output/effect/reason are explicitly authored CPU prose. */
export function callPublicationUiData() {
  const view = { graphVersion: "fixture", sourceToken: publicationFixtureSource, contextId: "call-reading:" + "c".repeat(32), scope: "overview", choices: [] };
  const edges = Array.from({ length: 4 }, (_, index) => ({ id: "function-call:" + String(index + 1).padStart(32, "0"), from: view.sourceToken, to: "callee-" + index,
    relation: "call", confidence: "exact", deferred: false, evidenceToken: "code-evidence:" + String(index + 1).padStart(64, "0") }));
  const nodes = edges.map((edge, index) => ({ id: edge.to, sourceToken: "source-node:" + String(index + 1).padStart(64, "0") }));
  return { view, edges, nodes };
}

export function callPublicationUiResponse<Request extends Record<string, any>>(request: Request, index = 1, pageIndex = 0) {
  const f = callPublicationUiData();
  return { ...request, status: "ready", language: "en", publicationId: publicationFixtureId(index), modelName: "Explicit CPU UI fixture", cacheHit: request.pageIndex !== undefined,
    narrative: { summary: "Read the supplied source calls.", flow: "Follow source order and transfer each input to the selected callee.", limitations: [],
      calls: f.edges.slice(pageIndex * 2, pageIndex * 2 + 2).map((edge, offset) => ({ callId: "call-" + (pageIndex * 2 + offset + 1), connectionId: edge.id,
        occurrence: 1, expression: "finish(value)", callee: "finish", confidence: edge.confidence, deferred: false, callerEvidence: edge.evidenceToken,
        calleeSourceToken: f.nodes[pageIndex * 2 + offset].sourceToken, role: "Read the supplied value in the selected source callee.", inputs: "Transfer value to the declared parameter.",
        output: "The source result returns to the caller.", effects: "External effects remain unverified.", reason: "The selected source route reaches this call." })) },
    coverage: { completed: 4, total: 4, complete: true, sourceLimited: false }, page: { index: pageIndex, count: 2, offset: pageIndex * 2 } };
}

/** Real widget lifecycle/caches/DOM handlers; callback stubs retain user-owned inputs and observable graph-note/source actions. */
export function installRootPublicationUi() {
  const runtime = installSidebarWebviewRuntime(), posts: PublicationUiMessage[] = [], state = { graph: { version: "fixture" }, uiLanguage: "en" };
  const browser = new Function("state", "vscode", getBrowserLocalizationSource() + getFunctionNarrativesBrowserSource()
    + "return {create:createFunctionNarratives,accept:acceptFunctionNarrativesResponse,locale:applyProjectAnalyzerLanguage};")
    (state, { postMessage(message: PublicationUiMessage) { posts.push(message); } });
  const values = new Map<string, string>(), notes: any[] = [], listeners = new Set<() => void>();
  const native = completeNativePageFixture("computed"); let selected = native.page.scenarios[0].graph!.nodeIds[0], widget: any;
  const mount = () => {
    widget = browser.create({ functionId: publicationFixtureFlow, narratives: { available: true, contextId: publicationFixtureContext, sourceToken: publicationFixtureSource } }, {
      onNarrativeNotes(value: unknown) { notes.push(value); }, onRefreshFunction() { posts.push({ type: "fixture/refresh", payload: {} }); },
      readNarrativeNode: () => selected, subscribeNarrativeNode(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
      onNarrativeScenario(scenario: any, options: { apply: string }) { if (options.apply === "none") return; for (const input of scenario.example.inputs)
        if (options.apply !== "empty" || !values.has(input.name)) values.set(input.name, input.json); },
      onShowGraph(chapter: { primaryBlockId: string }) { selected = chapter.primaryBlockId; for (const listener of listeners) listener(); }
    });
    document.getElementById("narrative-root")!.append(widget.element);
  };
  mount();
  return { runtime, posts, state, browser, values, notes, mount,
    selectNode(nodeId: string) { selected = nodeId; for (const listener of listeners) listener(); },
    element: () => widget.element as HTMLElement,
    click: (name: string) => runtime.clickRenderedByClassNth("narrative-root", "logic-narrative-" + name, 0),
    response: (index = 1, pageIndex = 0) => rootPublicationUiResponse(posts.at(-1)!.payload, index, pageIndex),
    unmount() { widget.dispose(); widget.element.parentElement?.removeChild(widget.element); }, refreshLanguage() { browser.locale(state.uiLanguage); widget.refreshLanguage(); },
    dispose() { widget.dispose(); runtime.restore(); } };
}

export function installCallPublicationUi() {
  const runtime = installSidebarWebviewRuntime(), posts: PublicationUiMessage[] = [], f = callPublicationUiData(); let language = "en";
  const el = (tag: string, className = "", text = "") => { const element = document.createElement(tag); element.className = className; element.textContent = text; return element; };
  const button = (text: string, key: string, action: () => void) => { const element = el("button", "", text); element.dataset.callKey = key; element.addEventListener("click", action); return element; };
  const create = new Function(getBrowserLocalizationSource() + getFunctionCallReadingBrowserSource() + "return {create:createFunctionCallReading,t:projectAnalyzerText,locale:applyProjectAnalyzerLanguage};")();
  const widget = create.create({ el, button, t: create.t, language: () => language, graphVersion: () => "fixture", connection: (id: string) => f.edges.find(edge => edge.id === id),
    node: (id: string) => f.nodes.find(node => node.id === id), reload() {}, postMessage(message: PublicationUiMessage) { posts.push(message); },
    openEvidence(token: string) { posts.push({ type: "fixture/source", payload: { token } }); }, openFunction() {} });
  document.getElementById("narrative-root")!.append(widget.view(f.view));
  return { runtime, posts, widget, view: f.view,
    element: () => widget.element as HTMLElement,
    click(name: string) {
      if (["next", "previous", "refresh"].includes(name)) {
        const target = Array.from(widget.element.querySelectorAll("button") as HTMLButtonElement[]).find(button => button.dataset.callKey === "reading-" + name);
        if (!target) throw new Error("Missing reading control: " + name); runtime.click(target.id);
      } else runtime.clickRenderedByClassNth("narrative-root", "calls-reading-" + name, 0);
    },
    response: (index = 1, pageIndex = 0) => callPublicationUiResponse(posts.at(-1)!.payload, index, pageIndex),
    locale(next: string) { language = next; create.locale(next); widget.view(f.view); },
    dispose() { widget.reset(); runtime.restore(); } };
}
