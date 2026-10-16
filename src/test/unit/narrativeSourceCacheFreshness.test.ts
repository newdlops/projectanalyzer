/** Stale source can never regain narrative authority through cached pages, nodes, source navigation or repeated generation. */
import assert from "node:assert/strict";
import test from "node:test";
import { createWholeNarrativeRootHost as rootHost } from "../helpers/wholeNarrativeRootHost";
import { createWholeNarrativeCallHost as callHost } from "../helpers/wholeNarrativeCallHost";
import { functionCallReadingReply } from "./helpers/functionCallReadingFixture";

test('root teardown source change revokes completed pages and repeated generation without another provider request', async () => {
  const h = await rootHost({ async release() { h.files[0].content += '// changed after all writes'; h.state.revision++; } });
  try {
    await h.delivery.requestFunctionNarratives(h.request); assert.equal(h.writes(), 2); assert.equal(h.replies().at(-1)?.status, 'stale');
    const calls = h.contexts.length;
    await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: 'en' });
    assert.equal(h.replies().at(-1)?.status, 'stale'); assert.equal(h.storedPages(), 0);
    await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 3 });
    assert.equal(h.replies().at(-1)?.status, 'stale'); assert.equal(h.contexts.length, calls);
  } finally { h.delivery.clearScenarioInputs(); }
});

test('call teardown source change revokes complete readings before cache paging or regeneration', async () => {
  let calls = 0, preparations = 0;
  const h = await callHost(f => ({ async prepare() { preparations++; }, async generate(context) { calls++; return functionCallReadingReply(context); },
    async withRun(_language, _signal, operation) { try { return await operation(); } finally { f.events.push('provider-released'); f.files[1].content += '// late callee edit'; f.state.revision++; } } }));
  try {
    await h.host.explain(h.request); assert.equal(h.messages.at(-1)?.status, 'stale'); const count = calls;
    await h.host.explain({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: 'en' }); assert.equal(h.messages.at(-1)?.status, 'stale');
    await h.host.explain({ ...h.request, requestId: 3 }); assert.equal(h.messages.at(-1)?.status, 'stale');
    assert.equal(calls, count); assert.equal(preparations, 1);
  } finally { h.host.reset(); }
});

test('root page cache validates current source even after a previously successful action', async () => {
  const h = await rootHost();
  try {
    await h.delivery.requestFunctionNarratives(h.request); assert.equal(h.replies().at(-1)?.status, 'ready');
    const calls = h.contexts.length; h.files[0].content += '// after success'; h.state.revision++;
    await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, pageIndex: 1, pageLanguage: 'en' });
    assert.equal(h.replies().at(-1)?.status, 'stale'); assert.equal(h.contexts.length, calls); assert.equal(h.storedPages(), 0);
  } finally { h.delivery.clearScenarioInputs(); }
});

test('call cache validates transitive source before serving a completed page', async () => {
  const h = await callHost();
  try {
    await h.host.explain(h.request); assert.equal(h.messages.at(-1)?.status, 'ready'); const calls = h.contexts.length;
    h.files[1].content += '// callee changed after success'; h.state.revision++;
    await h.host.explain({ ...h.request, requestId: 2, pageIndex: 2, pageLanguage: 'en' });
    assert.equal(h.messages.at(-1)?.status, 'stale'); assert.equal(h.contexts.length, calls);
  } finally { h.host.reset(); }
});

test('source mutation inside cached page storage I/O is checked again before ready', async () => {
  let editOnRead = false;
  const h = await rootHost({ async read() { if (editOnRead) { editOnRead = false; h.files[0].content += '// edit during read'; h.state.revision++; } } });
  try {
    await h.delivery.requestFunctionNarratives(h.request); assert.equal(h.replies().at(-1)?.status, 'ready'); editOnRead = true;
    await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: 'en' });
    assert.equal(h.replies().at(-1)?.status, 'stale'); assert.equal(h.storedPages(), 0);
  } finally { h.delivery.clearScenarioInputs(); }
});

test('node cache cannot publish a source-bound narrative after graph metadata changes in place', async () => {
  const h = await rootHost();
  try {
    await h.delivery.requestFunctionNarratives(h.request); const nodeId = h.replies().at(-1)?.narrative?.scenarios[0].nodeDetails?.[0].nodeId; assert.ok(nodeId);
    h.root.metadata = { ...h.root.metadata, cacheEdit: 'changed after success' };
    await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, nodeId, pageLanguage: 'en' });
    assert.equal(h.replies().at(-1)?.status, 'stale');
  } finally { h.delivery.clearScenarioInputs(); }
});

