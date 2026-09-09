/** Host/browser boundary tests use real projections and an injected model, never a live network. */
import assert from "node:assert/strict";
import test from "node:test";
import { CodeFlowInsightCache } from "../../application/codeFlow";
import type { ScenarioInputProvider, ScenarioInputProviderResult } from "../../application/scenarioInputs";
import { ScenarioInputError } from "../../application/scenarioInputs";
import type { ExtensionResponse } from "../../protocol/messages";
import type { ScenarioInputsRequest } from "../../protocol/scenarioInputs";
import type { SymbolNode } from "../../shared/types";
import { CodeFlowHostDelivery } from "../../webview/codeFlow/codeFlowHostDelivery";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow/codeFlowEvidenceTokenRegistry";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { getFunctionVisualizerHtml } from "../../webview/functionVisualizer/functionVisualizerHtml";
import { createGraph } from "./helpers/projectReadingGuideFixtures";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

const response: ScenarioInputProviderResult = { modelName: "Fixture model", text: JSON.stringify({ scenarios: [
  { title: "Negative count", reason: "A negative count challenges the external policy; its response remains unknown.", inputs: { x: -99 }, assumptions: ["External policy has not been evaluated."] }
] }) };

/** Activates the same graph, token and model-provider boundaries as the extension panel. */
async function setup(provider: ScenarioInputProvider, sourceText = 'export function inspect(x: number) {\n return externalPolicy(x);\n}') {
  const node: SymbolNode = { id: "function:delivery", name: "inspect", qualifiedName: "inspect", kind: "function", language: "typescript", filePath: "/workspace/delivery.ts",
    range: { startLine: 0, startCharacter: 0, endLine: 2, endCharacter: 1 },
    selectionRange: { startLine: 0, startCharacter: 16, endLine: 0, endCharacter: 23 } };
  const graph = createGraph({ files: [node.filePath], callables: [node] });
  const graphDelivery = new WebviewGraphDelivery(); const version = graphDelivery.activate(graph).snapshot.version;
  const sourceNodeTokens = new SourceNodeTokenRegistry(); sourceNodeTokens.activate(version, graph);
  const evidenceTokens = new CodeFlowEvidenceTokenRegistry(); evidenceTokens.activate(version, graph);
  const messages: ExtensionResponse[] = [];
  const delivery = new CodeFlowHostDelivery({ graphDelivery, sourceNodeTokens, evidenceTokens, insightCache: new CodeFlowInsightCache(),
    getUiLanguage: () => "en", readSourceText: async () => sourceText, openEvidenceLocation: async () => {},
    logger: { debug() {}, info() {}, warn() {}, error() {} }, scenarioInputProvider: provider,
    postMessage: async (message) => { messages.push(message); } });
  await delivery.publishFunctionNode(version, node.id, sourceText);
  const detail = messages.find((message) => message.type === "codeFlow/detailLoaded");
  assert.ok(detail?.type === "codeFlow/detailLoaded");
  const request: ScenarioInputsRequest = { graphVersion: version, flowId: detail.payload.id, requestId: 1 };
  return { delivery, detail, request, messages, graphDelivery, rootToken: sourceNodeTokens.createToken(node.id)! };
}

