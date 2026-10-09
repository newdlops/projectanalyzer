/** A tiny local socket runner verifies real process reuse, private authentication and parent-death cleanup without weights. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { ModelTaskManager } from "../../shared/modelTasks";
import { createLocalFunctionNarrativeProvider } from "../../llm/functionNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

const context: FunctionNarrativeContext = { functionName: "describe", language: "kotlin", limited: false,
  snippets: [{ id: "root", role: "function", startLine: 1, endLine: 1, text: 'fun describe() = "ready"', truncated: false }] };

/** The double replaces only inference; it accepts the real socket/key/limit protocol and reports its OS PID. */
async function fixture(options: { loading?: boolean; modelName?: string } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "server-qa-")), modelPath = join(directory, options.modelName ?? "Qwen3.5-fixture.gguf"), binaryPath = join(directory, "llama-completion");
  await writeFile(modelPath, "fixture"); await writeFile(binaryPath, `#!${process.execPath}\nprocess.exit(9);`, { mode: 0o700 });
  await writeFile(join(directory, "llama-server"), `#!${process.execPath}
const fs=require('node:fs'),http=require('node:http');const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
if(args[0]==='--help'){process.stdout.write('--ctx-checkpoints N\\n--checkpoint-min-step N\\n--cache-ram N\\n--spec-type none,ngram-map-k\\n--spec-ngram-map-k-size-n N\\n--spec-ngram-map-k-size-m N');process.exit(0);}
const keyPath=value('--api-key-file'),key=fs.readFileSync(keyPath,'utf8').trim();
if((fs.statSync(keyPath).mode&511)!==384||value('--ctx-size')!=='8192'||value('--parallel')!=='1'||value('--threads')!=='2'||value('--threads-batch')!=='2'||!args.includes('--offline')||!args.includes('--no-webui'))process.exit(3);
fs.appendFileSync(${JSON.stringify(join(directory, "started"))},JSON.stringify({pid:process.pid,keyPath,args})+'\\n');
http.createServer((req,res)=>{if(req.headers.authorization!=='Bearer '+key){res.writeHead(401);res.end('{}');return;}let text='';req.on('data',part=>text+=part);req.on('end',()=>{res.setHeader('Content-Type','application/json');
if(req.url==='/health'){res.statusCode=${options.loading ? 503 : 200};res.end('{"status":"ok"}');return;}const data=JSON.parse(text);
if(req.url==='/apply-template'){res.end(JSON.stringify({prompt:data.messages.map(message=>'<|im_start|>'+message.role+'\\n'+message.content+'<|im_end|>\\n').join('')+'<|im_start|>assistant\\n'}));return;}
if(data.n_predict!==2400||data.seed!==42||data.temperature!==0.2||data.cache_prompt!==true||data.id_slot!==0||!data.json_schema)process.exit(4);
if(!data.message_delimiters.some(value=>value.role==='user'&&value.delimiter==='<|im_start|>user\\n'))process.exit(5);
if(!data.prompt.endsWith('<|im_start|>assistant\\n<think>\\n\\n</think>\\n\\n'))process.exit(6);
fs.appendFileSync(${JSON.stringify(join(directory, "requests"))},String(process.pid)+'\\n');
if(data.prompt.includes('slow-work'))return;res.end(JSON.stringify({content:'{"summary":"cached"}',timings:{cache_n:128,prompt_n:20,predicted_n:8,prompt_ms:2,predicted_ms:3}}));});}).listen(value('--host'));
`, { mode: 0o700 });
  return { directory, modelPath, binaryPath };
}

