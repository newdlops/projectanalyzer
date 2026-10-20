/** Real permission failures verify retryable cleanup of a partial local-server start without loading or spawning a model. */
import assert from "node:assert/strict";
import test from "node:test";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalNarrativeServer } from "../../llm/functionNarratives/localServer";
import { ModelTaskManager } from "../../shared/modelTasks";

const requiresPermissions = process.platform === "win32" || process.getuid?.() === 0;

/** Match only the actual filesystem failure under test; unrelated errors must still fail the regression. */
function permissionDenied(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "EACCES" || error.code === "EPERM");
}

/** Own all fixture paths and restore their permissions even if an assertion rejects. No process or readiness is fabricated. */
async function withBlockedDirectory(check: (server: LocalNarrativeServer, directory: string, unblock: () => Promise<void>) => Promise<void>): Promise<void> {
  const parent = await mkdtemp(join(tmpdir(), "fn-cleanup-"));
  const server = new LocalNarrativeServer({ binaryPath: join(parent, "unused-runner"), modelPath: join(parent, "unused-model") });
  try {
    const directory = await mkdtemp(join(parent, "owned-"));
    await writeFile(join(directory, "key"), "test-only\n", { mode: 0o600 });
    // Exercise only the directory ownership acquired during partial startup.
    // The constructor is inert, and child/loaded/prepared state stays absent.
    (server as unknown as { directory: string }).directory = directory;
    // Entries inside the owned directory can be removed, but its parent forbids rmdir until unblocked.
    await chmod(parent, 0o500);
    await check(server, directory, () => chmod(parent, 0o700));
  } finally {
    await chmod(parent, 0o700);
    try { await server.release(); }
    finally { await rm(parent, { recursive: true, force: true }); }
  }
}

test("local server retries deleting its owned directory after a real permission failure", { skip: requiresPermissions }, async () => {
  await withBlockedDirectory(async (server, directory, unblock) => {
    assert.equal(server.isPrepared, false);
    await assert.rejects(server.release(), permissionDenied);
    await access(directory);
    await unblock();
    await server.release();
    await assert.rejects(access(directory), { code: "ENOENT" });
    await server.release();
    assert.equal(server.isPrepared, false);
  });
});

test("a failed local-directory release blocks the next FIFO owner until the actual deletion succeeds", { skip: requiresPermissions }, async () => {
  await withBlockedDirectory(async (server, directory, unblock) => {
    const manager = new ModelTaskManager();
    const signal = new AbortController().signal;
    let nextExecutions = 0;
    const next = { async release() {} };
    const request = () => manager.run({ kind: "prepare", label: "directory-cleanup successor", resource: next, signal,
      async execute() { nextExecutions++; await assert.rejects(access(directory), { code: "ENOENT" }); return "clean"; } });
    try {
      await assert.rejects(manager.withResource(server, () => manager.run({ kind: "prepare", label: "partial-start directory owner", resource: server, signal,
        async execute() { await access(directory); } })), permissionDenied);
      await assert.rejects(request(), permissionDenied);
      assert.equal(nextExecutions, 0);
      await access(directory);
      await unblock();
      assert.equal(await request(), "clean");
      assert.equal(nextExecutions, 1);
    } finally {
      await unblock();
      await manager.dispose();
    }
  });
});
