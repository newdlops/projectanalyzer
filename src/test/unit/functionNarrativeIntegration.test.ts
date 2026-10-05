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
import { resolveUiLanguage } from "../../localization/uiLanguage";
import type { ExtensionResponse } from "../../protocol/messages";
import type { SymbolNode } from "../../shared/types";
import { createGraph } from "./helpers/projectReadingGuideFixtures";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";
import { buildFunctionNarrativeScenarioFrames } from "../../application/functionNarratives";
import type { FunctionNarrative } from "../../shared/functionNarratives";

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
  let preference: "ko" | "en" = "en";
  const delivery = new CodeFlowHostDelivery({ graphDelivery, sourceNodeTokens, evidenceTokens, insightCache: new CodeFlowInsightCache(),
    getUiLanguage: () => resolveUiLanguage(preference, "ko-KR"), readSourceText: async () => { sourceReads += 1; return "stale disk text"; }, openEvidenceLocation: async (location) => { opened.push(location); },
    functionNarrativeSourcePresenter: { show(presentation) { presentations.push(presentation); }, clear() {} },
    logger: { debug() {}, info() {}, warn() {}, error() {} }, async postMessage(message) { messages.push(message); },
    functionNarrativeProvider: { async generate(context, language) {
      assert.equal(language, preference, "explicit preference overrides VS Code display locale at generation time");
      calls += 1; assert.equal(context.language, "kotlin"); assert.ok(context.snippets.some((snippet) => snippet.text.includes('println("ready")')));
      assert.ok(context.snippets.some((snippet) => snippet.text.includes("const val LIMIT = 3")));
      assert.equal(context.sourceFlow?.basis, "source-control-flow");
      assert.ok(context.sourceFlow?.paths.some((path) => path.steps.some((step) => step.code === "LIMIT > 0")));
      // The fixture models an external explanation; partial call routes are not constrained to terminal frames.
      return { modelName: "LLM boundary fixture", text: JSON.stringify({ summary: language === "ko" ? "LIMIT에 따라 메시지를 출력합니다." : "Print a message based on LIMIT.", scenarios: [{ title: language === "ko" ? "양수 LIMIT" : "Positive LIMIT", when: ["LIMIT > 0"],
        explanation: language === "ko" ? "LIMIT가 양수이면 ready를 출력하고 함수가 끝납니다." : "A positive LIMIT prints ready and the function finishes.",
        analysis: language === "ko" ? { pathReason: "상수 3은 0보다 큽니다.", stateChange: "분기에서 메시지를 출력합니다.", alternative: "상수가 0 이하이면 다른 분기를 선택합니다." }
          : { pathReason: "Constant 3 is greater than zero.", stateChange: "This branch prints the message.", alternative: "A non-positive constant chooses the other branch." },
        steps: [{ text: language === "ko" ? "ready를 출력합니다." : "Print ready.", reason: language === "ko" ? "LIMIT가 양수입니다." : "LIMIT is positive.",
          syntax: language === "ko" ? "println 호출은 문자열을 출력합니다." : "The println call prints the supplied string.",
          effect: language === "ko" ? "메시지를 출력합니다." : "Print the message.", values: [{ name: "condition", before: "LIMIT > 0", after: "true" }],
          source: { snippetId: "root", startLine: 4, endLine: 4 } }], outcome: language === "ko" ? "정상 종료합니다." : "Finish normally.", assumptions: [], example: { inputs: [], result: "null" } }], limitations: [] }) };
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
    preference = "ko";
    runtime.dispatchMessage({ type: "ui/language", payload: { language: preference } }); assert.equal(calls, 1);
    assert.ok(runtime.getRenderedText("flow-steps").some((text) => text.includes("LLM 추론 · 실제 실행 미검증")));
    runtime.clickRenderedByClassNth("flow-steps", "logic-narrative-request", 0);
    const koreanRequest = runtime.messages.at(-1); assert.equal(koreanRequest?.type, "codeFlow/requestFunctionNarratives");
    await delivery.requestFunctionNarratives(koreanRequest!.payload as FunctionNarrativesRequest);
    const koreanReply = messages.at(-1)!; assert.ok(koreanReply.type === "codeFlow/functionNarrativesLoaded");
    assert.equal(koreanReply.payload.status, "ready"); assert.equal(koreanReply.payload.language, "ko");
    runtime.dispatchMessage(koreanReply); assert.equal(calls, 2);
    assert.ok(runtime.getRenderedText("flow-steps").some((text) => text.includes("LIMIT에 따라 메시지를 출력합니다.")));
    preference = "en";
    runtime.dispatchMessage({ type: "ui/language", payload: { language: preference } });
    assert.equal(calls, 2, "returning to a generated language reuses its result without another model request");
    assert.ok(runtime.getRenderedText("flow-steps").some((text) => text.includes("Print a message based on LIMIT.")));
  } finally { delivery.clearScenarioInputs(); runtime.restore(); }
});

test("production Kotlin scenario interpretation populates editable values and connects graph, node, source and model-example controls", async () => {
  const source = 'fun inspect(value: Int): String {\n if (value < 0) return "negative"\n return "positive"\n}';
  const node: SymbolNode = { id: "private:inspect", name: "inspect", qualifiedName: "inspect", kind: "function", language: "kotlin", filePath: "/workspace/Inspect.kt",
    range: { startLine: 0, startCharacter: 0, endLine: 3, endCharacter: 1 }, selectionRange: { startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 11 } };
  const graph = createGraph({ files: [node.filePath], callables: [node] });
  const graphDelivery = new WebviewGraphDelivery(), version = graphDelivery.activate(graph).snapshot.version;
  const sourceNodeTokens = new SourceNodeTokenRegistry(); sourceNodeTokens.activate(version, graph);
  const evidenceTokens = new CodeFlowEvidenceTokenRegistry(); evidenceTokens.activate(version, graph);
  const messages: ExtensionResponse[] = [], opened: unknown[] = []; let calls = 0;
  const delivery = new CodeFlowHostDelivery({ graphDelivery, sourceNodeTokens, evidenceTokens, insightCache: new CodeFlowInsightCache(),
    getUiLanguage: () => "en", readSourceText: async () => source, openEvidenceLocation: async (location) => { opened.push(location); },
    logger: { debug() {}, info() {}, warn() {}, error() {} }, async postMessage(message) { messages.push(message); },
    createFunctionNarrativePageStore() { const pages = new Map<number, FunctionNarrative>(); return { async write(index, value) { pages.set(index, value); }, async read(index) { return pages.get(index); }, async dispose() { pages.clear(); } }; },
    functionNarrativeProvider: { async generate(context) {
      calls++; assert.deepEqual(context.parameters?.map((parameter) => parameter.name), ["value"]);
      assert.equal(context.detailLevel, "rich");
      const narrative = { summary: "Classify the integer and return its source result.", limitations: [],
        scenarios: buildFunctionNarrativeScenarioFrames(context).map((frame) => {
          const negative = frame.outcome.includes("negative");
          const example = context.nodeTask?.example ?? { inputs: [{ name: "value", json: negative ? "-1" : "1" }], result: negative ? "negative" : "positive" };
          const sources = context.nodeTask?.targets.map((target) => target.source) ?? [frame.sources.at(-1)!];
          return { title: "Source route", when: frame.when, outcome: frame.outcome, assumptions: [], example,
            analysis: { pathReason: "The selected integer makes this source condition true or false.", stateChange: "The input is unchanged and the matching string is returned.", alternative: "Changing the sign chooses the other source branch." },
            explanation: "The example value follows the source conditions to this return.", steps: sources.map((source, index) => ({ source, ...(context.nodeTask ? { code: context.nodeTask.targets[index].code } : {}),
              text: "Read the selected source operation.", syntax: "The comparison selects a branch; return ends this function.", reason: "The same integer selects this route.", effect: "Proceed or return the classified result.",
              values: [{ name: "value", before: example.inputs[0].json, after: example.inputs[0].json }] })) };
        }) };
      return { modelName: "External model fixture", text: JSON.stringify(context.nodeTask ? { steps: narrative.scenarios[0].steps } : narrative) };
    } } });
  const runtime = installSidebarWebviewRuntime();
  try {
    await delivery.publishFunctionNode(version, node.id, source);
    const detail = messages.find((message) => message.type === "codeFlow/detailLoaded"); assert.ok(detail?.type === "codeFlow/detailLoaded");
    const script = getFunctionVisualizerHtml({ webview: { cspSource: "vscode-webview:" } as never, nonce: "interpret-test" })
      .match(/<script nonce="interpret-test">([\s\S]*)<\/script>/u)?.[1]; assert.ok(script); new Function(script)();
    runtime.dispatchMessage({ type: "functionVisualizer/sessionLoaded", payload: { graphVersion: version, root: { sourceToken: sourceNodeTokens.createToken(node.id)!, label: node.name } } });
    runtime.dispatchMessage(detail); assert.equal(calls, 0);
    runtime.clickRenderedByClassNth("flow-steps", "logic-guide-toggle", 0);
    runtime.clickRenderedByClassNth("flow-steps", "logic-narrative-request", 0);
    await delivery.requestFunctionNarratives(runtime.messages.at(-1)!.payload as FunctionNarrativesRequest);
    for (const message of messages.filter((message) => message.type === "codeFlow/functionNarrativesLoaded")) runtime.dispatchMessage(message);
    const count = calls; assert.ok(count > 1);
    const inputTitle = "Scenario input for PARAM value";
    assert.equal(runtime.getRenderedValueByTitle("flow-steps", inputTitle), "-1");
    assert.equal(runtime.isDisabled(runtime.getRenderedIdentityByTitle("flow-steps", inputTitle)), false);
    runtime.inputByTitle(inputTitle, "99");
    runtime.dispatchMessage({ type: "ui/language", payload: { language: "ko" } });
    assert.equal(runtime.getRenderedValueByTitle("flow-steps", "매개변수 value의 시나리오 입력"), "99");
    runtime.dispatchMessage({ type: "ui/language", payload: { language: "en" } });
    runtime.clickRenderedByClassNth("flow-steps", "logic-narrative-next", 0);
    await delivery.requestFunctionNarratives(runtime.messages.at(-1)!.payload as FunctionNarrativesRequest);
    runtime.dispatchMessage(messages.at(-1)!);
    runtime.clickRenderedByClassNth("flow-steps", "logic-narrative-select", 0);
    assert.equal(runtime.getRenderedValueByTitle("flow-steps", inputTitle), "1");
    runtime.clickRenderedByClassNth("flow-steps", "logic-narrative-graph", 0);
    assert.equal(runtime.getRenderedAttributeByClass("flow-steps", "logic-graph-node", "aria-pressed"), "true");
    const reply = messages.filter((message) => message.type === "codeFlow/functionNarrativesLoaded").at(-1)!;
    assert.ok(reply.type === "codeFlow/functionNarrativesLoaded");
    const scenario = reply.payload.narrative!.scenarios[0];
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-narrative-analysis"), 1);
    runtime.selectRenderedByClassNth("flow-steps", "logic-narrative-node-select", 0, scenario.nodeDetails!.at(-2)!.nodeId);
    assert.ok(runtime.getRenderedText("flow-steps").some((text) => text.includes("Proceed or return the classified result.")));
    runtime.clickRenderedByClassNth("flow-steps", "logic-narrative-node-source", 0);
    assert.equal(runtime.messages.at(-1)!.type, "codeFlow/openFunctionNarrativeSource");
    await delivery.openFunctionNarrativeSource(runtime.messages.at(-1)!.payload as FunctionNarrativeSourceRequest);
    assert.equal(opened.length, 1);
    runtime.clickRenderedByClassNth("flow-steps", "logic-narrative-previous", 0);
    await delivery.requestFunctionNarratives(runtime.messages.at(-1)!.payload as FunctionNarrativesRequest);
    runtime.dispatchMessage(messages.at(-1)!);
    runtime.clickRenderedByClassNth("flow-steps", "logic-narrative-apply", 0);
    assert.equal(runtime.getRenderedValueByTitle("flow-steps", inputTitle), "-1");
    assert.equal(runtime.getFocusedElementId(), runtime.getRenderedIdentityByTitle("flow-steps", inputTitle));
    runtime.clickRenderedByClassNth("flow-steps", "logic-value-preview-recommend", 0);
    assert.equal(runtime.getRenderedAttributeByClass("flow-steps", "logic-guide-toggle", "aria-expanded"), "true",
      "the model-example action switches from Values to the actual Guide reading surface");
    assert.equal(calls, count, "the model-example action opens saved explanations without re-running the model");
    assert.equal(runtime.messages.filter((message) => message.type === "codeFlow/requestScenarioInputs").length, 0, "Kotlin never starts the unsupported static evaluator");
  } finally { delivery.clearScenarioInputs(); runtime.restore(); }
});
