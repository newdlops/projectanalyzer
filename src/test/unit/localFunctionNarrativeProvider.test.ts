/** Local adapter QA runs a tiny executable at the process boundary, preserving production file and cancellation behavior. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalFunctionNarrativeProvider } from "../../llm/functionNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

const context: FunctionNarrativeContext = { functionName: "describe", language: "kotlin", limited: false,
  snippets: [{ id: "root", role: "function", startLine: 1, endLine: 1, text: 'fun describe() = "ready"', truncated: false }] };

/** A fake external runner reads the actual private prompt file, but never evaluates source code. */
async function fixture(body: string | ((directory: string) => string), modelName = "fixture.gguf") {
  const directory = await mkdtemp(join(tmpdir(), "function-llm-test-"));
  const binaryPath = join(directory, "runner"); const modelPath = join(directory, modelName);
  await writeFile(binaryPath, `#!${process.execPath}\n${typeof body === "string" ? body : body(directory)}`, { mode: 0o700 }); await writeFile(modelPath, "GGUF fixture");
  return { directory, provider: createLocalFunctionNarrativeProvider({ binaryPath, modelPath }) };
}

test("local LLM adapter starts only on request and reads Kotlin from a private file without shell interpolation", async () => {
  const f = await fixture(`const fs = require('node:fs'); const args = process.argv.slice(2);
    const prompt = fs.readFileSync(args[args.indexOf('--file') + 1], 'utf8');
    const systemFile = args[args.indexOf('--system-prompt-file') + 1];
    const system = fs.readFileSync(systemFile, 'utf8');
    if (!system.includes('English code-reading') || (fs.statSync(systemFile).mode & 0o777) !== 0o600) process.exit(3);
    if (!prompt.includes('fun describe()') || !args.includes('--offline') || !args.includes('--json-schema')) process.exit(2);
    process.stdout.write('{"summary":"ready"}');`);
  try {
    const result = await f.provider.generate(context, "en", new AbortController().signal);
    assert.equal(result.text, '{"summary":"ready"}'); assert.ok(result.modelName.includes("fixture"));
    assert.deepEqual((await readdir(f.directory)).sort(), ["fixture.gguf", "runner"]);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("Qwen3.5 uses tool-free ChatML and disables reasoning while retaining local resource bounds", async () => {
  const f = await fixture(`const args = process.argv.slice(2);
    const value = (flag) => args[args.indexOf(flag) + 1];
    if (value('--chat-template') !== 'chatml' || !args.includes('--no-jinja') || value('--reasoning') !== 'off'
      || value('--ctx-size') !== '8192' || value('--threads') !== '2' || value('--threads-batch') !== '2'
      || value('--predict') !== '2400' || !args.includes('--single-turn') || !args.includes('--offline')) process.exit(2);
    process.stdout.write('{"summary":"new model"}');`, "Qwen3.5-4B-Q4_K_M.gguf");
  try { assert.equal((await f.provider.generate(context, "en", new AbortController().signal)).text, '{"summary":"new model"}'); }
  finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("changing local model configuration waits for the previous process to exit before loading another", async () => {
  const first = await fixture((directory) => `require('node:fs').writeFileSync(${JSON.stringify(join(directory, "pid"))}, String(process.pid)); setInterval(() => {}, 1000);`);
  const controller = new AbortController(); const pending = first.provider.generate(context, "en", controller.signal);
  // Attach the rejection handler before the replacement request intentionally cancels this process.
  const cancelled = assert.rejects(pending, { message: "cancelled" });
  let second: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    let pid: number | undefined;
    for (let attempt = 0; attempt < 100 && !pid; attempt += 1) {
      pid = await readFile(join(first.directory, "pid"), "utf8").then(Number).catch(() => undefined);
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(pid, "the first actual process must start before testing replacement");
    second = await fixture(`try { process.kill(${pid}, 0); process.exit(2); } catch { process.stdout.write('{"summary":"replacement"}'); }`);
    const replacement = await second.provider.generate(context, "en", new AbortController().signal);
    await cancelled; assert.equal(replacement.text, '{"summary":"replacement"}');
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    controller.abort(); await cancelled;
    await rm(first.directory, { recursive: true, force: true }); if (second) await rm(second.directory, { recursive: true, force: true });
  }
});

test("local LLM adapter terminates cancelled work and bounds output", async () => {
  const pending = await fixture("setInterval(() => {}, 1000);");
  const oversized = await fixture("process.stdout.write('x'.repeat(24001));");
  try {
    const controller = new AbortController(); const result = pending.provider.generate(context, "ko", controller.signal);
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(result, { message: "cancelled" });
    await assert.rejects(oversized.provider.generate(context, "en", new AbortController().signal), { message: "invalid-response" });
  } finally { await rm(pending.directory, { recursive: true, force: true }); await rm(oversized.directory, { recursive: true, force: true }); }
});
