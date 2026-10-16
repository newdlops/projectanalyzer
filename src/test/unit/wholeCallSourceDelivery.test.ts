/** Exercise the production call Host with complete real graph sources and actual same-action fixture replies. No neural accuracy is claimed. */
import assert from "node:assert/strict";
import test from "node:test";
import { FunctionCallsHostDelivery } from "../../webview/functionCalls";
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionCallNarrativesResponse } from "../../protocol/functionCallNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import { buildFunctionCallNarrativePrompt, buildFunctionCallNarrativePlan, buildFunctionCallNarrativeContext, parseFunctionCallNarrative } from "../../application/functionCallNarratives";
import { functionCallReadingReply } from "./helpers/functionCallReadingFixture";
import { withNarrativeWorkspace, sourceLimits } from "../helpers/narrativeSourceWorkspace";
import { createNarrativeSourceAccess } from "../../application/narrativeSources";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow/codeFlowEvidenceTokenRegistry";

import { createWholeNarrativeCallHost as callHost } from "../helpers/wholeNarrativeCallHost";

test('actual call Host carries whole long parent/callee/caller closure and all six prior fields across more than eight calls', async () => {
  const h = await callHost();
  try {
    assert.equal(h.state.captures, 0); assert.equal(h.contexts.length, 0);
    await h.host.explain(h.request);
    assert.equal(h.messages.at(-1)?.status, 'ready'); assert.equal(h.messages.at(-1)?.coverage?.completed, 12);
    assert.equal(h.contexts.length, 7); assert.equal(h.actualReplies.length, 12);
    assert.ok(h.events.indexOf('prepare') < h.events.indexOf('capture'));
    assert.equal(h.state.disposed, 1);
    for (const context of h.contexts) {
      assert.ok(context.sourceEvidence); assert.equal(context.sourceCallReadings, undefined);
      assert.equal(context.snippets.find(snippet => snippet.role === 'function')?.text, h.rootText);
      assert.ok(context.snippets.some(snippet => snippet.text === h.helperText));
      assert.ok(context.snippets.some(snippet => snippet.text === h.callerText));
      assert.ok(context.snippets.every(snippet => !snippet.truncated));
      const prompt = buildFunctionCallNarrativePrompt(context, 'en')[1];
      assert.doesNotMatch(prompt, /\/workspace\/|function:|file:|code-evidence:/u);
      assert.ok(!prompt.includes(h.graph.workspaceRoot));
      assert.deepEqual(JSON.parse(prompt).sourceEvidence, context.sourceEvidence);
    }
    const final = h.contexts.at(-1)!;
    assert.deepEqual(final.callTask!.earlierModelReadings, h.actualReplies);
    assert.ok(final.callTask!.earlierModelReadings!.every(call => call.role.length > 100 && call.reason.length > 100));
    assert.equal(final.callTask!.calleeEvidence?.length, 12);
    assert.ok(final.callTask!.calleeEvidence!.every(evidence => evidence.code === h.helperText && !evidence.truncated));
    assert.equal(h.leases[0].capture.declarations.find(row => row.name === 'checkout')?.text, h.rootText);
    const count = h.contexts.length;
    await h.host.explain({ ...h.request, requestId: 2, pageIndex: 5, pageLanguage: 'en' });
    assert.equal(h.contexts.length, count); assert.equal(h.state.captures, 1); assert.equal(h.messages.at(-1)?.cacheHit, true);
  } finally { h.host.reset(); }
});

test('source mutation after a call response rejects publication and disposes the actual lease', async () => {
  let calls = 0;
  const h = await callHost(f => ({ async prepare() { f.events.push('prepare'); }, async generate(context) {
    calls++; const reply = functionCallReadingReply(context); f.files[1].content += '// changed'; f.state.revision++; return reply;
  } }));
  try {
    await h.host.explain(h.request);
    assert.equal(calls, 1); assert.equal(h.state.disposed, 1);
    assert.ok(!h.messages.some(message => message.status === 'ready' || message.status === 'progress'));
    assert.equal(h.messages.at(-1)?.status, 'stale');
  } finally { h.host.reset(); }
});

test('whole source overflow rejects the action before model generation instead of sending a prefix', async () => {
  let calls = 0;
  const h = await callHost(f => ({ async prepare() { f.events.push('prepare'); }, async generate(context) { calls++; return functionCallReadingReply(context); } }), { maxSourceBytes: 1000 });
  try { await h.host.explain(h.request); assert.equal(calls, 0); assert.equal(h.messages.at(-1)?.status, 'context-too-large'); }
  finally { h.host.reset(); }
});

