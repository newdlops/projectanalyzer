/** Opaque Host authorization and stale-request suppression for the independent call mode. */
import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow";
import { FunctionCallsHostDelivery } from "../../webview/functionCalls";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { functionCallsToken, loadFunctionCallsFixture } from "./helpers/functionCallsFixture";

/** Prepares real registries and a controllable source boundary without loading the VS Code API. */
async function harness(read?: () => Promise<string | undefined>) {
  const fixture = await loadFunctionCallsFixture();
  const graphDelivery = new WebviewGraphDelivery();
  const graphVersion = graphDelivery.activate(fixture.graph).snapshot.version;
  const sourceNodeTokens = new SourceNodeTokenRegistry();
  const evidenceTokens = new CodeFlowEvidenceTokenRegistry();
  sourceNodeTokens.activate(graphVersion, fixture.graph);
  evidenceTokens.activate(graphVersion, fixture.graph);
  const root = fixture.analysis("processBatch").functionNode;
  const messages: FunctionCallsResponse[] = [];
  let reads = 0;
  const delivery = new FunctionCallsHostDelivery({ graphDelivery, sourceNodeTokens, evidenceTokens,
    readSourceText: async () => { reads += 1; return read ? read() : fixture.file.content; },
    postMessage: async message => { messages.push(message); } });
  return { ...fixture, root, delivery, graphDelivery, sourceNodeTokens, evidenceTokens, messages, reads: () => reads,
    request: { graphVersion, sourceToken: sourceNodeTokens.createToken(root.id)!, requestId: 1 } };
}

test("call Host serves issued functions with source evidence and preserves a dirty root override", async () => {
  const h = await harness();
  assert.equal(h.reads(), 0);
  h.delivery.reset(h.root.id, h.file.content.replace("if (!enabled)", "if (enabled === false)"));
  await h.delivery.load(h.request);
  assert.equal(h.reads(), 0);
  assert.equal(h.messages[0].status, "ready");
  assert.equal(h.messages[0].connections[0].guards[0].expression, "enabled === false");
  const evidence = h.messages[0].connections[0].evidenceToken;
  assert.match(evidence ?? "", /^code-evidence:[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(h.messages), /\/workspace\//u);
  const child = h.messages[0].nodes.find(node => node.name === "persist")!;
  await h.delivery.load({ ...h.request, sourceToken: child.sourceToken!, requestId: 2 });
  assert.equal(h.reads(), 1);
  assert.equal(h.messages[1].connections.length, 1);
  await h.delivery.load({ ...h.request, requestId: 2 });
  assert.equal(h.messages.length, 2, "replayed sequences do not repeat work");
});

test("call Host contains unknown authority and unavailable source without exposing errors", async () => {
  const h = await harness(async () => undefined);
  await h.delivery.load({ ...h.request, sourceToken: functionCallsToken("never-issued") });
  assert.equal(h.messages[0].status, "stale");
  assert.equal(h.reads(), 0);
  await h.delivery.load({ ...h.request, requestId: 2 });
  assert.equal(h.messages[1].status, "unavailable");
  const failed = await harness(async () => { throw new Error("/private/secret-path"); });
  await failed.delivery.load(failed.request);
  assert.equal(failed.messages[0].status, "failed");
  assert.doesNotMatch(JSON.stringify(failed.messages), /secret-path/u);
});

test("call Host drops source reads that finish after a root reset or graph replacement", async () => {
  for (const invalidate of ["root", "graph"]) {
    let release!: (source: string) => void;
    const h = await harness(() => new Promise(resolve => { release = resolve; }));
    const pending = h.delivery.load(h.request);
    if (invalidate === "root") h.delivery.reset();
    else h.graphDelivery.activate({ ...h.graph, version: "2" });
    release(h.file.content);
    await pending;
    assert.equal(h.messages.length, 0);
  }
});
