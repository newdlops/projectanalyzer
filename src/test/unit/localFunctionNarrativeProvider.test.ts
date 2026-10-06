/** Local adapter QA runs a tiny executable at the process boundary, preserving production file and cancellation behavior. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalFunctionNarrativeProvider } from "../../llm/functionNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import { getGlobalModelTaskManager } from "../../shared/modelTasks";

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
    const schemaFile = args[args.indexOf('--json-schema-file') + 1];
    const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
    if ((fs.statSync(schemaFile).mode & 0o777) !== 0o600 || !schema.properties.scenarios || args.includes('--json-schema')
      || args.some(arg => arg.includes('fun describe') || arg.includes('snippetId'))) process.exit(4);
    if (!prompt.includes('fun describe()') || !args.includes('--offline') || !args.includes('--json-schema-file')) process.exit(2);
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

test("different local model configurations run FIFO without cancelling the previous request", async () => {
  const first = await fixture((directory) => `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(join(directory, "pid"))}, String(process.pid));
    const interval=setInterval(()=>{if(fs.existsSync(${JSON.stringify(join(directory, "release"))})){clearInterval(interval);process.stdout.write('{"summary":"first"}');}},10);`);
  const controller = new AbortController(); const pending = first.provider.generate(context, "en", controller.signal);
  let second: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    let pid: number | undefined;
    for (let attempt = 0; attempt < 500 && !pid; attempt += 1) {
      pid = await readFile(join(first.directory, "pid"), "utf8").then(Number).catch(() => undefined);
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(pid, "the first actual process must start before testing replacement");
    second = await fixture(`try { process.kill(${pid}, 0); process.exit(2); } catch { process.stdout.write('{"summary":"replacement"}'); }`);
    let queued!: () => void;const waiting=new Promise<void>(resolve=>{queued=resolve;});
    const next = second.provider.generate(context, "en", new AbortController().signal, { onProgress(progress) { if(progress.phase==="queued")queued(); } });
    await waiting;assert.doesNotThrow(()=>process.kill(pid!,0));
    await writeFile(join(first.directory,"release"),"ready");
    assert.equal((await pending).text,'{"summary":"first"}');
    assert.equal((await next).text, '{"summary":"replacement"}');
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    controller.abort(); await pending.catch(()=>{});
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

test("cancelled local processes are reaped before the next queued model loads and exit failures are diagnosable", async () => {
  const first=await fixture(directory=>`require('node:fs').writeFileSync(${JSON.stringify(join(directory,"pid"))},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
  const controller=new AbortController(),pending=first.provider.generate(context,"en",controller.signal),cancelled=assert.rejects(pending,{message:"cancelled"});
  let next:Awaited<ReturnType<typeof fixture>>|undefined,failed:Awaited<ReturnType<typeof fixture>>|undefined;
  try{
    let pid:number|undefined;
    for(let attempt=0;attempt<500&&!pid;attempt++){pid=await readFile(join(first.directory,"pid"),"utf8").then(Number).catch(()=>undefined);if(!pid)await new Promise(resolve=>setTimeout(resolve,20));}
    assert.ok(pid);next=await fixture(`try{process.kill(${pid},0);process.exit(2);}catch{process.stdout.write('{"summary":"next"}');}`);
    let queued!:()=>void;const waiting=new Promise<void>(resolve=>{queued=resolve;});
    const result=next.provider.generate(context,"en",new AbortController().signal,{onProgress(progress){if(progress.phase==="queued")queued();}});
    await waiting;controller.abort();await cancelled;assert.equal((await result).text,'{"summary":"next"}');assert.throws(()=>process.kill(pid!,0),{code:"ESRCH"});
    failed=await fixture("process.exit(2);");await assert.rejects(failed.provider.generate(context,"en",new AbortController().signal),{message:"failed"});
    assert.equal(getGlobalModelTaskManager().snapshot().history.at(-1)?.detailCode,"exit-2");
    assert.equal((await next.provider.generate(context,"en",new AbortController().signal)).text,'{"summary":"next"}');
  }finally{controller.abort();await pending.catch(()=>{});await rm(first.directory,{recursive:true,force:true});if(next)await rm(next.directory,{recursive:true,force:true});if(failed)await rm(failed.directory,{recursive:true,force:true});}
});

test("local runner failures expose controlled recovery categories without retaining stderr", async () => {
  const cases = [
    ["prompt is too long", "context-too-large", "input-window"],
    ["failed to allocate buffer", "failed", "memory-allocation"],
    ["failed to load model", "failed", "model-load"],
    ["unrecognized argument", "failed", "runner-arguments"],
    ["failed to parse grammar", "failed", "response-grammar"],
    ["JSON schema conversion failed: enum must be a non-empty array", "failed", "response-grammar"],
    ["private unrelated diagnostics", "failed", "exit-2"]
  ];
  for (const [diagnostic, code, detailCode] of cases) {
    const f = await fixture(`process.stderr.write(${JSON.stringify("private source value\n" + diagnostic)});process.exit(2);`);
    try {
      await assert.rejects(f.provider.generate(context, "en", new AbortController().signal), { message: code, detailCode });
      const record = getGlobalModelTaskManager().snapshot().history.at(-1);
      assert.equal(record?.failure, code); assert.equal(record?.detailCode, detailCode);
      assert.doesNotMatch(JSON.stringify(record), /private|source value|diagnostics/u);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  }
});
