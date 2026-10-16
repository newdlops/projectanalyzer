/** Bounded actual disk reads and the injected native editor authority boundary. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type * as vscode from "vscode";
import { readSourceFileSnapshot } from "../../storage/sourceFiles";
import { SourceCaptureError } from "../../shared/narrativeSources";
import { VsCodeNarrativeSourceReader } from "../../vscode/narrativeSources";

/** Keep temporary file ownership local even when an assertion rejects acquisition. */
async function withFile(run: (file: string, text: string) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "source-reader-")), file = path.join(directory, "source.ts");
  const text = "a".repeat(65_535) + "😀\r\n마지막\r끝\n";
  try { await fs.writeFile(file, text); await run(file, text); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

/** Only the native document object is replaced; disk I/O stays real elsewhere. */
function document(file: string, text: () => string, version: () => number, scheme = "file"): vscode.TextDocument {
  return { uri: { fsPath: file, scheme }, getText: text, get version() { return version(); } } as vscode.TextDocument;
}

test("disk snapshot preserves a UTF8 character split across64KiB and all line endings", async () => {
  await withFile(async (file, text) => {
    const value = await readSourceFileSnapshot(file, 100_000, new AbortController().signal);
    assert.equal(value!.text, text); assert.match(value!.revision, /^file:/u);
    const repeated = await readSourceFileSnapshot(file, 100_000, new AbortController().signal);
    assert.equal(repeated!.revision, value!.revision);
  });
});

test("oversized source rejects the whole read and missing source remains unavailable", async () => {
  await withFile(async (file) => {
    await assert.rejects(readSourceFileSnapshot(file, 32, new AbortController().signal), (error: unknown) => error instanceof SourceCaptureError && error.code === "context-too-large");
    assert.equal(await readSourceFileSnapshot(file + ".missing", 100, new AbortController().signal), undefined);
  });
});

test("a cancelled read closes its actually acquired handle", async (context) => {
  let closed = false;
  const controller = new AbortController();
  const handle = { async stat() { return { dev: 1n, ino: 1n, size: 1n, mtimeNs: 1n, ctimeNs: 1n, isFile: () => true }; },
    async read() { controller.abort(); return { bytesRead: 1 }; }, async close() { closed = true; } };
  context.mock.method(fs, "open", async () => handle);
  await assert.rejects(readSourceFileSnapshot("/owned", 10, controller.signal), (error: unknown) => error instanceof SourceCaptureError && error.code === "cancelled");
  assert.equal(closed, true);
});

test("working editor text wins over a Git revision and closed disk contents", async () => {
  let diskReads = 0, value = "dirty text", version = 7;
  const documents = [document("/workspace/a.ts", () => "git revision", () => 1, "git"), document("/workspace/a.ts", () => value, () => version)];
  const reader = new VsCodeNarrativeSourceReader({ textDocuments: documents }, async () => { diskReads++; return undefined; });
  assert.deepEqual(await reader.read("/workspace/a.ts", 100, new AbortController().signal), { filePath: "/workspace/a.ts", text: value, revision: "document:7" });
  assert.equal(diskReads, 0); value = "long".repeat(100);
  await assert.rejects(reader.read("/workspace/a.ts", 100, new AbortController().signal), (error: unknown) => error instanceof SourceCaptureError && error.code === "context-too-large");
  value = "same"; version++;
  assert.equal((await reader.read("/workspace/a.ts", 100, new AbortController().signal))!.revision, "document:8");
});

test("an editor opened during disk I/O becomes the source owner", async () => {
  const documents: vscode.TextDocument[] = [];
  const reader = new VsCodeNarrativeSourceReader({ textDocuments: documents }, async (filePath) => {
    documents.push(document(filePath, () => "new dirty content", () => 2));
    return { filePath, text: "old disk content", revision: "file:old" };
  });
  assert.equal((await reader.read("/workspace/a.ts", 100, new AbortController().signal))!.text, "new dirty content");
});

test("cancellation after a native boundary cannot return a source snapshot", async () => {
  const controller = new AbortController();
  const reader = new VsCodeNarrativeSourceReader({ textDocuments: [] }, async (filePath) => {
    controller.abort(); return { filePath, text: "source", revision: "file:1" };
  });
  await assert.rejects(reader.read("/workspace/a.ts", 100, controller.signal), (error: unknown) => error instanceof SourceCaptureError && error.code === "cancelled");
});

test("a changing editor version cannot be paired with text from another version", async () => {
  let version = 1;
  const current = document("/workspace/a.ts", () => { version++; return "source from an interrupted read"; }, () => version);
  const reader = new VsCodeNarrativeSourceReader({ textDocuments: [current] }, async () => undefined);
  await assert.rejects(reader.read("/workspace/a.ts", 100, new AbortController().signal), (error: unknown) => error instanceof SourceCaptureError && error.code === "source-changed");
});
