/** Real parser/graph/capture/Host collaborators; only model replies and transient file I/O are test doubles. */
import assert from "node:assert/strict";
import { AnalyzerPipeline } from "../../analyzer/core/analyzerPipeline";
import { TypeScriptAnalyzer } from "../../analyzer/languages/typescript";
import { createNarrativeSourceAccess } from "../../application/narrativeSources";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow/codeFlowEvidenceTokenRegistry";
import type { NarrativeSourceAccess, NarrativeSourceLease, SourceCaptureLimits } from "../../shared/narrativeSources";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import type { SourceFile } from "../../shared/types";
import { buildFunctionNarrativeScenarioFrames } from "../../application/functionNarratives";
import { createContentHash } from "../../shared/hash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RustAnalyzerBackend } from "../../analyzer/rust/rustAnalyzerBackend";

/** Long comments test complete source independently of route/node budgets. No subject function executes. */
export async function wholeNarrativeHostFixture(callCount = 12, overrides: Partial<SourceCaptureLimits> = {},
  options: { callExpression?(index: number): string; beforeCalls?: string; afterCalls?: string } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'whole-source-host-'));
  const helperText = 'export function finish(value: string): string {\r\n'
    + Array.from({ length: 85 }, (_, index) => `  // Helper 원문 😀 ${index}: preserve this entire declaration and its original line ending.\r\n`).join('')
    + '  return value;\r\n}';
  const rootText = 'export function checkout(enabled: boolean): string {\r\n'
    + Array.from({ length: 225 }, (_, index) => `  // Parent 원문 😀 ${index}: every source character after the former excerpt boundary is required.\r\n`).join('')
    + (options.beforeCalls ?? '')
    + Array.from({ length: callCount }, (_, index) => `  const item${index} = ${options.callExpression?.(index) ?? `finish("source-${index}")`};\r\n`).join('')
    + (options.afterCalls ?? '')
    + '  if (enabled) return "enabled";\r\n  return "disabled";\r\n}';
  const callerText = 'export function outsideCaller(): string { return checkout(true); }';
  const files: SourceFile[] = [
    { path: path.join(directory, 'root.ts'), languageId: 'typescript', content: 'import { finish } from "./helpers";\r\n' + rootText + '\r\n' },
    { path: path.join(directory, 'helpers.ts'), languageId: 'typescript', content: helperText + '\r\n' },
    { path: path.join(directory, 'caller.ts'), languageId: 'typescript', content: 'import { checkout } from "./root";\n' + callerText + '\n' }
  ].map(file => ({ ...file, sizeBytes: Buffer.byteLength(file.content), contentHash: createContentHash(file.content) }));
  const fileSystem = { getWorkspaceRoot: () => directory, findSourceFiles: async () => files };
  const nativeEvents: string[] = [];
  const analyzer = new RustAnalyzerBackend({ engineRoot: path.resolve('engine/analyzer'), workspaceFileSystem: fileSystem, maxFileSizeKb: 1024,
    fallbackBackend: new AnalyzerPipeline(fileSystem, [new TypeScriptAnalyzer()]),
    logger: { debug() {}, info(event) { nativeEvents.push(event); }, warn(event) { nativeEvents.push(event); }, error(event) { nativeEvents.push(event); } } });
  let graph: Awaited<ReturnType<typeof analyzer.analyzeWorkspace>>['graph'];
  try {
    await Promise.all(files.map(file => fs.writeFile(file.path, file.content)));
    ({ graph } = await analyzer.analyzeWorkspace());
    assert.ok(nativeEvents.includes('rust.workspace.complete')); assert.ok(!nativeEvents.includes('rust.workspace.failed'));
  } finally { analyzer.dispose(); await fs.rm(directory, { recursive: true, force: true }); }
  const root = graph.nodes.find(node => node.kind === 'function' && node.name === 'checkout'); assert.ok(root);
  const graphDelivery = new WebviewGraphDelivery(), graphVersion = graphDelivery.activate(graph).snapshot.version;
  const sourceNodeTokens = new SourceNodeTokenRegistry(), evidenceTokens = new CodeFlowEvidenceTokenRegistry();
  sourceNodeTokens.activate(graphVersion, graph); evidenceTokens.activate(graphVersion, graph);
  const events: string[] = [], leases: NarrativeSourceLease[] = [];
  const state = { disposed: 0, reads: 0, captures: 0, revision: 1 };
  const base = createNarrativeSourceAccess({ async read(filePath, maximumBytes, signal) {
    assert.equal(signal.aborted, false); state.reads++;
    const file = files.find(file => file.path === filePath); if (!file) return undefined;
    assert.ok(Buffer.byteLength(file.content) <= maximumBytes);
    return { filePath, text: file.content, revision: 'fixture:' + state.revision };
  } }, { maxDepth: 8, maxDeclarations: 64, maxSourceBytes: 196608, maxFileBytes: 1048576, maxTotalFileBytes: 4194304,
    maxGraphNodes: 4096, maxEdges: 16384, ...overrides });
  const access: NarrativeSourceAccess = { maxDepth: base.maxDepth, readFileText: base.readFileText,
    async capture(input) {
      events.push('capture'); state.captures++;
      const lease = await base.capture(input); leases.push(lease);
      let disposed = false;
      return { capture: lease.capture, captureSha256: lease.captureSha256, assertCurrent: signal => lease.assertCurrent(signal),
        createValidationReceipt: () => lease.createValidationReceipt(), dispose() {
        if (!disposed) { disposed = true; state.disposed++; events.push('source-disposed'); lease.dispose(); }
      } };
    } };
  return { graph, root, files, rootText, helperText, callerText, graphDelivery, graphVersion, sourceNodeTokens, evidenceTokens, access, events, state, leases };
}

/** External-model fixture only: no source evaluator, worksheet, prior teacher or saved response is consulted. */
export function wholeRootReply(context: FunctionNarrativeContext) {
  const frames = buildFunctionNarrativeScenarioFrames(context);
  const scenarios = frames.map(frame => {
    const enabled = context.sourceFlow?.paths[0].steps.find(step => step.branch)?.branch?.outcome !== 'false';
    const example = context.nodeTask?.example ?? { inputs: [{ name: 'enabled', json: String(enabled) }], result: enabled ? 'enabled' : 'disabled' };
    const targets = context.nodeTask?.targets ?? [context.sourceFlow!.paths[0].steps.at(-1)!];
    return { title: 'A source route', when: frame.when, outcome: frame.outcome, assumptions: [], example,
      explanation: 'The chosen input follows the supplied source conditions to its return.',
      analysis: { pathReason: 'The selected condition reaches this source return.', stateChange: 'The source result is returned to the caller.', alternative: 'The other condition selects the other return.' },
      steps: targets.map(target => ({ code: target.code, source: target.source, text: 'Read this supplied source operation.', syntax: 'A predicate selects a route; return finishes the function.',
        reason: 'The chosen input follows this selected source condition.', effect: 'Proceed to the supplied next operation or return.',
        values: [{ name: 'enabled', before: example.inputs[0].json, after: example.inputs[0].json }] })) };
  });
  return { modelName: 'External boundary fixture', text: JSON.stringify(context.nodeTask ? { steps: scenarios[0].steps }
    : { summary: 'Select one source string using the Boolean condition.', scenarios, limitations: [] }) };
}
