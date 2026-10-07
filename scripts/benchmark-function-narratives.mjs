/** Public production-parser/LLM benchmark, run after compile. Source is read as syntax, never executed.
 * Usage: node scripts/benchmark-function-narratives.mjs [runtime-root|-] [tag] [fixture|-] [model] [runner] [full-run] [configured|configured-source]
 * Omit runtime-root for the current workspace; use an installed older extension for the baseline.
 * Reports and raw public-fixture responses are written only to a private temporary directory.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = process.argv[2] && process.argv[2] !== '-' ? path.resolve(process.argv[2]) : repo;
const tag = (process.argv[3] || 'candidate').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
const { analyzeFunctionLogic } = require(repo + '/out/analyzer/functionLogic');
const { analyzeFunctionTutorDeclaration } = require(repo + '/out/analyzer/functionTutor');
const { buildFunctionTutorModel, CodeFlowInsightCache } = require(repo + '/out/application/codeFlow');
const application = require(runtime + '/out/application/functionNarratives');
const { createLocalFunctionNarrativeProvider } = require(runtime + '/out/llm/functionNarratives');
const { FunctionNarrativeScenarioSession } = require(runtime + '/out/webview/codeFlow/functionNarrativeScenarioSession');
const { ModelTaskManager } = require(runtime + '/out/shared/modelTasks');
const corpus = [
  { name: 'kotlin-guard', language: 'kotlin', extension: 'kt', source: 'fun inspect(enabled: Boolean, amount: Int): Int {\n    if (!enabled) return 0\n    val adjusted = amount + 5\n    return adjusted\n}', operation: 'adjusted', expected: inputs => inputs.enabled ? inputs.amount + 5 : 0 },
  { name: 'typescript-updates', language: 'typescript', extension: 'ts', source: 'export function inspect(enabled: boolean, amount: number): number {\n    if (!enabled) return 0;\n    let adjusted = amount + 5;\n    adjusted *= 2;\n    return adjusted;\n}', operation: 'adjusted', expected: inputs => inputs.enabled ? (inputs.amount + 5) * 2 : 0 },
  { name: 'kotlin-elvis', language: 'kotlin', extension: 'kt', source: 'fun inspect(amount: Int?): Int {\n    val adjusted = amount ?: 5\n    return adjusted\n}', operation: 'adjusted', expected: inputs => inputs.amount ?? 5 },
  { name: 'kotlin-mutable', language: 'kotlin', extension: 'kt', extended: true, source: 'fun inspect(enabled: Boolean, amount: Int): Int {\n    if (!enabled) return 0\n    var adjusted = amount + 5\n    adjusted -= 2\n    return adjusted * 2\n}', operation: 'adjusted', expected: inputs => inputs.enabled ? (inputs.amount + 5 - 2) * 2 : 0 },
  { name: 'kotlin-threshold', language: 'kotlin', extension: 'kt', extended: true, source: 'fun inspect(amount: Int): Int {\n    if (amount > 10) return amount + 5\n    return amount - 5\n}', expected: inputs => inputs.amount > 10 ? inputs.amount + 5 : inputs.amount - 5 },
  { name: 'kotlin-boolean', language: 'kotlin', extension: 'kt', extended: true, source: 'fun inspect(enabled: Boolean): Boolean {\n    if (!enabled) return false\n    return true\n}', expected: inputs => inputs.enabled },
  { name: 'kotlin-double-guard', language: 'kotlin', extension: 'kt', stress: true, source: 'fun inspect(enabled: Boolean, amount: Int): Int {\n    if (!enabled) return 0\n    if (amount >= 10) return amount * 3\n    return amount + 7\n}', expected: inputs => !inputs.enabled ? 0 : inputs.amount >= 10 ? inputs.amount * 3 : inputs.amount + 7 },
  { name: 'typescript-long-updates', language: 'typescript', extension: 'ts', stress: true, source: 'export function inspect(amount: number): number {\n    let adjusted = amount + 5;\n    adjusted -= 2;\n    adjusted *= 3;\n    adjusted += 4;\n    return (adjusted - 1) * 2;\n}', operation: 'adjusted',
    writeValue: (inputs, code) => code.includes('-=') ? inputs.amount + 3 : code.includes('*=') ? (inputs.amount + 3) * 3 : code.includes('+=') ? (inputs.amount + 3) * 3 + 4 : inputs.amount + 5,
    expected: inputs => ((inputs.amount + 3) * 3 + 3) * 2 },
  { name: 'kotlin-elvis-string', language: 'kotlin', extension: 'kt', stress: true, source: 'fun inspect(label: String?): String {\n    val adjusted = label ?: "guest"\n    return adjusted\n}', operation: 'adjusted', writeValue: inputs => inputs.label ?? 'guest', expected: inputs => inputs.label ?? 'guest' },
  { name: 'typescript-independent-guards', language: 'typescript', extension: 'ts', stress: true, source: 'export function inspect(a: boolean, b: boolean, c: boolean): number {\n    let adjusted = 0;\n    if (a) adjusted += 1;\n    if (b) adjusted += 2;\n    if (c) adjusted += 4;\n    return adjusted;\n}', operation: 'adjusted',
    writeValue: (inputs, code) => code.includes('+= 1') ? 1 : code.includes('+= 2') ? (inputs.a ? 1 : 0) + 2 : code.includes('+= 4') ? (inputs.a ? 1 : 0) + (inputs.b ? 2 : 0) + 4 : 0,
    expected: inputs => (inputs.a ? 1 : 0) + (inputs.b ? 2 : 0) + (inputs.c ? 4 : 0) },
  // Additional language cases cover Kotlin integer truncation and nested
  // writes to outer bindings; source calculations must preserve causal detail.
  { name: 'kotlin-integer-division', language: 'kotlin', extension: 'kt', fallback: true,
    source: 'fun inspect(enabled: Boolean, amount: Int): Int {\n    if (!enabled) return 0\n    val adjusted = amount / 2\n    return adjusted + 3\n}',
    expected: inputs => inputs.enabled ? Math.trunc(inputs.amount / 2) + 3 : 0 },
  { name: 'typescript-nested-scope', language: 'typescript', extension: 'ts', fallback: true,
    source: 'export function inspect(enabled: boolean, amount: number): number {\n    let adjusted = amount;\n    if (enabled) {\n        adjusted += 3;\n    }\n    return adjusted * 2;\n}',
    expected: inputs => (inputs.amount + (inputs.enabled ? 3 : 0)) * 2 },
  { name: 'typescript-object-guard', language: 'typescript', extension: 'ts', complex: true,
    source: 'export function inspect(payload: { enabled: boolean; amount: number }): number {\n    if (!payload.enabled) return 0;\n    let adjusted = payload.amount + 5;\n    adjusted *= 2;\n    return adjusted + 3;\n}',
    expected: inputs => inputs.payload.enabled ? (inputs.payload.amount + 5) * 2 + 3 : 0 },
  { name: 'typescript-member-write', language: 'typescript', extension: 'ts', complex: true,
    source: 'export function inspect(payload: { amount: number }): number {\n    payload.amount += 3;\n    return payload.amount * 2;\n}',
    expected: inputs => (inputs.payload.amount + 3) * 2 },
  { name: 'typescript-pure-helper', language: 'typescript', extension: 'ts', complex: true,
    source: 'function adjust(x: number, offset = 2): number {\n    let value = x + offset;\n    if (value > 10) return value * 2;\n    return value - 3;\n}\nexport function inspect(x: number): number {\n    const score = adjust(x);\n    return score + 1;\n}',
    expected: inputs => inputs.x + 2 > 10 ? (inputs.x + 2) * 2 + 1 : inputs.x },
  { name: 'typescript-array-read', language: 'typescript', extension: 'ts', complex: true,
    source: 'export function inspect(values: number[]): number {\n    if (values.length === 0) return 0;\n    return values[0] + 3;\n}',
    expected: inputs => inputs.values.length ? inputs.values[0] + 3 : 0 },
  { name: 'typescript-loop-gap', language: 'typescript', extension: 'ts', complex: true, loops: true,
    source: 'export function inspect(payload: { amount: number }): number {\n    while (payload.amount < 3) {\n        payload.amount += 1;\n    }\n    return payload.amount;\n}',
    expected: inputs => Math.max(inputs.payload.amount, 3) },
  { name: 'kotlin-while', language: 'kotlin', extension: 'kt', loops: true,
    source: 'fun inspect(amount: Int): Int {\n    var adjusted = amount\n    while (adjusted < 3) {\n        adjusted += 1\n    }\n    return adjusted\n}',
    expected: inputs => Math.max(inputs.amount, 3) },
  { name: 'typescript-while', language: 'typescript', extension: 'ts', loops: true,
    source: 'export function inspect(amount: number): number {\n    let adjusted = amount;\n    while (adjusted < 3) {\n        adjusted += 1;\n    }\n    return adjusted;\n}',
    expected: inputs => Math.max(inputs.amount, 3) },
  { name: 'kotlin-do-while', language: 'kotlin', extension: 'kt', loops: true,
    source: 'fun inspect(amount: Int): Int {\n    var adjusted = amount\n    do {\n        adjusted += 1\n    } while (adjusted < 3)\n    return adjusted\n}',
    expected: inputs => Math.max(inputs.amount + 1, 3) },
  { name: 'typescript-do-while', language: 'typescript', extension: 'ts', loops: true,
    source: 'export function inspect(amount: number): number {\n    let adjusted = amount;\n    do {\n        adjusted += 1;\n    } while (adjusted < 3);\n    return adjusted;\n}',
    expected: inputs => Math.max(inputs.amount + 1, 3) },
  // The external audit body is absent: mathematical results apply only if it
  // returns normally. These fixtures must retain the missing-call limitation.
  { name: 'kotlin-effect-prefix', language: 'kotlin', extension: 'kt', effects: true, gaps: true,
    source: 'fun inspect(amount: Int): Int {\n    var adjusted = amount + 5\n    adjusted -= 2\n    adjusted *= 3\n    adjusted += 4\n    audit(adjusted)\n    return adjusted\n}',
    operation: 'adjusted', writeValue: (inputs, code) => code.includes('-=') ? inputs.amount + 3 : code.includes('*=') ? (inputs.amount + 3) * 3 : code.includes('+=') ? (inputs.amount + 3) * 3 + 4 : inputs.amount + 5,
    expected: inputs => (inputs.amount + 3) * 3 + 4 },
  { name: 'typescript-effect-prefix', language: 'typescript', extension: 'ts', effects: true, gaps: true,
    source: 'export function inspect(amount: number): number {\n    let adjusted = amount + 5;\n    adjusted -= 2;\n    adjusted *= 3;\n    adjusted += 4;\n    audit(adjusted);\n    return adjusted;\n}',
    operation: 'adjusted', writeValue: (inputs, code) => code.includes('-=') ? inputs.amount + 3 : code.includes('*=') ? (inputs.amount + 3) * 3 : code.includes('+=') ? (inputs.amount + 3) * 3 + 4 : inputs.amount + 5,
    expected: inputs => (inputs.amount + 3) * 3 + 4 }
];
const only = process.argv[4] && process.argv[4] !== '-' ? process.argv[4] : undefined;
const outputDirectory = await fs.promises.mkdtemp(path.join(tmpdir(), 'fn-benchmark-'));
const modelPath = process.argv[5] && process.argv[5] !== '-' ? process.argv[5] : path.join(repo, '.local-models/Qwen3.5-4B-Q4_K_M.gguf');
const binaryPath = await require(repo + '/out/vscode/functionNarrativeSetup/localBinary').resolveLocalBinary(process.argv[6] || '');
const fullRun = process.argv[7] === 'full-run';
const configurationMode = ['configured', 'configured-source'].includes(process.argv[8]) ? process.argv[8] : undefined;
console.log(JSON.stringify({ outputDirectory, tag, runtime, fullRun, configurationMode, model: path.basename(modelPath), note: 'Public fixed-formula corpus and a narrow causal-language check, not a general accuracy guarantee.' }));

async function contextFor(fixture) {
  const lines = fixture.source.split('\n');
  const filePath = '/qa/' + fixture.name + '.' + fixture.extension;
  const startLine = Math.max(0, lines.findIndex(line => /(?:fun|function)\s+inspect\b/.test(line)));
  const node = { id: 'benchmark:' + fixture.name, name: 'inspect', qualifiedName: 'inspect', kind: 'function', language: fixture.language, filePath,
    range: { startLine, startCharacter: 0, endLine: lines.length - 1, endCharacter: lines.at(-1).length },
    selectionRange: { startLine, startCharacter: 4, endLine: startLine, endCharacter: 11 } };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText: fixture.source });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText: fixture.source, functionLogic: logic });
  const graph = { workspaceRoot: '/qa', version: fixture.name, generatedAt: '2026-10-07T00:00:00.000Z', nodes: [node], edges: [], diagnostics: [],
    metadata: { languages: [fixture.language], frameworks: [], frameworkUnits: [], frameworkUnitEdges: [], fileCount: 1, symbolCount: 1, edgeCount: 0 } };
  const insights = new CodeFlowInsightCache().get(graph);
  const model = await buildFunctionTutorModel({ graph, declaration, functionLogic: logic, architectureIndex: insights.functionArchitecture,
    semanticFlows: insights.semanticFlows, functionIndex: insights.functionIndex, readSourceText: async () => fixture.source });
  let context = application.addFunctionNarrativeValueGrounding({ ...application.buildFunctionNarrativeContext(node, fixture.source, [], logic), detailLevel: 'rich',
    parameters: declaration.parameters.map(parameter => ({ name: parameter.name, type: parameter.typeText })),
    valueNames: [...new Set(declaration.program.bindings.map(binding => binding.name).concat(['condition', 'result']))] }, model);
  const nodeIds = logic.blocks.map((_, index) => 'function-logic-block:' + index.toString(16).padStart(32, '0'));
  const ids = new Map(logic.blocks.map((block, index) => [block.id, nodeIds[index]]));
  context = application.bindFunctionNarrativeGraph(context, nodeIds, logic.edges.map((edge, index) => ({ id: 'function-logic-edge:' + index.toString(16).padStart(32, '0'), sourceId: ids.get(edge.sourceId), targetId: ids.get(edge.targetId), kind: edge.kind })));
  return context;
}

function score(fixture, pages, context) {
  let scenarios = 0, correctResults = 0, reachedWrites = 0, contradictoryWrites = 0, falseGuardExitClaims = 0, falseGuardBodyClaims = 0, trueGuardSkippedBodyClaims = 0, copiedOperationProse = 0, operationMismatches = 0, incorrectWriteValues = 0, completeNodes = 0, totalNodes = 0, detailedSourceNodes = 0, sourceDetailCharacters = 0;
  const failures = [];
  const kinds = new Map((context.scenarioGraph?.nodes || []).map(node => [node.graphNodeId, node.kind]));
  for (const page of pages) for (const scenario of page.narrative.scenarios) {
    scenarios++;
    const inputs = Object.fromEntries(scenario.example.inputs.map(input => [input.name, JSON.parse(input.json)]));
    const expected = fixture.expected(inputs, scenario);
    let result; try { result = JSON.parse(scenario.example.result); } catch {}
    if (result === expected) correctResults++;
    else failures.push({ kind: 'result', scenario: scenarios, expected, actual: scenario.example.result });
    totalNodes += scenario.graph.nodeIds.length;
    completeNodes += scenario.nodeDetails.length;
    for (const detail of scenario.nodeDetails) if (detail.code) {
      const prose = [detail.syntax, detail.text, detail.reason, detail.effect];
      if (prose.every(value => typeof value === 'string' && value.trim())) detailedSourceNodes++;
      else failures.push({ kind: 'missing-detailed-source-reading', scenario: scenarios, line: detail.source.startLine });
      sourceDetailCharacters += prose.reduce((sum, value) => sum + (value?.length || 0), 0);
    }
    // This public corpus contains complete primitive expressions and no external
    // dependencies; fabricated prerequisites are a quality failure, not a gap.
    if (!fixture.gaps && (scenario.assumptions.length || page.narrative.limitations.length)) failures.push({ kind: 'unsupported-prerequisites', scenario: scenarios,
      assumptions: scenario.assumptions, limitations: page.narrative.limitations });
    if (fixture.effects) {
      if (!scenario.assumptions.length || !page.narrative.limitations.length) failures.push({ kind: 'missing-external-call-qualification', scenario: scenarios });
      for (const detail of scenario.nodeDetails) if (kinds.get(detail.nodeId) === 'call') {
        if (!detail.values?.some(value => /미확인|unknown/iu.test(value.after)) || !/미확인|unknown/iu.test(detail.effect || '')) {
          failures.push({ kind: 'external-call-outcome-not-unknown', scenario: scenarios });
        }
      }
    }
    for (const detail of scenario.nodeDetails) if (kinds.get(detail.nodeId) === 'return') {
      const binding = /^return\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*;?$/u.exec(detail.code)?.[1];
      const after = (detail.values?.find(value => value.name === 'result') ?? detail.values?.find(value => value.name === binding))?.after;
      let actual; try { actual = JSON.parse(after); } catch {}
      if (actual !== expected) failures.push({ kind: 'incorrect-return-node-value', scenario: scenarios, expected, actual: after });
      if (/실행되지|실행하지 않|not executed|not run|not reached|skipped/i.test([detail.text, detail.syntax].join(' '))) {
        failures.push({ kind: 'reached-return-described-as-skipped', scenario: scenarios, line: detail.source.startLine });
      }
    }
    for (let index = 1; index < scenario.nodeDetails.length; index++) {
      const previous = scenario.nodeDetails[index - 1], current = scenario.nodeDetails[index];
      if (previous.code && current.code && previous.code !== current.code && previous.text === current.text && previous.syntax === current.syntax) {
        copiedOperationProse++; failures.push({ kind: 'different-operations-share-identical-prose', scenario: scenarios });
      }
    }
    if (inputs.enabled === true) {
      const prose = [scenario.explanation, scenario.analysis?.pathReason, scenario.analysis?.stateChange,
        ...scenario.nodeDetails.filter(detail => detail.code === '!enabled').flatMap(detail => [detail.reason, detail.effect])].join(' ');
      if (/if\s*(?:블록|본문)[^.!?]{0,12}(?:실행됩니다|실행된다|실행합니다|실행되며|진입합니다)/i.test(prose)) {
        falseGuardBodyClaims++; failures.push({ kind: 'false-guard-claims-true-body-entry', scenario: scenarios });
      }
    }
    if (inputs.enabled === false && scenario.nodeDetails.some(detail => detail.code === '!enabled')) {
      const prose = [scenario.explanation, scenario.analysis?.pathReason].join(' ');
      if (/if\s*(?:블록|본문)[^.!?]{0,18}(?:실행되지|실행하지|건너뛰)|(?:true|참)[^.!?]{0,32}(?:if body|if 본문)[^.!?]{0,20}(?:skip|건너뛰)/iu.test(prose)) {
        trueGuardSkippedBodyClaims++; failures.push({ kind: 'true-guard-claims-body-skipped', scenario: scenarios });
      }
    }
    for (const detail of scenario.nodeDetails) if (inputs.enabled === true && detail.code === '!enabled') {
      const causal = [detail.reason, detail.effect].join(' ');
      if (/(?:거짓|false)[^.!?]{0,48}(?:반환(?:됩니다|합니다|되며|하고)|returns?)/i.test(causal)
        && !/반환(?:하지|되지)|반환문[^.!?]*(?:건너뛰|생략)|skip[^.!?]*return|not[^.!?]*return/i.test(causal)) {
        falseGuardExitClaims++; failures.push({ kind: 'false-guard-claims-exit-before-reached-write', scenario: scenarios, line: detail.source.startLine });
      }
    }
    for (const detail of scenario.nodeDetails) if (kinds.get(detail.nodeId) === 'mutation' && fixture.operation === 'adjusted') {
      reachedWrites++;
      const currentProse = [detail.text, detail.syntax].join(' ');
      if (/부정|반전|negat|if\s*(?:블록|본문)/i.test(currentProse) && !/더|합|곱|\+|\*|assign|add|sum|multipl/i.test(currentProse)) {
        operationMismatches++; failures.push({ kind: 'write-described-as-predicate', scenario: scenarios, line: detail.source.startLine });
      }
      const expectedAfter = fixture.writeValue ? fixture.writeValue(inputs, detail.code) : fixture.name === 'kotlin-elvis' ? inputs.amount ?? 5
        : detail.code.includes('*=') ? (inputs.amount + 5) * 2 : detail.code.includes('-=') ? inputs.amount + 5 - 2 : inputs.amount + 5;
      const after = detail.values?.find(value => value.name === 'adjusted')?.after;
      let actualAfter; try { actualAfter = JSON.parse(after); } catch {}
      // Portable value rows are display strings. A known string may be stored
      // as raw text by legacy providers, while numeric calculations must parse.
      if (actualAfter === undefined && typeof expectedAfter === 'string') actualAfter = after;
      if (actualAfter !== expectedAfter) {
        incorrectWriteValues++; failures.push({ kind: 'incorrect-current-write-value', scenario: scenarios, line: detail.source.startLine, expected: expectedAfter, actual: after });
      }
      if (/실행되지|실행되지 않|실행하지 않|not executed|not run|not reached|skipped/i.test([detail.text, detail.syntax].join(' '))) {
        contradictoryWrites++; failures.push({ kind: 'reached-write-described-as-skipped', scenario: scenarios, line: detail.source.startLine });
      }
    }
  }
  return { scenarios, correctResults, reachedWrites, contradictoryWrites, falseGuardExitClaims, falseGuardBodyClaims, trueGuardSkippedBodyClaims, copiedOperationProse, operationMismatches, incorrectWriteValues, completeNodes, totalNodes, detailedSourceNodes, sourceDetailCharacters, failures };
}

(async () => {
  const records = [];
  for (const fixture of corpus.filter(item => only === 'source-release' ? item.loops || item.effects : only === 'effects' ? item.effects : only === 'release' ? !item.complex && !item.loops && !item.effects : only === 'loops' ? item.loops : only === 'complex' ? item.complex : only === 'complex-supported' ? item.complex && !item.gaps : only === 'all' ? !item.stress && !item.fallback && !item.complex && !item.loops && !item.effects : only === 'stress' ? item.stress
    : only === 'fallback' ? item.fallback : only === 'extended' ? item.extended
      : only ? item.name === only : !item.extended && !item.stress && !item.fallback && !item.complex && !item.loops && !item.effects)) {
    const context = await contextFor(fixture);
    if (process.argv[8] === 'context-only') {
      const batch = new application.FunctionNarrativeScenarioRun(context).nextBatch();
      const preparation = { ...batch, nodePreparation: true };
      const file = path.join(outputDirectory, fixture.name + '-context.json');
      fs.writeFileSync(file, JSON.stringify(preparation, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ contextOnly: file, limited: preparation.limited, groundingLimited: preparation.groundingLimited,
        supportedWorksheet: application.buildPrimitiveWorksheetResponse?.(preparation, 'ko') !== undefined }));
      continue;
    }
    const pages = new Map(), traces = [], metrics = [], watchdogPids = [], runnerPids = new Set();
    let peakObservedRunnerRssKiB = 0;
    const manager = new ModelTaskManager();
    const onMetrics = value => {
      metrics.push(value);
      // Observe this benchmark's own watchdog only, never another window's
      // model. Equal consecutive PIDs prove reuse across async page work.
      if (process.platform !== 'win32') {
        try {
          const watchers = execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number);
          watchdogPids.push(watchers);
          for (const watcher of watchers) {
            const pids = execFileSync('pgrep', ['-P', String(watcher)], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number);
            for (const pid of pids) {
              runnerPids.add(pid);
              const rss = Number(execFileSync('ps', ['-p', String(pid), '-o', 'rss='], { encoding: 'utf8' }).trim());
              if (Number.isFinite(rss)) peakObservedRunnerRssKiB = Math.max(peakObservedRunnerRssKiB, rss);
            }
          }
        }
        catch { watchdogPids.push([]); }
      }
    };
    const setup = { factories: 0, managedEnsures: 0, notifications: 0 };
    let local;
    if (configurationMode) {
      const api = { workspace: { getConfiguration() { return { get(key, fallback) {
        return { provider: 'local', localBinary: configurationMode === 'configured-source' ? '/missing-runtime/llama-completion' : binaryPath,
          localModel: configurationMode === 'configured-source' ? '/missing-runtime/model.gguf' : modelPath }[key] ?? fallback;
      } }; } }, ProgressLocation: { Notification: 15 }, window: {
        async withProgress(_settings, operation) { setup.notifications++; return operation({ report() {} }, { isCancellationRequested: false, onCancellationRequested() { return { dispose() {} }; } }); },
        showErrorMessage() { return Promise.resolve(undefined); }, showQuickPick() { return Promise.resolve(undefined); }
      }, lm: { async selectChatModels() { throw new Error('Unexpected connected provider'); } },
      LanguageModelChatMessage: { User(content) { return { content }; } }, CancellationTokenSource: class { token = {}; cancel() {} dispose() {} } };
      const models = { model: { id: 'benchmark', name: 'Benchmark', fileName: path.basename(modelPath), url: 'https://example.invalid', bytes: 2740937888, sha256: 'a'.repeat(64) },
        async ensure() { setup.managedEnsures++; throw new Error('Unexpected managed model transfer in public source benchmark'); }, dispose() {} };
      local = require(runtime + '/out/vscode/functionNarrativeSetup').createConfiguredNarrativeProvider(api, models,
        options => { setup.factories++; return createLocalFunctionNarrativeProvider({ ...options, taskManager: manager, onMetrics }); }, manager);
    } else local = createLocalFunctionNarrativeProvider({ binaryPath, modelPath, taskManager: manager, onMetrics });
    const provider = { supportsFinalSummary: signal => local.supportsFinalSummary?.(signal) === true,
      withRun: (language, signal, operation) => local.withRun ? local.withRun(language, signal, operation) : operation(), async generate(batch, language, signal, options) {
      const began = performance.now();
      const response = await local.generate(batch, language, signal, options);
      traces.push({ kind: batch.nodeTask ? 'nodes' : batch.summaryTask ? 'summary' : 'scenario', offset: batch.scenarioBatch.offset, targets: batch.nodeTask?.targets.length || 0, milliseconds: performance.now() - began, characters: response.text.length });
      fs.writeFileSync(outputDirectory + '/narrative-bench-' + tag + '-' + fixture.name + '-' + traces.length + '.json', response.text, { mode: 0o600 });
      console.log(JSON.stringify({ tag, fixture: fixture.name, request: traces.length, ...traces.at(-1) }));
      return response;
    } };
    const store = { async write(index, narrative) { pages.set(index, narrative); }, async read(index) { return pages.get(index); }, async dispose() { pages.clear(); } };
    const session = new FunctionNarrativeScenarioSession(context, store);
    const began = performance.now();
    let error;
    const signal = new AbortController().signal;
    const analyze = async () => { while (!session.complete) { const page = await session.analyzeNext(provider, 'ko', signal, { reselectModel: false }); if (!page) break; } };
    try {
      if (configurationMode && local.prepare) await local.prepare('ko', signal, { sourceReading: true, label: fixture.name });
      if (fullRun) await provider.withRun('ko', signal, analyze); else await analyze();
    }
    catch (failure) { error = { code: failure.code || failure.message, detail: failure.detailCode }; }
    const renderedPages = [...pages.entries()].map(([index, narrative]) => ({ index, narrative }));
    const remainingRunnerPids = [...runnerPids].filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
    const record = { name: fixture.name, milliseconds: performance.now() - began, requests: traces.length, complete: session.complete, coverage: session.coverage, score: score(fixture, renderedPages, context), error, traces, metrics,
      ...(configurationMode ? { setup, tasks: manager.snapshot().history.map(task => ({ kind: task.kind, phase: task.phase })) } : {}), watchdogPids, peakObservedRunnerRssKiB, remainingRunnerPids };
    fs.writeFileSync(outputDirectory + '/narrative-bench-' + tag + '-' + fixture.name + '-pages.json', JSON.stringify(renderedPages, null, 2), { mode: 0o600 });
    records.push(record); console.log(JSON.stringify({ tag, completedFixture: record }));
    await session.dispose(); await manager.dispose();
  }
  fs.writeFileSync(outputDirectory + '/narrative-bench-' + tag + '-report.json', JSON.stringify({ tag, runtime, records }, null, 2), { mode: 0o600 });
  if (records.some(record => !record.complete || record.error || record.score.failures.length || record.remainingRunnerPids.length)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
