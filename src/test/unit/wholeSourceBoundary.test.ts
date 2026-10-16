/** Complete-source model requests remain immutable, fully validated and pending until provider cleanup settles. No model is loaded. */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { wholeNarrativeHostFixture } from "../helpers/wholeNarrativeHost";
import { createCapturedNarrativeContext, getNarrativeSourceRoots, sealNarrativeModelContext } from "../../application/narrativeSources";
import { requestFunctionNarrative, FunctionNarrativeError } from "../../application/functionNarratives";
import { createLocalFunctionNarrativeProvider } from "../../llm/functionNarratives/localProvider";
import { ModelTaskManager } from "../../shared/modelTasks";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

/** Only production capture/projection constructs the context used at the asynchronous model boundary. */
async function sourceContext() {
  const fixture = await wholeNarrativeHostFixture(0);
  const lease = await fixture.access.capture({ graph: fixture.graph, rootIds: getNarrativeSourceRoots(fixture.graph, fixture.root.id, 8),
    getCurrentGraph: () => fixture.graphDelivery.current()?.graph, signal: new AbortController().signal });
  const context = createCapturedNarrativeContext({ functionName: fixture.root.name, language: 'typescript', snippets: [], limited: false }, lease, fixture.root.id).context;
  return { fixture, lease, context };
}

/** Deliberate external-provider reply; structural validation does not claim semantic model accuracy. */
function response(context: FunctionNarrativeContext) {
  const root = context.snippets.find(snippet => snippet.role === 'function')!;
  return { modelName: 'External boundary fixture', text: JSON.stringify({ summary: 'Read the supplied source declaration.', scenarios: [{
    title: 'Source reading', when: ['A supplied source route'], outcome: 'The source return reaches its caller.', assumptions: [],
    steps: [{ text: 'Read the supplied declaration.', source: { snippetId: root.id, startLine: root.startLine, endLine: root.startLine } }]
  }], limitations: [] }) };
}

test('complete model context cannot be rewritten by an asynchronous provider', async () => {
  const { context, lease } = await sourceContext(), before = JSON.stringify(context);
  try {
    await assert.rejects(requestFunctionNarrative({ async generate(input) {
      input.snippets[0].text = 'a substituted source body'; return response(input);
    } }, context, 'en', new AbortController().signal, 10000), TypeError);
    assert.equal(JSON.stringify(context), before); assert.ok(Object.isFrozen(context.sourceEvidence!.relations));
  } finally { lease.dispose(); }
});

test('managed provider cannot bypass independent whole-source response validation', async () => {
  const { context, lease } = await sourceContext();
  try {
    await assert.rejects(requestFunctionNarrative({ managesDeadlines: true, async generate() { return { modelName: 'Fixture', text: '{}' }; } },
      context, 'en', new AbortController().signal, 10000), (error: unknown) => error instanceof FunctionNarrativeError && error.code === 'invalid-response');
  } finally { lease.dispose(); }
});

test('whole-source cancellation waits for actual provider settlement before rejecting the outer request', async () => {
  const { context, lease } = await sourceContext(), controller = new AbortController();
  let release!: () => void, start!: () => void, settled = false;
  const entered = new Promise<void>(resolve => { start = resolve; });
  const closed = new Promise<void>(resolve => { release = resolve; });
  const request = requestFunctionNarrative({ async generate(input, _language, signal) {
    start(); await closed; assert.equal(signal.aborted, true); return response(input);
  } }, context, 'en', controller.signal, 10000);
  const checked = assert.rejects(request, (error: unknown) => error instanceof FunctionNarrativeError && error.code === 'cancelled').finally(() => { settled = true; });
  try {
    await entered; controller.abort(); await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
    release(); await checked; assert.equal(settled, true);
  } finally { release(); lease.dispose(); }
});

test('context sealing rejects a whole over-budget object graph before freezing any partial task', async () => {
  const { context, lease } = await sourceContext();
  try {
    assert.throws(() => sealNarrativeModelContext(context, 0, 100000), (error: unknown) => error instanceof FunctionNarrativeError && error.code === 'context-too-large');
    assert.equal(Object.isFrozen(context), false); assert.equal(Object.isFrozen(context.snippets), false);
  } finally { lease.dispose(); }
});

test('required roots include every immediate caller and lexical parent with cycle and depth guards', async () => {
  const fixture = await wholeNarrativeHostFixture(0), graph = structuredClone(fixture.graph);
  const root = graph.nodes.find(node => node.id === fixture.root.id)!;
  root.parentId = 'lexical-parent';
  graph.nodes.push({ ...root, id: 'lexical-parent', name: 'lexicalParent', parentId: 'outer-parent' },
    { ...root, id: 'outer-parent', name: 'outerParent', parentId: root.id });
  const roots = getNarrativeSourceRoots(graph, root.id, 4);
  assert.ok(roots.includes(root.id)); assert.ok(roots.includes('lexical-parent')); assert.ok(roots.includes('outer-parent'));
  assert.ok(roots.includes(graph.nodes.find(node => node.name === 'outsideCaller')!.id));
  assert.equal(new Set(roots).size, roots.length);
  assert.throws(() => getNarrativeSourceRoots(graph, root.id, 1), /depth budget/u);
});

test('whole-source local generation never obtains an answer from a source-prose port', async () => {
  const { context, lease } = await sourceContext(), manager = new ModelTaskManager();
  let sourceAnswers = 0;
  context.callTask = { scope: 'overview', signature: 'checkout', includeSummary: true, sequence: [], conditions: [], routeStatus: 'structure', sourceLimited: false, targets: [] };
  context.sourceCallReadings = { read() { sourceAnswers++; return { summary: 'A synthesized answer.', flow: 'A synthesized source flow.', calls: [], limitations: [] }; } };
  const absent = path.join(os.tmpdir(), 'no-model-' + randomUUID());
  const provider = createLocalFunctionNarrativeProvider({ binaryPath: absent, modelPath: absent + '.gguf', taskManager: manager });
  try {
    await assert.rejects(provider.generate(context, 'en', new AbortController().signal), (error: unknown) => error instanceof FunctionNarrativeError && error.code === 'unavailable');
    assert.equal(sourceAnswers, 0); assert.equal(manager.idle, true);
  } finally { lease.dispose(); await manager.dispose(); }
});
