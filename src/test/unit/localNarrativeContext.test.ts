/** Context admission regressions exercise full prompt/output budgets and memory reserves without loading weights. */
import assert from "node:assert/strict";
import test from "node:test";
import { localNarrativeContextSettings, selectLocalNarrativeContext, estimateLocalNarrativePromptTokens,
  readLocalNarrativeMemory, type LocalNarrativeMemory } from "../../llm/functionNarratives/context";

const GiB = 1024 ** 3;
const settings = localNarrativeContextSettings();
const memory: LocalNarrativeMemory = { totalBytes: 32 * GiB, availableBytes: 24 * GiB };

test("automatic contexts include the response budget and grow only when needed", () => {
  assert.equal(selectLocalNarrativeContext({ promptTokens: 100, settings, memory }), 8192);
  assert.equal(selectLocalNarrativeContext({ promptTokens: 10000, settings, memory }), 16384);
  assert.equal(selectLocalNarrativeContext({ promptTokens: 30000, settings, memory }), 32768);
  assert.equal(selectLocalNarrativeContext({ promptTokens: 100, settings, memory, residentTokens: 16384 }), 16384);
  assert.throws(() => selectLocalNarrativeContext({ promptTokens: 31000, settings, memory }), { code: "context-too-large", detailCode: "configured-context-limit" });
});

test("the trained model ceiling takes precedence over the configured maximum", () => {
  assert.throws(() => selectLocalNarrativeContext({ promptTokens: 6000, settings, memory, modelContextTokens: 8192 }), { detailCode: "model-context-limit" });
  assert.equal(selectLocalNarrativeContext({ promptTokens: 100, settings, memory, modelContextTokens: 4096 }), 4096);
  assert.equal(selectLocalNarrativeContext({ promptTokens: 40000, settings: localNarrativeContextSettings({ maxContextTokens: 65536 }),
    memory: { totalBytes: 64 * GiB, availableBytes: 48 * GiB } }), 65536);
});

test("tight headroom uses the minimum aligned allocation and never truncates a prompt to fit memory", () => {
  const tight = { totalBytes: 32 * GiB, availableBytes: 8.75 * GiB };
  assert.equal(selectLocalNarrativeContext({ promptTokens: 7000, settings, memory: tight, residentTokens: 8192 }), 10240);
  assert.throws(() => selectLocalNarrativeContext({ promptTokens: 10000, settings, memory: tight, residentTokens: 8192 }), { code: "memory-pressure", detailCode: "context-memory-budget" });
  assert.throws(() => selectLocalNarrativeContext({ promptTokens: 100, settings, memory: { totalBytes: 32 * GiB, availableBytes: 7 * GiB }, residentTokens: 8192 }), { detailCode: "memory-reserve" });
});

test("cold admission charges weights and runner allocation while warm admission charges only context growth", () => {
  const limited = { totalBytes: 32 * GiB, availableBytes: 12 * GiB };
  assert.throws(() => selectLocalNarrativeContext({ promptTokens: 10000, settings, memory: limited, modelBytes: 3 * GiB }), { detailCode: "context-memory-budget" });
  assert.equal(selectLocalNarrativeContext({ promptTokens: 10000, settings, memory: limited, residentTokens: 8192 }), 16384);
});

test("untrusted settings and observations cannot produce unbounded or unmeasured allocations", () => {
  assert.deepEqual(localNarrativeContextSettings({ maxContextTokens: NaN, memoryReservePercent: Infinity }), { maxContextTokens: 32768, memoryReservePercent: 25 });
  assert.deepEqual(localNarrativeContextSettings({ maxContextTokens: 10000000, memoryReservePercent: 0 }), { maxContextTokens: 131072, memoryReservePercent: 20 });
  assert.deepEqual(localNarrativeContextSettings({ maxContextTokens: -1, memoryReservePercent: 100 }), { maxContextTokens: 8192, memoryReservePercent: 30 });
  for (const invalid of [{ totalBytes: 0, availableBytes: 0 }, { totalBytes: 1, availableBytes: 2 }, { totalBytes: NaN, availableBytes: 0 }]) {
    assert.throws(() => selectLocalNarrativeContext({ promptTokens: 1, settings, memory: invalid }), { detailCode: "memory-observation" });
  }
  assert.throws(() => selectLocalNarrativeContext({ promptTokens: NaN, settings, memory }), { detailCode: "runner-tokenization" });
});

test("legacy estimates account for Unicode bytes and cancelled observations do no OS work", async () => {
  assert.ok(estimateLocalNarrativePromptTokens("한글", "지시문") > estimateLocalNarrativePromptTokens("ab", "abc"));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readLocalNarrativeMemory(controller.signal), { code: "cancelled" });
});