test("one authenticated private server serves consecutive chunks then releases its process and private directory", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(), manager = new ModelTaskManager(), metrics: unknown[] = [];
  const provider = createLocalFunctionNarrativeProvider({ ...f, taskManager: manager, onMetrics(value) { metrics.push(value); } });
  try {
    for (let index = 0; index < 2; index++) assert.equal((await provider.generate(context, "en", new AbortController().signal)).text, '{"summary":"cached"}');
    const started = (await readFile(join(f.directory, "started"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(started.length, 1); assert.deepEqual((await readFile(join(f.directory, "requests"), "utf8")).trim().split("\n"), [String(started[0].pid), String(started[0].pid)]);
    assert.doesNotMatch(JSON.stringify(started[0].args), /fun describe|JSON schema|English code-reading/);
    assert.equal(started[0].args[started[0].args.indexOf('--spec-type')+1], 'none');
    assert.equal(started[0].args[started[0].args.indexOf('--cache-ram')+1], '256');
    assert.equal(metrics.length, 2);
    assert.ok(metrics.every(value => Number.isFinite((value as { generationMs: number }).generationMs)));
    await manager.dispose();
    assert.throws(() => process.kill(started[0].pid, 0), { code: "ESRCH" }); await assert.rejects(access(started[0].keyPath), { code: "ENOENT" });
  } finally { await manager.dispose(); await rm(f.directory, { recursive: true, force: true }); }
});

test("explicit preparation loads no source or generated tokens and the owning run releases its model", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(), manager = new ModelTaskManager(), signal = new AbortController().signal;
  const provider = createLocalFunctionNarrativeProvider({ ...f, taskManager: manager });
  let pid: number | undefined;
  try {
    await provider.prepare!("en", signal, { sourceReading: true });
    await assert.rejects(access(join(f.directory, "started")), { code: "ENOENT" });
    await provider.withRun!("en", signal, async () => {
      await provider.prepare!("en", signal);
      const starts = (await readFile(join(f.directory, "started"), "utf8")).trim().split("\n");
      assert.equal(starts.length, 1); pid = JSON.parse(starts[0]).pid;
      await assert.rejects(access(join(f.directory, "requests")), { code: "ENOENT" });
      assert.equal(manager.snapshot().history.at(-1)?.kind, "prepare");
      assert.equal((await provider.generate(context, "en", signal)).text, '{"summary":"cached"}');
      assert.equal((await readFile(join(f.directory, "started"), "utf8")).trim().split("\n").length, 1);
    });
    assert.ok(pid); assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
  } finally { await manager.dispose(); await rm(f.directory, { recursive: true, force: true }); }
});

test("conventional Qwen3 also starts constrained JSON after the non-thinking assistant prefix", { skip: process.platform === "win32" }, async () => {
  const f = await fixture({ modelName: "Qwen3-1.7B-fixture.gguf" }), manager = new ModelTaskManager();
  const provider = createLocalFunctionNarrativeProvider({ ...f, taskManager: manager });
  try {
    assert.equal((await provider.generate(context, "en", new AbortController().signal)).text, '{"summary":"cached"}');
  } finally { await manager.dispose(); await rm(f.directory, { recursive: true, force: true }); }
});

test("missing weights fail preparation before a model process is launched", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(), manager = new ModelTaskManager();
  const provider = createLocalFunctionNarrativeProvider({ ...f, taskManager: manager });
  try {
    await rm(f.modelPath);
    await assert.rejects(provider.prepare!("en", new AbortController().signal), { message: "unavailable", detailCode: "model-not-found" });
    await assert.rejects(access(join(f.directory, "started")), { code: "ENOENT" });
  } finally { await manager.dispose(); await rm(f.directory, { recursive: true, force: true }); }
});

test("cancelling a warm completion reaps the process before a replacement task can start", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(), manager = new ModelTaskManager(), controller = new AbortController();
  const provider = createLocalFunctionNarrativeProvider({ ...f, taskManager: manager });
  try {
    const pending = provider.generate({ ...context, functionName: "slow-work" }, "en", controller.signal);
    const rejected = assert.rejects(pending, { message: "cancelled" });
    let started: { pid: number } | undefined;
    for (let attempt = 0; attempt < 200 && !started; attempt++) {
      if (await readFile(join(f.directory, "requests"), "utf8").catch(() => "")) started = JSON.parse((await readFile(join(f.directory, "started"), "utf8")).trim());
      if (!started) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(started); controller.abort(); await rejected; assert.throws(() => process.kill(started!.pid, 0), { code: "ESRCH" });
    assert.equal((await provider.generate(context, "en", new AbortController().signal)).text, '{"summary":"cached"}');
  } finally { controller.abort(); await manager.dispose(); await rm(f.directory, { recursive: true, force: true }); }
});

test("cancelling model preparation reaps loading weights without creating an inference request", { skip: process.platform === "win32" }, async () => {
  const f = await fixture({ loading: true }), manager = new ModelTaskManager(), controller = new AbortController();
  const provider = createLocalFunctionNarrativeProvider({ ...f, taskManager: manager });
  try {
    const preparation = provider.prepare!("en", controller.signal);
    const rejected = assert.rejects(preparation, { message: "cancelled" });
    let started: { pid: number; keyPath: string } | undefined;
    for (let attempt = 0; attempt < 200 && !started; attempt++) {
      const text = await readFile(join(f.directory, "started"), "utf8").catch(() => "");
      if (text.trim()) started = JSON.parse(text.trim().split("\n")[0]);
      else await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(started); controller.abort(); await rejected;
    assert.throws(() => process.kill(started!.pid, 0), { code: "ESRCH" });
    await assert.rejects(access(started.keyPath), { code: "ENOENT" });
    await assert.rejects(access(join(f.directory, "requests")), { code: "ENOENT" });
    assert.equal(manager.snapshot().history.at(-1)?.kind, "prepare");
  } finally { controller.abort(); await manager.dispose(); await rm(f.directory, { recursive: true, force: true }); }
});

test("watchdog parent-pipe EOF reaps its child even without a cooperative Extension Host", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "watchdog-qa-"));
  const binary = join(directory, "runner"), pidPath = join(directory, "pid"), privateDirectory = join(directory, "owned");
  await writeFile(binary, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`, { mode: 0o700 });
  const watchdog = spawn(process.execPath, [join(__dirname, "../../llm/functionNarratives/localServerWatchdog.js"), binary, "[]", privateDirectory], { stdio: ["pipe", "ignore", "ignore"] });
  const closed = new Promise<void>(resolve => watchdog.once("close", () => resolve()));
  try {
    let pid: number | undefined;
    for (let attempt = 0; attempt < 200 && !pid; attempt++) {
      pid = await readFile(pidPath, "utf8").then(Number).catch(() => undefined); if (!pid) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(pid); watchdog.stdin!.end(); await closed; assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
  } finally { watchdog.kill("SIGTERM"); await closed; await rm(directory, { recursive: true, force: true }); }
});