test('complete call plan retains every long signature, sequence expression, guard and loop annotation', async () => {
  const h = await callHost();
  try {
    const slice = structuredClone(h.slice); assert.ok(slice.control);
    slice.control.signature = 'signature '.repeat(200);
    for (const connection of slice.connections) {
      connection.label = 'call expression '.repeat(100);
      connection.guards = Array.from({ length: 9 }, (_, index) => ({ id: 'guard-' + index, expression: 'guard '.repeat(60), outcome: 'outcome '.repeat(20) }));
      connection.loops = Array.from({ length: 7 }, () => 'loop '.repeat(60));
    }
    slice.control.blocks.forEach(block => block.calls.forEach(call => { call.expression = 'whole expression '.repeat(100); }));
    const plan = buildFunctionCallNarrativePlan(slice, h.request);
    assert.equal(plan.facts.signature, slice.control.signature); assert.equal(plan.facts.sequence.length, plan.rows.length);
    assert.ok(plan.facts.sequence.every((row, index) => row.expression === plan.rows[index].expression));
    assert.ok(JSON.stringify(plan.facts.sequence).length > 2600);
    const lease = await h.access.capture({ graph: h.graph, getCurrentGraph: () => h.graphDelivery.current()?.graph,
      rootIds: [h.root.id], signal: new AbortController().signal });
    try {
      const context = await buildFunctionCallNarrativeContext(h.root, h.files[0].content, slice, plan, 0, async token => {
        const node = h.sourceNodeTokens.resolve(token as Parameters<typeof h.sourceNodeTokens.resolve>[0]);
        return node ? { node, source: h.files.find(file => file.path === node.filePath)!.content } : undefined;
      }, token => h.evidenceTokens.resolve(token as Parameters<typeof h.evidenceTokens.resolve>[0])?.range, lease);
      assert.deepEqual(context.callTask!.targets[0].guards, slice.connections[0].guards.map(({ expression, outcome }) => ({ expression, outcome })));
      assert.deepEqual(context.callTask!.targets[0].loops, slice.connections[0].loops);
    } finally { lease.dispose(); }
  } finally { h.host.reset(); }
});

test('actual Rust workspace graph and bounded file reader enter the production complete call Host unchanged', { timeout: 30000 }, async () => {
  await withNarrativeWorkspace(async workspace => {
    const graphDelivery = new WebviewGraphDelivery(), graphVersion = graphDelivery.activate(workspace.graph).snapshot.version;
    const sourceNodeTokens = new SourceNodeTokenRegistry(), evidenceTokens = new CodeFlowEvidenceTokenRegistry();
    sourceNodeTokens.activate(graphVersion, workspace.graph); evidenceTokens.activate(graphVersion, workspace.graph);
    const slices: FunctionCallsResponse[] = [], replies: FunctionCallNarrativesResponse[] = [], contexts: FunctionNarrativeContext[] = [];
    const sourceBefore = JSON.stringify(workspace.graph), root = workspace.node('root');
    const access = createNarrativeSourceAccess(workspace.reader, sourceLimits);
    const host = new FunctionCallsHostDelivery({ graphDelivery, sourceNodeTokens, evidenceTokens, narrativeSources: access,
      getLanguage: () => 'en', readSourceText: async file => (await workspace.reader.read(file, sourceLimits.maxFileBytes, new AbortController().signal))?.text,
      provider: { async prepare() {}, async generate(context) { contexts.push(context); return functionCallReadingReply(context); } },
      async postMessage(message) { slices.push(message); }, async postNarratives(message) { replies.push(message); } });
    try {
      const load = { graphVersion, sourceToken: sourceNodeTokens.createToken(root.id)!, requestId: 1 };
      await host.load(load); const slice = slices.at(-1)!; assert.ok(slice.narratives?.contextId);
      await host.explain({ ...load, contextId: slice.narratives.contextId, scope: 'overview' });
      assert.equal(replies.at(-1)?.status, 'ready'); assert.equal(contexts.length, 1);
      const context = contexts[0]; assert.ok(context.sourceEvidence);
      assert.ok(context.snippets.find(snippet => snippet.role === 'function')!.text.includes('const 기록219'));
      assert.ok(context.snippets.some(snippet => snippet.text.includes('const helper89')));
      assert.ok(context.snippets.every(snippet => !snippet.truncated)); assert.equal(JSON.stringify(workspace.graph), sourceBefore);
    } finally { host.reset(); }
  });
});

test('whole-source call parsing preserves an incomplete raw summary instead of repairing it into a shorter answer', async () => {
  const h = await callHost();
  try {
    await h.host.explain(h.request); const context = h.contexts.at(-1)!;
    const raw = JSON.parse(functionCallReadingReply(context).text);
    raw.summary = 'The supplied call responsibility is retained. This unfinished source clause';
    assert.equal(parseFunctionCallNarrative(JSON.stringify(raw), context, 'en').summary, raw.summary);
  } finally { h.host.reset(); }
});
