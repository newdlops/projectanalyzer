/** Real Kotlin analysis, Host projection and production Webview integration; only the external LLM reply is a fixture. */
import assert from "node:assert/strict";
import test from "node:test";
import { CodeFlowInsightCache } from "../../application/codeFlow";
import { CodeFlowHostDelivery } from "../../webview/codeFlow/codeFlowHostDelivery";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow/codeFlowEvidenceTokenRegistry";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { getFunctionVisualizerHtml } from "../../webview/functionVisualizer/functionVisualizerHtml";
import type { FunctionNarrativesRequest, FunctionNarrativeSourceRequest } from "../../protocol/functionNarratives";
import type { FunctionNarrativeSourcePresentation } from "../../shared/functionNarratives";
import { createContentHash } from "../../shared/hash";
import type { ExtensionResponse } from "../../protocol/messages";
import type { SymbolNode } from "../../shared/types";
import { createGraph } from "./helpers/projectReadingGuideFixtures";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

test("production Kotlin Guide offers actual LLM requests without changing static paths, graph or input state", async () => {
  const source = 'const val LIMIT = 3\n/** Displays the result. */\nfun describe() {\n  if (LIMIT > 0) println("ready")\n  else println("empty")\n}\n';
  const node: SymbolNode = { id: "function:private", name: "describe", qualifiedName: "describe", kind: "function", language: "kotlin", filePath: "/workspace/Example.kt",
    range: { startLine: 2, startCharacter: 0, endLine: 5, endCharacter: 1 }, selectionRange: { startLine: 2, startCharacter: 4, endLine: 2, endCharacter: 12 } };
  const graph = createGraph({ files: [node.filePath], callables: [node] });
  const graphDelivery = new WebviewGraphDelivery(); const version = graphDelivery.activate(graph).snapshot.version;
  const sourceNodeTokens = new SourceNodeTokenRegistry(); sourceNodeTokens.activate(version, graph);
  const evidenceTokens = new CodeFlowEvidenceTokenRegistry(); evidenceTokens.activate(version, graph);
  const messages: ExtensionResponse[] = []; const presentations: FunctionNarrativeSourcePresentation[] = [];
  const opened: unknown[] = []; let calls = 0; let sourceReads = 0;
  const delivery = new CodeFlowHostDelivery({ graphDelivery, sourceNodeTokens, evidenceTokens, insightCache: new CodeFlowInsightCache(),
    getUiLanguage: () => "en", readSourceText: async () => { sourceReads += 1; return "stale disk text"; }, openEvidenceLocation: async (location) => { opened.push(location); },
    functionNarrativeSourcePresenter: { show(presentation) { presentations.push(presentation); }, clear() {} },
    logger: { debug() {}, info() {}, warn() {}, error() {} }, async postMessage(message) { messages.push(message); },
    functionNarrativeProvider: { async generate(context) {
      calls += 1; assert.equal(context.language, "kotlin"); assert.ok(context.snippets.some((snippet) => snippet.text.includes('println("ready")')));
      assert.ok(context.snippets.some((snippet) => snippet.text.includes("const val LIMIT = 3")));
      assert.equal(context.sourceFlow?.basis, "source-control-flow");
      assert.ok(context.sourceFlow?.paths.some((path) => path.steps.some((step) => step.code === "LIMIT > 0")));
      // The fixture models an external explanation; partial call routes are not constrained to terminal frames.
      return { modelName: "LLM boundary fixture", text: JSON.stringify({ summary: "Print a message based on LIMIT.", scenarios: [{ title: "Positive LIMIT", when: ["LIMIT > 0"], steps: [{ text: "Print ready.", source: { snippetId: "root", startLine: 4, endLine: 4 } }], outcome: "Finish normally.", assumptions: [] }], limitations: [] }) };
    } } });
  const runtime = installSidebarWebviewRuntime();
  try {
    await delivery.publishFunctionNode(version, node.id, source);
    const detail = messages.find((message) => message.type === "codeFlow/detailLoaded"); assert.ok(detail?.type === "codeFlow/detailLoaded");
    assert.equal(detail.payload.logic?.tutor?.narratives?.available, true);
    assert.equal(detail.payload.logic?.tutor?.program.evaluationMode, "symbolic-only");
    assert.equal(sourceReads, 0); assert.equal(calls, 0);
    const html = getFunctionVisualizerHtml({ webview: { cspSource: "vscode-webview:" } as never, nonce: "narrative-test" });
    const script = html.match(/<script nonce="narrative-test">([\s\S]*)<\/script>/u)?.[1]; assert.ok(script); new Function(script)();
    runtime.dispatchMessage({ type: "functionVisualizer/sessionLoaded", payload: { graphVersion: version, root: { sourceToken: sourceNodeTokens.createToken(node.id)!, label: "describe" } } });
    runtime.dispatchMessage(detail);
    const graphIdentity = runtime.getRenderedIdentityByClassNth("flow-steps", "logic-graph-node", 0);
    runtime.clickRenderedByClassNth("flow-steps", "logic-guide-toggle", 0); assert.equal(calls, 0);
    runtime.clickRenderedByClassNth("flow-steps", "logic-narrative-request", 0);
    const request = runtime.messages.at(-1); assert.equal(request?.type, "codeFlow/requestFunctionNarratives");
    await delivery.requestFunctionNarratives(request!.payload as FunctionNarrativesRequest);
    const reply = messages.at(-1)!; assert.ok(reply.type === "codeFlow/functionNarrativesLoaded"); assert.equal(reply.payload.status, "ready");
    assert.ok(reply.payload.evidenceTokens?.[0][0] && evidenceTokens.resolve(reply.payload.evidenceTokens[0][0]));
    runtime.dispatchMessage(reply); assert.equal(calls, 1);
    assert.equal(presentations.length, 1); assert.equal(presentations[0].sourceHash, createContentHash(source));
    assert.equal(presentations[0].filePath, node.filePath);
    runtime.clickRenderedByClassNth("flow-steps", "logic-narrative-source", 0);
    const sourceAction = runtime.messages.at(-1); assert.equal(sourceAction?.type, "codeFlow/openFunctionNarrativeSource");
    await delivery.openFunctionNarrativeSource(sourceAction!.payload as FunctionNarrativeSourceRequest);
    assert.equal(opened.length, 1); assert.equal(presentations.length, 2); assert.equal(calls, 1);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-narrative-scenario"), 1);
    assert.equal(runtime.getRenderedIdentityByClassNth("flow-steps", "logic-graph-node", 0), graphIdentity);
    assert.equal(runtime.messages.filter((message) => message.type === "codeFlow/requestScenarioInputs").length, 0);
    runtime.dispatchMessage({ type: "ui/language", payload: { language: "ko" } }); assert.equal(calls, 1);
    assert.ok(runtime.getRenderedText("flow-steps").some((text) => text.includes("LLM 추론 · 실제 실행 미검증")));
  } finally { delivery.clearScenarioInputs(); runtime.restore(); }
});
