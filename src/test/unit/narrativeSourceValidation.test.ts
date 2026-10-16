/** Compact source validation survives action disposal, detects real file/graph changes and cancels its own pending reads. */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { withNarrativeWorkspace, sourceLimits } from "../helpers/narrativeSourceWorkspace";
import { captureNarrativeSources } from "../../application/narrativeSources";
import { SourceCaptureError } from "../../shared/narrativeSources";

const changed = (error: unknown) => error instanceof SourceCaptureError && error.code === 'source-changed';

test('cache receipt validates real files after its source action lease is disposed', async () => {
  await withNarrativeWorkspace(async workspace => {
    const lease = await workspace.capture(), receipt = lease.createValidationReceipt(); lease.dispose();
    try { await receipt.assertCurrent(new AbortController().signal); }
    finally { receipt.dispose(); }
    await assert.rejects(receipt.assertCurrent(new AbortController().signal), (error: unknown) => error instanceof SourceCaptureError && error.code === 'disposed');
    assert.throws(() => lease.createValidationReceipt(), (error: unknown) => error instanceof SourceCaptureError && error.code === 'disposed');
  });
});

test('cache receipt rejects actual callee file changes without retaining an acquisition lease', async () => {
  await withNarrativeWorkspace(async workspace => {
    const lease = await workspace.capture(), receipt = lease.createValidationReceipt(); lease.dispose();
    try {
      await fs.appendFile(workspace.helperPath, '\n// real closed file changed');
      await assert.rejects(receipt.assertCurrent(new AbortController().signal), changed);
    } finally { receipt.dispose(); }
  });
});

test('cache graph receipt detects newly added incoming callers under an unchanged graph header', async () => {
  await withNarrativeWorkspace(async workspace => {
    const lease = await workspace.capture(), receipt = lease.createValidationReceipt(); lease.dispose();
    try {
      workspace.graph.edges.push({ id: 'new-incoming-caller', kind: 'calls', sourceId: 'new-unknown-caller', targetId: workspace.node('root').id, filePath: workspace.rootPath, confidence: 'unresolved' });
      await assert.rejects(receipt.assertCurrent(new AbortController().signal), changed);
    } finally { receipt.dispose(); }
  });
});

test('cache graph receipt rejects snapshot replacement even when serialized content is identical', async () => {
  await withNarrativeWorkspace(async workspace => {
    const lease = await workspace.capture(), receipt = lease.createValidationReceipt(); lease.dispose();
    try { workspace.current = structuredClone(workspace.graph); await assert.rejects(receipt.assertCurrent(new AbortController().signal), changed); }
    finally { receipt.dispose(); }
  });
});

test('evicting a receipt aborts its pending source read and cannot publish a late validation', async () => {
  await withNarrativeWorkspace(async workspace => {
    let gated = false, begin!: () => void, release!: () => void, readSignal: AbortSignal | undefined;
    const entered = new Promise<void>(resolve => { begin = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const lease = await captureNarrativeSources({ graph: workspace.authority(), rootIds: [workspace.node('root').id], limits: sourceLimits,
      signal: new AbortController().signal, reader: { async read(file, maximum, signal) {
        if (gated) { readSignal = signal; begin(); await gate; }
        return workspace.reader.read(file, maximum, signal);
      } } });
    const receipt = lease.createValidationReceipt(); lease.dispose(); gated = true;
    const pending = receipt.assertCurrent(new AbortController().signal);
    const checked = assert.rejects(pending, (error: unknown) => error instanceof SourceCaptureError && ['cancelled', 'disposed'].includes(error.code));
    try { await entered; receipt.dispose(); assert.equal(readSignal?.aborted, true); release(); await checked; }
    finally { release(); receipt.dispose(); }
  });
});