test('cached source navigation does not open or restore a narrative after a caller source change', async () => {
  const h = await rootHost();
  try {
    await h.delivery.requestFunctionNarratives(h.request); assert.equal(h.replies().at(-1)?.status, 'ready');
    h.files[2].content += '// caller changed'; h.state.revision++;
    await h.delivery.openFunctionNarrativeSource({ ...h.request, contextId: h.contextId, language: 'en', pageIndex: 0, scenarioIndex: 0, stepIndex: 0 });
    assert.equal(h.opened.length, 0); assert.equal(h.storedPages(), 0);
  } finally { h.delivery.clearScenarioInputs(); }
});

test('source-stale root action awaits disposal of its completed page store before settling', async () => {
  let begin!: () => void, release!: () => void, settled = false;
  const entered = new Promise<void>(resolve => { begin = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const h = await rootHost({ async release() { h.files[0].content += '// stale on release'; h.state.revision++; },
    async dispose(hasPages) { if (hasPages) { begin(); await gate; } } });
  try {
    const pending = h.delivery.requestFunctionNarratives(h.request).finally(() => { settled = true; });
    await entered; assert.equal(settled, false); assert.ok(!h.replies().some(reply => reply.status === 'ready'));
    release(); await pending; assert.equal(h.storedPages(), 0); assert.equal(h.replies().at(-1)?.status, 'stale');
  } finally { release(); h.delivery.clearScenarioInputs(); }
});

test('root cleanup failure cannot regain whole-action success through completed cache pages', async () => {
  const h = await rootHost({ async release() { throw new Error('Fixture release failure'); } });
  try {
    await h.delivery.requestFunctionNarratives(h.request); assert.equal(h.writes(), 2); assert.equal(h.replies().at(-1)?.status, 'failed');
    const calls = h.contexts.length;
    await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: 'en' });
    assert.equal(h.replies().at(-1)?.status, 'stale'); assert.equal(h.storedPages(), 0); assert.equal(h.contexts.length, calls);
  } finally { h.delivery.clearScenarioInputs(); }
});

test('call cleanup failure cannot promote a complete response set through a cache hit', async () => {
  let calls = 0;
  const h = await callHost(() => ({ async generate(context) { calls++; return functionCallReadingReply(context); },
    async withRun(_language, _signal, operation) { await operation(); throw new Error('Fixture release failure'); } }));
  try {
    await h.host.explain(h.request); assert.equal(h.messages.at(-1)?.status, 'failed'); const count = calls;
    await h.host.explain({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: 'en' });
    assert.equal(h.messages.at(-1)?.status, 'stale'); assert.equal(calls, count);
  } finally { h.host.reset(); }
});

test('root cache waits for a completed action still inside provider teardown without starting another model', async () => {
  let begin!: () => void, release!: () => void, cachedSettled = false;
  const entered = new Promise<void>(resolve => { begin = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const h = await rootHost({ async release() { begin(); await gate; } });
  try {
    const action = h.delivery.requestFunctionNarratives(h.request); await entered; const calls = h.contexts.length;
    const cached = h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: 'en' }).finally(() => { cachedSettled = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(cachedSettled, false); assert.equal(h.contexts.length, calls);
    release(); await action; await cached; assert.equal(h.replies().at(-1)?.status, 'ready'); assert.equal(h.replies().at(-1)?.cacheHit, true);
  } finally { release(); h.delivery.clearScenarioInputs(); }
});

test('call cache waits for provider teardown rather than promoting a still-owned complete response set', async () => {
  let begin!: () => void, release!: () => void, cachedSettled = false, calls = 0;
  const entered = new Promise<void>(resolve => { begin = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const h = await callHost(f => ({ async generate(context) { calls++; return functionCallReadingReply(context); },
    async withRun(_language, _signal, operation) { try { return await operation(); } finally { begin(); await gate; f.events.push('provider-released'); } } }));
  try {
    const action = h.host.explain(h.request); await entered; const count = calls;
    const cached = h.host.explain({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: 'en' }).finally(() => { cachedSettled = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(cachedSettled, false); assert.equal(calls, count);
    release(); await action; await cached; assert.equal(h.messages.at(-1)?.status, 'ready'); assert.equal(h.messages.at(-1)?.cacheHit, true);
  } finally { release(); h.host.reset(); }
});
