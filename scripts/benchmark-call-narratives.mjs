/** Public two-file call-reading benchmark through the production Host/provider. Never executes the supplied source.
 * Usage: node scripts/benchmark-call-narratives.mjs [runtime-root|-] [tag] [typescript|kotlin|both] [provider-root]
 * Run after compile; raw public-fixture prose and source-free metrics stay in a private temporary directory.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = process.argv[2] && process.argv[2] !== '-' ? path.resolve(process.argv[2]) : repo;
const tag = (process.argv[3] || 'candidate').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
const selected = process.argv[4] || 'both';
const providerRuntime = process.argv[5] ? path.resolve(process.argv[5]) : runtime;
const { loadFunctionCallReadingFixture } = require(repo + '/out/test/unit/helpers/functionCallReadingFixture');
const { FunctionCallsHostDelivery } = require(runtime + '/out/webview/functionCalls');
const { WebviewGraphDelivery } = require(runtime + '/out/webview/sidebarGraphDelivery');
const { SourceNodeTokenRegistry } = require(runtime + '/out/webview/sourceNavigation');
const { CodeFlowEvidenceTokenRegistry } = require(runtime + '/out/webview/codeFlow');
const { createLocalFunctionNarrativeProvider } = require(providerRuntime + '/out/llm/functionNarratives');
const { ModelTaskManager } = require(runtime + '/out/shared/modelTasks');
const directory = await fs.mkdtemp(path.join(tmpdir(), 'call-benchmark-'));
console.log(JSON.stringify({ directory, runtime, providerRuntime, tag, note: 'Public fixed source examples; parser/loading before analysis excluded. Not a general model accuracy guarantee.' }));
const records = [];
for (const language of ['typescript', 'kotlin'].filter(value => selected === 'both' || selected === value)) {
  const fixture = await loadFunctionCallReadingFixture(language), graphDelivery = new WebviewGraphDelivery();
  const graphVersion = graphDelivery.activate(fixture.graph).snapshot.version;
  const sourceNodeTokens = new SourceNodeTokenRegistry(), evidenceTokens = new CodeFlowEvidenceTokenRegistry();
  sourceNodeTokens.activate(graphVersion, fixture.graph); evidenceTokens.activate(graphVersion, fixture.graph);
  const metrics = [], chunks = [], scopes = [], runnerPids = new Set(), replies = [], sourceReads = [];
  const manager = new ModelTaskManager();
  const local = createLocalFunctionNarrativeProvider({ binaryPath: '/opt/homebrew/bin/llama-completion',
    modelPath: path.join(repo, '.local-models/Qwen3.5-4B-Q4_K_M.gguf'), taskManager: manager, onMetrics(value) {
      metrics.push(value);
      try {
        const watchdogs = execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
        for (const pid of watchdogs) for (const child of execFileSync('pgrep', ['-P', pid], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)) runnerPids.add(Number(child));
      } catch { /* Measurements remain source-free and cannot invalidate inference. */ }
    } });
  const provider = { managesDeadlines: local.managesDeadlines,
    async withRun(locale, signal, operation) { scopes.push('begin'); try { return await local.withRun(locale, signal, operation); } finally { scopes.push('end'); } },
    async generate(context, locale, signal, options) {
      const started = performance.now();
      await fs.writeFile(path.join(directory, tag + '-' + language + '-context-' + (chunks.length + 1) + '.json'), JSON.stringify(context, null, 2), { mode: 0o600 });
      const reply = await local.generate(context, locale, signal, options);
      await fs.writeFile(path.join(directory, tag + '-' + language + '-chunk-' + (chunks.length + 1) + '.json'), reply.text, { mode: 0o600 });
      chunks.push({ targets: context.callTask.targets.map(target => target.callee), includeSummary: context.callTask.includeSummary,
        milliseconds: performance.now() - started, responseChars: reply.text.length });
      console.log(JSON.stringify({ language, chunk: chunks.length, ...chunks.at(-1), metrics: metrics.at(-1) }));
      return reply;
    } };
  const staticReplies = [];
  const delivery = new FunctionCallsHostDelivery({ graphDelivery, sourceNodeTokens, evidenceTokens, provider, getLanguage: () => 'ko',
    async readSourceText(file) {
      const found = fixture.files.find(candidate => candidate.path === file); if (!found) return;
      sourceReads.push(path.basename(file));
      // Real asynchronous filesystem work matches the Host's callee boundary.
      return fs.readFile(path.join(repo, 'src/test/fixtures/functionCalls', path.basename(file)), 'utf8');
    }, async postMessage(reply) { staticReplies.push(reply); }, async postNarratives(reply) {
      replies.push(reply); await new Promise(resolve => setImmediate(resolve)); // VS Code message publication yields too.
    } });
  const request = { graphVersion, sourceToken: sourceNodeTokens.createToken(fixture.root.id), requestId: 1 };
  await delivery.load(request);
  const slice = staticReplies.at(-1), signature = JSON.stringify(slice);
  const explanation = { ...request, contextId: slice.narratives.contextId, scope: 'overview' };
  const started = performance.now();
  try {
    await delivery.explain(explanation);
    const completed = replies.at(-1), generated = chunks.length;
    for (let pageIndex = 0; pageIndex < (completed.page?.count || 1); pageIndex++) {
      await delivery.explain({ ...explanation, requestId: pageIndex + 2, pageIndex, pageLanguage: 'ko' });
    }
    await manager.dispose();
    const pages = replies.filter(reply => reply.cacheHit && reply.status === 'ready'), readings = pages.flatMap(reply => reply.narrative?.calls || []);
    const failures = [];
    if (completed.status !== 'ready' || !completed.coverage?.complete) failures.push('incomplete-host-reading:' + completed.status);
    if (JSON.stringify(slice) !== signature) failures.push('static-graph-mutated');
    if (chunks.length !== generated) failures.push('cache-triggered-inference');
    if (readings.length !== slice.connections.length) failures.push('missing-call-reading');
    for (const reading of readings) {
      if (!['role', 'inputs', 'output', 'effects', 'reason'].every(field => typeof reading[field] === 'string' && reading[field].trim())) failures.push('missing-prose:' + reading.callee);
      if (!reading.callerEvidence || !evidenceTokens.resolve(reading.callerEvidence) || !reading.calleeEvidence || !evidenceTokens.resolve(reading.calleeEvidence)) failures.push('missing-source-evidence:' + reading.callee);
    }
    const record = { language, milliseconds: performance.now() - started, status: completed.status, coverage: completed.coverage,
      scopes, chunks, metrics, sourceReads, calls: readings.length, proseFields: readings.length * 5,
      proseCharacters: readings.reduce((sum, reading) => sum + ['role', 'inputs', 'output', 'effects', 'reason'].reduce((count, field) => count + reading[field].length, 0), 0),
      runnerStarts: runnerPids.size, remainingRunnerPids: [...runnerPids].filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }), failures };
    await fs.writeFile(path.join(directory, tag + '-' + language + '-pages.json'), JSON.stringify(pages, null, 2), { mode: 0o600 });
    records.push(record); console.log(JSON.stringify(record));
  } finally { delivery.reset(); await manager.dispose(); }
}
await fs.writeFile(path.join(directory, tag + '-report.json'), JSON.stringify({ tag, runtime, providerRuntime, records }, null, 2), { mode: 0o600 });
if (!records.length || records.some(record => record.failures.length || record.remainingRunnerPids.length)) process.exitCode = 1;
