/** Real private file storage verifies permissions, ordered reads, corruption and disposal races. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFunctionNarrativePageStore } from "../../storage/functionNarrativePages";
import type { FunctionNarrative } from "../../shared/functionNarratives";

const narrative: FunctionNarrative = { summary: "The function returns its input.", scenarios: [{ title: "Return", when: [], outcome: "return value", assumptions: [],
  explanation: "Return the supplied value to the caller.", steps: [{ text: "Return the value.", source: { snippetId: "root", startLine: 1, endLine: 1 } }] }], limitations: [] };

test("paged prose stays in private files and disposal removes all retained results", async () => {
  const root = await mkdtemp(join(tmpdir(), "narrative-store-test-"));
  const store = createFunctionNarrativePageStore({ temporaryRoot: root });
  try {
    assert.deepEqual(await readdir(root), [], "construction must not allocate storage");
    assert.equal(await store.read(0), undefined);
    const write = store.write(0, narrative);
    assert.deepEqual(await store.read(0), narrative, "reads await pending writes"); await write;
    const [folder] = await readdir(root);
    assert.equal((await stat(join(root, folder))).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, folder, "0.json"))).mode & 0o777, 0o600);
    await store.write(1, narrative); assert.deepEqual(await store.read(1), narrative);
    await writeFile(join(root, folder, "1.json"), '{"unvalidated":"prose"}');
    assert.equal(await store.read(1), undefined, "corrupted pages never become source actions");
    await assert.rejects(store.read(-1)); await assert.rejects(store.write(Number.MAX_SAFE_INTEGER + 1, narrative));
    await store.dispose(); await store.dispose();
    assert.deepEqual(await readdir(root), []); assert.equal(await store.read(0), undefined);
    await assert.rejects(store.write(2, narrative));
  } finally { await store.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("disposal revokes a late first write without leaving a temporary directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "narrative-store-race-"));
  const store = createFunctionNarrativePageStore({ temporaryRoot: root });
  try {
    const write = store.write(0, narrative); const rejected = assert.rejects(write);
    await store.dispose(); await rejected;
    assert.deepEqual(await readdir(root), []); assert.equal(await store.read(0), undefined);
  } finally { await store.dispose(); await rm(root, { recursive: true, force: true }); }
});