test("model invocation is explicit, uses Host source context, and ignores repeated request IDs", async () => {
  let calls = 0; let functionName = "";
  const fixture = await setup({ suggest: async (context) => { calls += 1; functionName = context.declaration.functionNode.name; return response; } });
  assert.equal(calls, 0);
  assert.equal(fixture.detail.payload.logic?.tutor?.inputSuggestions?.available, true);
  await fixture.delivery.requestScenarioInputs({ ...fixture.request, flowId: `code-flow:${"b".repeat(32)}` });
  assert.equal(calls, 0);
  await fixture.delivery.requestScenarioInputs(fixture.request);
  assert.equal(calls, 1); assert.equal(functionName, "inspect");
  const reply = fixture.messages.at(-1);
  assert.ok(reply?.type === "codeFlow/scenarioInputsLoaded" && reply.payload.status === "ready");
  assert.equal(reply.payload.seeds?.[0].source, "model");
  assert.equal(reply.payload.seeds?.[0].quality?.status, "partial");
  assert.doesNotMatch(JSON.stringify(reply.payload), /\/workspace\/|function:delivery|"logic-block:/u);
  await fixture.delivery.requestScenarioInputs(fixture.request);
  assert.equal(calls, 1);
  await fixture.delivery.requestScenarioInputs({ ...fixture.request, requestId: 2 });
  const duplicate = fixture.messages.at(-1);
  assert.ok(duplicate?.type === "codeFlow/scenarioInputsLoaded" && duplicate.payload.status === "empty");
  fixture.delivery.clearScenarioInputs();
});

test("the first recommendation click requests inference and preserves edits or cancellation during the reply", async () => {
  for (const mode of ["apply", "edit", "cancel"] as const) {
    const fixture = await setup({ suggest: async () => ({ modelName: "Checked fixture", text: JSON.stringify({ scenarios: [{ title: "Negative boundary", reason: "Takes the negative guard", inputs: { x: -99 } }] }) }) }, 'export function inspect(x: number) {\n if (x < 0) return 1;\n return 0;\n}');
    const runtime = installSidebarWebviewRuntime();
    try {
      const html = getFunctionVisualizerHtml({ webview: { cspSource: "vscode-webview:" } as never, nonce: "first-recommend" });
      new Function(html.match(/<script nonce="first-recommend">([\s\S]*)<\/script>/u)![1])();
      runtime.dispatchMessage({ type: "functionVisualizer/sessionLoaded", payload: { graphVersion: fixture.request.graphVersion, root: { sourceToken: fixture.rootToken, label: "inspect" } } });
      runtime.dispatchMessage(structuredClone(fixture.detail));
      runtime.inputByTitle("Scenario input for PARAM x", "1234");
      assert.equal(runtime.messages.filter((message) => message.type === "codeFlow/requestScenarioInputs").length, 0);
      runtime.clickRenderedByClassNth("flow-steps", "logic-value-preview-recommend", 0);
      const request = runtime.messages.at(-1); assert.equal(request?.type, "codeFlow/requestScenarioInputs");
      if (mode === "edit") runtime.inputByTitle("Scenario input for PARAM x", "5678");
      if (mode === "cancel") runtime.clickRenderedByClassNth("flow-steps", "logic-value-preview-recommend", 0);
      await fixture.delivery.requestScenarioInputs(request!.payload as ScenarioInputsRequest);
      runtime.dispatchMessage(fixture.messages.at(-1)!);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const value = runtime.getRenderedValueByTitle("flow-steps", "Scenario input for PARAM x");
      // The response duplicates an already-checked negative branch, so the existing -1 case wins.
      assert.equal(value, mode === "apply" ? "-1" : mode === "edit" ? "5678" : "1234");
      if (mode === "apply") {
        assert.ok(runtime.countRenderedByClass("flow-steps", "logic-scenario-workspace-detail-actions") > 0,
          "first recommendation prepares a playable story before any workspace interaction");
      }
    } finally { fixture.delivery.clearScenarioInputs(); runtime.restore(); }
  }
});

test("cancellation and expired roots discard late model output", async () => {
  for (const kind of ["cancel", "root"] as const) {
    let finish: (result: ScenarioInputProviderResult) => void = () => {};
    let started: () => void = () => {};
    const invoked = new Promise<void>((resolve) => { started = resolve; });
    const fixture = await setup({ suggest: async () => { started(); return new Promise((resolve) => { finish = resolve; }); } });
    const running = fixture.delivery.requestScenarioInputs(fixture.request);
    await invoked;
    if (kind === "cancel") fixture.delivery.cancelScenarioInputs(fixture.request);
    else { fixture.graphDelivery.clear(); fixture.delivery.clearScenarioInputs(); }
    await running;
    finish(response); await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(fixture.messages.every((message) => message.type !== "codeFlow/scenarioInputsLoaded" || message.payload.status !== "ready"));
    fixture.delivery.clearScenarioInputs();
  }
});

test("model errors produce finite retry states without leaking provider error text", async () => {
  for (const code of ["unavailable", "denied", "invalid-response", "timeout"] as const) {
    const fixture = await setup({ suggest: async () => { throw new ScenarioInputError(code); } });
    await fixture.delivery.requestScenarioInputs(fixture.request);
    const reply = fixture.messages.at(-1);
    assert.ok(reply?.type === "codeFlow/scenarioInputsLoaded"); assert.equal(reply.payload.status, code);
    fixture.delivery.clearScenarioInputs();
  }
});

test("browser adds neural rows and training diagnostics while retaining edits, selection and graph DOM", async () => {
  const fixture = await setup({ suggest: async () => ({ ...response, training: { trainingSamples: 320, validationSamples: 80,
    dimensions: 1, heads: 1, parameters: 74, epochs: 240, initialLoss: 1, finalLoss: 0.01, validationError: 0.015, evaluations: 440 } }) });
  const runtime = installSidebarWebviewRuntime();
  try {
    const html = getFunctionVisualizerHtml({ webview: { cspSource: "vscode-webview:" } as never, nonce: "ai-test" });
    const script = html.match(/<script nonce="ai-test">([\s\S]*)<\/script>/u)?.[1]; assert.ok(script);
    new Function(script)();
    runtime.dispatchMessage({ type: "functionVisualizer/sessionLoaded", payload: { graphVersion: fixture.request.graphVersion, root: { sourceToken: fixture.rootToken, label: "inspect" } } });
    runtime.dispatchMessage(structuredClone(fixture.detail));
    assert.equal(runtime.messages.filter((message) => message.type === "codeFlow/requestScenarioInputs").length, 0);
    const graphIdentity = runtime.getRenderedIdentityByClassNth("flow-steps", "logic-graph-node", 0);
    const rowsBefore = runtime.countRenderedByClass("flow-steps", "logic-scenario-workspace-row");
    runtime.inputByTitle("Scenario input for PARAM x", "1234");
    runtime.clickRenderedByClassNth("flow-steps", "logic-scenario-ai-request", 0);
    const request = runtime.messages.at(-1); assert.equal(request?.type, "codeFlow/requestScenarioInputs");
    assert.equal(runtime.getRenderedAttributeByClass("flow-steps", "logic-scenario-input-suggestions", "aria-busy"), "true");
    runtime.dispatchMessage({ type: "ui/language", payload: { language: "ko" } });
    assert.equal(runtime.messages.filter((message) => message.type === "codeFlow/requestScenarioInputs").length, 1);
    await fixture.delivery.requestScenarioInputs(request!.payload as ScenarioInputsRequest);
    const reply = fixture.messages.at(-1); assert.ok(reply?.type === "codeFlow/scenarioInputsLoaded");
    runtime.dispatchMessage({ ...reply, payload: { ...reply.payload, requestId: 999 } });
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-scenario-workspace-row"), rowsBefore);
    runtime.dispatchMessage(reply);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-scenario-workspace-row"), rowsBefore + 1);
    assert.ok(runtime.getRenderedText("flow-steps").some((text) => text.includes("학습 320개 · 별도 검증 80개")));
    assert.equal(runtime.getRenderedIdentityByClassNth("flow-steps", "logic-graph-node", 0), graphIdentity);
    runtime.dispatchMessage({ type: "ui/language", payload: { language: "en" } });
    assert.equal(runtime.getRenderedValueByTitle("flow-steps", "Scenario input for PARAM x"), "1234");
    assert.ok(runtime.getRenderedText("flow-steps").some((text) => text.includes("Fixture model")));
    assert.ok(runtime.getRenderedText("flow-steps").some((text) => text.includes("Training: 320 samples · Held out: 80 samples")));
    runtime.dispatchMessage(reply);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-scenario-workspace-row"), rowsBefore + 1);
  } finally { fixture.delivery.clearScenarioInputs(); runtime.restore(); }
});
