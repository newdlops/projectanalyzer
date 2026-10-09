/** Fresh production Host/provider explanations after model readiness, across real call scopes.
 * Usage after compile: node scripts/benchmark-model-scopes.mjs <model.gguf> [output-directory] [rounds=1]
 * Public TypeScript/Kotlin catch fixtures only; this is not a general semantic oracle or latency guarantee.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { checkPublicModelReading } from './benchmark-model-reading.mjs';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { loadFunctionCallReadingFixture } = require(repo + '/out/test/unit/helpers/functionCallReadingFixture');
const { FunctionCallsHostDelivery } = require(repo + '/out/webview/functionCalls');
const { WebviewGraphDelivery } = require(repo + '/out/webview/sidebarGraphDelivery');
const { SourceNodeTokenRegistry } = require(repo + '/out/webview/sourceNavigation');
const { CodeFlowEvidenceTokenRegistry } = require(repo + '/out/webview/codeFlow');
const { createLocalFunctionNarrativeProvider } = require(repo + '/out/llm/functionNarratives');
const { createLocalNarrativeSchema } = require(repo + '/out/llm/functionNarratives/responseSchema');
const { createLocalNarrativeWire } = require(repo + '/out/llm/functionNarratives/localWire');
const { ModelTaskManager } = require(repo + '/out/shared/modelTasks');
const { exampleFunctionCallScenarios } = require(repo + '/out/shared/functionCalls');
const modelPath = process.argv[2] && path.resolve(process.argv[2]);
const rounds = Number(process.argv[4] ?? 1);
if (!modelPath || !Number.isSafeInteger(rounds) || rounds < 1 || rounds > 10) throw new Error('Provide a model path and 1–10 rounds.');
const output = path.resolve(process.argv[3] || tmpdir());
await mkdir(output, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(path.join(output, 'model-scopes-'));
const records = [];
console.log(JSON.stringify({ directory, model: path.basename(modelPath), rounds,
  criterion: 'Fresh complete Host reading after model readiness; no cached explanation can pass.' }));

for (const language of ['typescript', 'kotlin']) {
  // The catch is deliberately outside the closed source recipe so this corpus
  // must include genuine model reading, even when exact syntax is Host-owned.
  const caller = language === 'kotlin' ? 'fun checkout(amount: Int): Int { return addFee(amount) }'
    : 'import { addFee } from "./readingHelpers"; export function checkout(amount: number): number { return addFee(amount); }';
  const helper = language === 'kotlin'
    ? 'fun addFee(value: Int): Int { try { return value + 5 } catch (error: Exception) { return 0 } finally { audit(value) } }'
    : 'export function addFee(value: number): number { try { return value + 5; } catch (error) { return 0; } finally { audit(value); } }';
  const fixture = await loadFunctionCallReadingFixture(language, name => name === 'reading' ? caller : helper);
  for (const locale of ['ko', 'en']) for (const scope of ['overview', 'call', 'scenario']) for (let round = 1; round <= rounds; round++) {
    // Each scope owns a new manager/server and Host, eliminating response and
    // prior-source KV reuse. Preparation generates no source-reading response.
    const manager = new ModelTaskManager(), controller = new AbortController(), metrics = [], contexts = [], responses = [];
    const provider = createLocalFunctionNarrativeProvider({ binaryPath: '/opt/homebrew/bin/llama-completion', modelPath,
      taskManager: manager, onMetrics: value => metrics.push(value) });
    const graphDelivery = new WebviewGraphDelivery();
    const graphVersion = graphDelivery.activate(fixture.graph).snapshot.version;
    const sourceNodeTokens = new SourceNodeTokenRegistry(), evidenceTokens = new CodeFlowEvidenceTokenRegistry();
    sourceNodeTokens.activate(graphVersion, fixture.graph); evidenceTokens.activate(graphVersion, fixture.graph);
    const replies = [], staticReplies = [];
    const instrumented = { managesDeadlines: provider.managesDeadlines, prepare: provider.prepare.bind(provider),
      withRun: provider.withRun.bind(provider), async generate(context, requestedLocale, signal, options) {
        contexts.push(context); const response = await provider.generate(context, requestedLocale, signal, options);
        responses.push(response); return response;
      } };
    const host = new FunctionCallsHostDelivery({ graphDelivery, sourceNodeTokens, evidenceTokens,
      provider: instrumented, getLanguage: () => locale,
      async readSourceText(file) { return fixture.files.find(candidate => candidate.path === file)?.content; },
      async postMessage(reply) { staticReplies.push(reply); }, async postNarratives(reply) { replies.push(reply); } });
    const timeout = setTimeout(() => controller.abort(), 180000);
    let preparationMs, fullExplanationMs, completed, narrative;
    const failures = [];
    try {
      const request = { graphVersion, sourceToken: sourceNodeTokens.createToken(fixture.root.id), requestId: 1 };
      await host.load(request);
      const slice = staticReplies.at(-1);
      if (slice?.status !== 'ready' || !slice.narratives.contextId) throw new Error('static-load-failed');
      const connection = slice.connections.find(edge => slice.nodes.find(node => node.id === edge.to)?.name === 'addFee');
      const examples = exampleFunctionCallScenarios(slice.control, new Map(slice.connections.map(edge => [edge.id, edge])));
      const selection = scope === 'call' ? { connectionId: connection?.id } : scope === 'scenario'
        ? { choices: [...(examples[0]?.selection ?? [])].map(([key, value]) => ({ key, value })) } : {};
      if ((scope === 'call' && !connection) || (scope === 'scenario' && !examples.length)) throw new Error('missing-scope-selection');
      const explanation = { ...request, requestId: 2, contextId: slice.narratives.contextId, scope, ...selection };
      await provider.withRun(locale, controller.signal, async () => {
        const preparationStart = performance.now(); await provider.prepare(locale, controller.signal);
        preparationMs = performance.now() - preparationStart;
        const started = performance.now();
        try {
          await host.explain(explanation); completed = replies.at(-1);
          // Reading all pages belongs to completion; page reads themselves
          // must be cache-only and cannot conceal another model request.
          const pageCalls = [], modelCalls = metrics.length;
          for (let pageIndex = 0; pageIndex < (completed?.page?.count ?? 1); pageIndex++) {
            await host.explain({ ...explanation, requestId: 3 + pageIndex, pageIndex, pageLanguage: locale });
            const page = replies.at(-1);
            if (!page?.cacheHit) failures.push('page-not-cached');
            pageCalls.push(...(page?.narrative?.calls ?? []));
          }
          narrative = { ...completed?.narrative, calls: pageCalls };
          if (metrics.length !== modelCalls) failures.push('page-triggered-generation');
        } finally { fullExplanationMs = performance.now() - started; }
      });
      if (completed?.status !== 'ready' || !completed.coverage?.complete) failures.push('incomplete-host-reading');
      if (completed?.cacheHit) failures.push('cached-explanation');
      if (!metrics.length) failures.push('missing-real-model-generation');
      if (narrative.calls.length !== completed?.coverage?.total || !narrative.calls.length) failures.push('missing-call-details');
      if (!narrative.summary || !narrative.flow) failures.push('missing-whole-summary-or-flow');
      for (const call of narrative.calls) {
        if (!['role', 'inputs', 'output', 'effects', 'reason'].every(field => typeof call[field] === 'string' && call[field].trim())) failures.push('missing-detail-field');
        if (!evidenceTokens.resolve(call.callerEvidence) || !evidenceTokens.resolve(call.calleeEvidence)) failures.push('missing-source-evidence');
      }
      if (narrative.calls.length && contexts.length === 1) failures.push(...checkPublicModelReading(narrative, { parent: 'checkout', callee: 'addFee', effect: 'audit',
        locale, source: fixture.files.map(file => file.content).join('\n') },
        createLocalNarrativeWire(createLocalNarrativeSchema(contexts[0], locale)).schema));
      else failures.push('ambiguous-model-prose-schema');
      if (fullExplanationMs > 3000) failures.push('full-explanation-over-3s');
    } catch (error) { failures.push(error.code || error.message || 'generation-failed'); }
    finally { clearTimeout(timeout); host.reset(); await manager.dispose(); }
    const record = { language, locale, scope, round, preparationMs, fullExplanationMs, modelCalls: metrics.length,
      metrics, status: completed?.status, complete: completed?.coverage?.complete === true,
      detailFields: (narrative?.calls.length ?? 0) * 5, failures: [...new Set(failures)] };
    records.push(record);
    await writeFile(path.join(directory, `${language}-${locale}-${scope}-${round}.json`),
      JSON.stringify({ record, contexts, responses, completed, narrative }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(record));
  }
}
const times = records.map(r => r.fullExplanationMs).filter(Number.isFinite).sort((a, b) => a - b);
const summary = { samples: records.length, passed: records.filter(r => !r.failures.length).length,
  under3: records.filter(r => r.fullExplanationMs <= 3000 && r.modelCalls > 0 && r.status === 'ready' && r.complete).length,
  p95Ms: times[Math.ceil(times.length * 0.95) - 1], maximumMs: times.at(-1), directory };
await writeFile(path.join(directory, 'report.json'), JSON.stringify({ summary, records }, null, 2), { mode: 0o600 });
console.log(JSON.stringify(summary));
if (summary.passed !== summary.samples) process.exitCode = 1;
