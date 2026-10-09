/** Real model completion after readiness, including decoding and Host validation.
 * Usage after compile: node scripts/benchmark-model-context.mjs <model.gguf> [runner] [rounds=3] [output-directory]
 * The public catch fixtures require inference; source-only responses cannot pass.
 * This bounded corpus does not establish a latency guarantee for arbitrary functions.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkPublicModelReading } from './benchmark-model-reading.mjs';
import { assertCompleteModelFixtureSyntax } from './model-reading-fixture-validation.mjs';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createLocalFunctionNarrativeProvider } = require(repo + '/out/llm/functionNarratives');
const { createLocalNarrativeSchema } = require(repo + '/out/llm/functionNarratives/responseSchema');
const { createLocalNarrativeWire } = require(repo + '/out/llm/functionNarratives/localWire');
const { ModelTaskManager } = require(repo + '/out/shared/modelTasks');
const { parseFunctionCallNarrative } = require(repo + '/out/application/functionCallNarratives');
const { readFunctionCallSourceSyntax, createFunctionCallSourceReader } = require(repo + '/out/analyzer/functionCalls');
const { analyzeFunctionLogic } = require(repo + '/out/analyzer/functionLogic');
const { loadFunctionCallReadingFixture } = require(repo + '/out/test/unit/helpers/functionCallReadingFixture');
const modelPath = process.argv[2] && path.resolve(process.argv[2]);
const binaryPath = process.argv[3] || '/opt/homebrew/bin/llama-completion';
const rounds = Number(process.argv[4] || 3);
if (!modelPath || !Number.isSafeInteger(rounds) || rounds < 1 || rounds > 10) {
  throw new Error('Provide a model path and 1–10 measurement rounds.');
}
if (process.platform === 'win32' || !/^(?:llama-completion|llama-cli)$/u.test(path.basename(binaryPath))
  || !await access(path.join(path.dirname(binaryPath), 'llama-server'), constants.X_OK).then(() => true, () => false)) {
  throw new Error('This readiness benchmark requires a preinstalled llama-server companion on Unix.');
}
// A persistent, ignored output directory keeps measured evidence across Host
// restarts. The default remains a private temporary directory.
const outputDirectory = path.resolve(process.argv[5] || tmpdir());
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(path.join(outputDirectory, 'model-context-'));
const records = [];
console.log(JSON.stringify({ directory, model: path.basename(modelPath), rounds,
  criterion: 'Full explanation after model readiness, not first token; public short-function corpus only.' }));

for (const language of ['typescript', 'kotlin']) {
  for (const names of [{ parent: 'checkout', callee: 'addFee', effect: 'audit' },
    { parent: 'transform', callee: 'adjustValue', effect: 'observe' }]) {
    const context = await fixture(language, names);
    for (const locale of ['ko', 'en']) {
      for (let round = 1; round <= rounds; round++) {
        const manager = new ModelTaskManager(), controller = new AbortController(), metrics = [];
        const provider = createLocalFunctionNarrativeProvider({ binaryPath, modelPath, taskManager: manager,
          onMetrics(value) { metrics.push(value); } });
        const timer = setTimeout(() => controller.abort(), 180000);
        let preparationMs, fullExplanationMs, response, parsed;
        const failures = [];
        try {
          await provider.withRun(locale, controller.signal, async () => {
            const preparationStarted = performance.now();
            await provider.prepare(locale, controller.signal);
            preparationMs = performance.now() - preparationStarted;
            const started = performance.now();
            try {
              response = await provider.generate(context, locale, controller.signal);
              parsed = parseFunctionCallNarrative(response.text, context, locale);
            } finally { fullExplanationMs = performance.now() - started; }
          });
          if (!metrics.length) failures.push('missing-real-model-generation');
          if (fullExplanationMs > 3000) failures.push('full-explanation-over-3s');
          failures.push(...checkReading(parsed, { ...names, locale, source: context.snippets.map(snippet => snippet.text).join('\n') },
            createLocalNarrativeWire(createLocalNarrativeSchema(context, locale)).schema));
        } catch (error) { failures.push(error.code || 'generation-failed'); }
        finally { clearTimeout(timer); await manager.dispose(); }
        const record = { language, locale, fixture: names.callee, round, preparationMs, fullExplanationMs,
          modelCalls: metrics.length, metrics, detailFields: parsed?.calls.length * 5 || 0, failures };
        records.push(record);
        await writeFile(path.join(directory, `${language}-${names.callee}-${locale}-${round}.json`),
          JSON.stringify({ record, context, response, parsed }, null, 2), { mode: 0o600 });
        console.log(JSON.stringify(record));
      }
    }
  }
}
const times = records.map(record => record.fullExplanationMs).filter(Number.isFinite).sort((a, b) => a - b);
const summary = { samples: records.length, passed: records.filter(record => !record.failures.length).length,
  p95Ms: times[Math.ceil(times.length * 0.95) - 1], maximumMs: times.at(-1), directory };
await writeFile(path.join(directory, 'report.json'), JSON.stringify({ summary, records }, null, 2), { mode: 0o600 });
console.log(JSON.stringify(summary));
if (summary.passed !== summary.samples) process.exitCode = 1;

/** Neutral names detect name-driven business claims; original identifiers remain exact source evidence. */
async function fixture(language, { parent, callee, effect }) {
  const caller = language === 'kotlin' ? `fun ${parent}(amount: Int): Int { return ${callee}(amount) }`
    : `function ${parent}(amount: number): number { return ${callee}(amount); }`;
  const helper = language === 'kotlin'
    ? `fun ${callee}(value: Int): Int { try { return value + 5 } catch (error: Exception) { return 0 } finally { ${effect}(value) } }`
    : `function ${callee}(value: number): number { try { return value + 5; } catch (error) { return 0; } finally { ${effect}(value); } }`;
  const context = { functionName: parent, language, limited: true, snippets: [
    { id: 'parent', role: 'function', startLine: 1, endLine: 1, text: caller, truncated: false },
    { id: 'caller', role: 'caller', startLine: 1, endLine: 1, text: `${callee}(amount)`, truncated: false },
    { id: 'callee', role: 'helper', startLine: 2, endLine: 2, text: helper, truncated: false }
  ], callTask: { scope: 'call', signature: caller.split('{')[0].trim(), includeSummary: true, sourceLimited: true,
    routeStatus: 'structure', conditions: [], sequence: [{ callId: 'call-1', expression: `${callee}(amount)`, callee, deferred: false }],
    targets: [{ callId: 'call-1', caller: parent, callee, language, expression: `${callee}(amount)`, relation: 'call',
      confidence: 'exact', guards: [], loops: [], deferred: false, sourceLimited: false, callerSnippet: 'caller', calleeSnippet: 'callee',
      arguments: ['amount'], parameters: [{ name: 'value', type: language === 'kotlin' ? 'Int' : 'number' }] }] } };
  // The production optimization requires real parser-owned syntax. Do not
  // manufacture returns/use in a benchmark or let a source recipe hide inference.
  const parsed = await loadFunctionCallReadingFixture(language, name => name === 'reading' ? caller : helper);
  const parentNode = parsed.graph.nodes.find(node => node.name === parent), calleeNode = parsed.graph.nodes.find(node => node.name === callee);
  const site = analyzeFunctionLogic({ functionNode: parentNode, sourceText: caller }).callsites.find(call => call.calleeName === callee);
  const target = context.callTask.targets[0];
  const syntax = calleeNode && readFunctionCallSourceSyntax(calleeNode, helper);
  assertCompleteModelFixtureSyntax(calleeNode, syntax, `${language} ${callee}`, { requireCompleteInventories: true });
  target.returnSyntax = syntax?.returns;
  target.effectSyntax = syntax?.effects;
  target.resultUse = createFunctionCallSourceReader(parentNode, caller).readUse(site.range, target.expression);
  if (!target.returnSyntax || !target.resultUse) throw new Error('Missing public-fixture parser evidence.');
  return context;
}

/** Necessary source facts are checked independently from shape; this remains a bounded smoke check, not a semantic oracle. */
function checkReading(reading, names, wireSchema) {
  const call = reading.calls[0], failures = checkPublicModelReading(reading, names, wireSchema);
  if (!/value\s*\+\s*5|(?:5\s*(?:를|을)\s*더|add(?:s|ing)?\s+5)/iu.test(call.output)) failures.push('missing-return-calculation');
  if (!/0/u.test(call.output) || !/catch|예외|오류/iu.test(call.output)) failures.push('missing-catch-return');
  if (!call.effects.includes(`${names.effect}(value)`)) failures.push('missing-exact-cleanup-argument');
  if (!/미확인|확인할\s*수\s*없|알\s*수\s*없|unknown|not\s+(?:provided|known|shown)/iu.test(call.effects + ' ' + reading.limitations.join(' '))) failures.push('missing-unknown-inner-call');
  if (/%|퍼센트|수수료율|discount|할인/iu.test(JSON.stringify(reading))) failures.push('invented-business-calculation');
  if (new Set([call.output, call.effects, call.role, call.reason]).size < 3) failures.push('repeated-generic-details');
  return failures;
}
