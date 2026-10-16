/** Real root Host/source wiring, storage freshness and teardown ordering; model responses remain explicit test doubles. */
import assert from "node:assert/strict";
import test from "node:test";
import { createWholeNarrativeRootHost as rootHost } from "../helpers/wholeNarrativeRootHost";

test('actual root Host reacquires complete long source and callers after preparation, then serves every stored page after teardown', async () => {
  const h = await rootHost();
  try {
    assert.equal(h.state.captures, 0); assert.equal(h.contexts.length, 0);
    await h.delivery.requestFunctionNarratives(h.request);
    assert.equal(h.replies().at(-1)?.status, 'ready'); assert.ok(h.contexts.length > 2);
    assert.equal(h.state.captures, 1); assert.equal(h.state.disposed, 1);
    assert.ok(h.events.indexOf('prepare') < h.events.indexOf('capture'));
    const done = h.replies().at(-1)!;
    assert.equal(done.coverage?.complete, true); assert.equal(done.coverage?.total, 2); assert.equal(done.page?.count, 2);
    assert.equal(h.writes(), 2);
    const calls = h.contexts.length;
    await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, pageIndex: 1, pageLanguage: 'en' });
    assert.equal(h.contexts.length, calls); assert.equal(h.state.captures, 1); assert.equal(h.replies().at(-1)?.cacheHit, true);
    assert.equal(h.replies().at(-1)?.page?.index, 1);
    assert.ok(h.leases[0].capture.rootIds.includes(h.graph.nodes.find(node => node.name === 'outsideCaller')!.id));
  } finally { h.delivery.clearScenarioInputs(); }
});

test('root source change during page storage cannot commit a page or publish ready', async () => {
  const h = await rootHost({ mutateDuringWrite: true });
  try {
    await h.delivery.requestFunctionNarratives(h.request);
    assert.equal(h.writes(), 1); assert.equal(h.state.disposed, 1);
    assert.ok(!h.replies().some(reply => reply.status === 'ready'));
    assert.equal(h.replies().at(-1)?.status, 'stale'); assert.equal(h.replies().at(-1)?.coverage?.completed, 0);
    await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: 'en' });
    assert.equal(h.replies().at(-1)?.status, 'stale');
  } finally { h.delivery.clearScenarioInputs(); }
});

test('root cancellation during provider release suppresses ready and still disposes the whole source lease', async () => {
  let beginRelease!: () => void, finishRelease!: () => void;
  const entered = new Promise<void>(resolve => { beginRelease = resolve; });
  const gate = new Promise<void>(resolve => { finishRelease = resolve; });
  const h = await rootHost({ async release() { beginRelease(); await gate; } });
  try {
    const pending = h.delivery.requestFunctionNarratives(h.request);
    await entered;
    assert.equal(h.writes(), 2); assert.ok(h.contexts.length > 2);
    assert.ok(!h.replies().some(reply => reply.status === 'ready'));
    h.delivery.cancelFunctionNarratives(h.request); finishRelease(); await pending;
    assert.equal(h.state.disposed, 1); assert.ok(!h.replies().some(reply => reply.status === 'ready'));
  } finally { finishRelease(); h.delivery.clearScenarioInputs(); }
});
