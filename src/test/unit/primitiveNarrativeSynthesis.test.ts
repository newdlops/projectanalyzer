/** Whole-function source synthesis tests preserve causal detail, correct alternatives and one on-demand model purpose. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { buildFunctionNarrativeContext, bindFunctionNarrativeGraph, buildPrimitiveNarrativeSynthesis,
  selectPrimitiveNarrativeAlternative, buildPrimitiveWorksheetResponse, parseFunctionNarrative,
  initializeFunctionNarrativeNodes, createFunctionNarrativeNodeTask, appendFunctionNarrativeNodes,
  createFunctionNarrativeSummaryTask, FunctionNarrativeScenarioRun } from "../../application/functionNarratives";
import { createLocalFunctionNarrativeProvider } from "../../llm/functionNarratives";
import { FunctionNarrativeScenarioSession } from "../../webview/codeFlow/functionNarrativeScenarioSession";
import { ModelTaskManager } from "../../shared/modelTasks";
import { hasSimplePrimitiveScopes } from "../../application/functionNarratives/primitiveWorksheet/scope";
import type { FunctionNarrative, FunctionNarrativeContext } from "../../shared/functionNarratives";
import type { SymbolNode } from "../../shared/types";

/** Production graph/iterator ownership is retained; the independent formulas below check results rather than invoking user source. */
function fixture(source: string, language: "kotlin" | "typescript", parameters: NonNullable<FunctionNarrativeContext["parameters"]>) {
  const lines = source.split("\n"), node: SymbolNode = { id: "source-synthesis", name: "inspect", qualifiedName: "inspect", kind: "function", language,
    filePath: "/fixture/inspect." + (language === "kotlin" ? "kt" : "ts"), range: { startLine: 0, startCharacter: 0, endLine: lines.length - 1, endCharacter: lines.at(-1)!.length },
    selectionRange: { startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 11 } };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText: source });
  return bindFunctionNarrativeGraph({ ...buildFunctionNarrativeContext(node, source, [], logic), detailLevel: "rich", parameters,
    valueNames: ["a", "b", "c", "amount", "enabled", "adjusted", "label", "condition", "result"] }, logic.blocks.map((_, index) => "node:" + index), []);
}

/** Completing worksheets still uses the same Host validation and ordered append boundaries as real delivery. */
function completed(original: FunctionNarrativeContext, language: "ko" | "en") {
  const run = new FunctionNarrativeScenarioRun(original), batch = run.nextBatch()!, path = batch.sourceFlow!.paths[0];
  const preparation = { ...batch, nodePreparation: true };
  const scenario = parseFunctionNarrative(buildPrimitiveWorksheetResponse(preparation, language)!, preparation, language).scenarios[0];
  initializeFunctionNarrativeNodes(path, scenario, "rich");
  let task;
  while ((task = createFunctionNarrativeNodeTask(batch, path, scenario))) {
    appendFunctionNarrativeNodes(task, scenario, parseFunctionNarrative(buildPrimitiveWorksheetResponse(task, language)!, task, language).scenarios[0]);
  }
  const summary = createFunctionNarrativeSummaryTask(batch, path, scenario);
  summary.summaryTask!.sourceAlternative = selectPrimitiveNarrativeAlternative(original, path, summary.summaryTask!.inputs, language);
  return summary;
}

test("source reading names the true early return and a concretely calculated alternate route without inventing if-body work", () => {
  const original = fixture('fun inspect(enabled: Boolean, amount: Int): Int {\n if (!enabled) return 0\n val adjusted = amount + 5\n return adjusted\n}',
    "kotlin", [{ name: "enabled", type: "Boolean" }, { name: "amount", type: "Int" }]);
  for (const language of ["ko", "en"] as const) {
    const task = completed(original, language), reading = buildPrimitiveNarrativeSynthesis(task, language)!;
    assert.ok(reading); assert.equal(reading.scenarios[0].example!.result, "0");
    assert.match(reading.scenarios[0].explanation!, /! false = true/u);
    assert.match(reading.scenarios[0].explanation!, /return 0/u);
    assert.doesNotMatch(reading.scenarios[0].explanation!, /adjusted|본문|if body|skip/u);
    assert.match(reading.scenarios[0].analysis!.alternative, /enabled=true/u);
    assert.match(reading.scenarios[0].analysis!.alternative, /!enabled=false/u);
    assert.match(reading.scenarios[0].analysis!.alternative, /adjusted=15/u);
    assert.match(reading.scenarios[0].analysis!.alternative, /15 = 15/u);
    const summary = language === "ko" ? "활성 여부에 따라 0을 조기 반환하거나 amount에 5를 더해 반환합니다." : "Return zero when disabled, otherwise add five to amount and return it.";
    assert.doesNotThrow(() => parseFunctionNarrative(JSON.stringify({ ...reading, summary }), task, language));
    const wrong = structuredClone(task); wrong.summaryTask!.sourceAlternative!.inputs[1].json = '"not a number"';
    assert.equal(buildPrimitiveNarrativeSynthesis(wrong, language), undefined);
    const contradiction = structuredClone(task); contradiction.summaryTask!.completed[0].values![0].after = "false";
    assert.equal(buildPrimitiveNarrativeSynthesis(contradiction, language), undefined);
  }
});

test("an unchanged arithmetic route explains another typed input and retains every compound write and full return calculation", () => {
  const original = fixture('function inspect(amount: number): number {\n let adjusted = amount + 5;\n adjusted -= 2;\n adjusted *= 3;\n adjusted += 4;\n return (adjusted - 1) * 2;\n}',
    "typescript", [{ name: "amount", type: "number" }]);
  const task = completed(original, "en"), reading = buildPrimitiveNarrativeSynthesis(task, "en")!;
  assert.ok(reading); assert.equal(reading.scenarios[0].example!.result, "84");
  for (const code of ["let adjusted = amount + 5;", "adjusted -= 2;", "adjusted *= 3;", "adjusted += 4;", "return (adjusted - 1) * 2;"]) {
    assert.ok(reading.scenarios[0].explanation!.includes(code));
  }
  assert.match(reading.scenarios[0].explanation!, /\( 43 - 1 \) \* 2 = 84/u);
  assert.match(reading.scenarios[0].analysis!.alternative, /amount=0/u);
  assert.match(reading.scenarios[0].analysis!.alternative, /= 24/u);
});

test("unsupported alternate computations and omitted completed values retain the full model synthesis", () => {
  const original = fixture('fun inspect(enabled: Boolean, amount: Int): Int {\n if (!enabled) return 0\n val adjusted = load(amount)\n return adjusted + 3\n}',
    "kotlin", [{ name: "enabled", type: "Boolean" }, { name: "amount", type: "Int" }]);
  const task = completed(original, "en");
  assert.equal(task.summaryTask!.sourceAlternative, undefined);
  assert.equal(buildPrimitiveNarrativeSynthesis(task, "en"), undefined);
  task.summaryTask!.omittedValues = 1;
  assert.equal(buildPrimitiveNarrativeSynthesis(task, "en"), undefined);
});

test("nested control blocks preserve outer writes while shadowing, nested declarations and loop/exception transfers remain model work", () => {
  const original = fixture('function inspect(enabled: boolean, amount: number): number {\n let adjusted = amount;\n if (enabled) {\n adjusted += 3;\n }\n return adjusted * 2;\n}',
    "typescript", [{ name: "enabled", type: "boolean" }, { name: "amount", type: "number" }]);
  const reading = buildPrimitiveNarrativeSynthesis(completed(original, "en"), "en")!;
  assert.ok(reading); assert.equal(reading.scenarios[0].example!.result, "26");
  assert.match(reading.scenarios[0].analysis!.alternative, /enabled=false/u);
  assert.match(reading.scenarios[0].analysis!.alternative, /10 \* 2 = 20/u);
  assert.equal(hasSimplePrimitiveScopes('function inspect() { /* { while */ const label = "{ try }"; return 1; }'), true);
  assert.equal(hasSimplePrimitiveScopes('fun inspect(): Int { /* outer /* inner */ } while */ return 1 }', true), true);
  for (const body of ['if (true) { let adjusted = 1; }', 'function inner() { return 1; }', 'class Inner {}',
    'while (true) {}', 'try { return 1; } catch {}']) {
    assert.equal(hasSimplePrimitiveScopes('function inspect() {' + body + '}'), false, body);
  }
});

test("Kotlin integer division explains truncation toward zero and keeps a source-proved alternate numeric result", () => {
  const original = fixture('fun inspect(enabled: Boolean, amount: Int): Int {\n if (!enabled) return 0\n val adjusted = amount / 2\n return adjusted + 3\n}',
    "kotlin", [{ name: "enabled", type: "Boolean" }, { name: "amount", type: "Int" }]);
  const task = completed(original, "ko"), reading = buildPrimitiveNarrativeSynthesis(task, "ko")!;
  assert.ok(reading); assert.match(reading.scenarios[0].analysis!.alternative, /adjusted=5/u);
  assert.match(reading.scenarios[0].analysis!.alternative, /5 \+ 3 = 8/u);
});

test("closed literal conditions omit impossible branches, while names and external predicates preserve both source choices", () => {
  for (const condition of ["true", "3 > 2", "!false"]) {
    const original = fixture(`function inspect(): number {\n if (${condition}) return 1;\n return 0;\n}`, "typescript", []);
    const run = new FunctionNarrativeScenarioRun(original), paths = [];
    while (!run.complete) { const batch = run.nextBatch(); if (!batch) break; paths.push(...batch.sourceFlow!.paths); run.commitBatch(); }
    assert.equal(paths.length, 1); assert.equal(paths[0].steps.at(-1)!.code, "return 1;");
    assert.equal(paths[0].steps[0].branch!.outcome, "true");
  }
  for (const condition of ["enabled", "load()"]){
    const original = fixture(`function inspect(enabled: boolean): number {\n if (${condition}) return 1;\n return 0;\n}`, "typescript", [{ name: "enabled", type: "boolean" }]);
    const run = new FunctionNarrativeScenarioRun(original), paths = [];
    while (!run.complete) { const batch = run.nextBatch(); if (!batch) break; paths.push(...batch.sourceFlow!.paths); run.commitBatch(); }
    assert.equal(paths.length, 2);
  }
});

test("all eight detailed paths use one actual model purpose and cache navigation never spawns another runner", async () => {
  const original = fixture('function inspect(a: boolean, b: boolean, c: boolean): number {\n let adjusted = 0;\n if (a) adjusted += 1;\n if (b) adjusted += 2;\n if (c) adjusted += 4;\n return adjusted;\n}',
    "typescript", ["a", "b", "c"].map(name => ({ name, type: "boolean" })));
  const directory = await mkdtemp(join(tmpdir(), "source-purpose-")), modelPath = join(directory, "fixture.gguf"), binaryPath = join(directory, "runner");
  const manager = new ModelTaskManager(), pages = new Map<number, FunctionNarrative>();
  const session = new FunctionNarrativeScenarioSession(original, { async write(index, narrative) { pages.set(index, narrative); },
    async read(index) { return pages.get(index); }, async dispose() { pages.clear(); } });
  await writeFile(modelPath, "GGUF fixture");
  await writeFile(binaryPath, `#!${process.execPath}\nconst fs=require('node:fs'); const path=require('node:path'); const args=process.argv.slice(2);
    const schema=JSON.parse(fs.readFileSync(args[args.indexOf('--json-schema-file')+1],'utf8'));
    const prompt=fs.readFileSync(args[args.indexOf('--file')+1],'utf8');
    if(schema.properties.scenarios || Object.keys(schema.properties).join(',')!=='summary' || !prompt.includes('if (c)')
      || prompt.includes('selectedRoutes') || prompt.includes('sourceAlternative')) process.exit(2);
    fs.appendFileSync(path.join(__dirname,'requests'),'1');
    process.stdout.write(JSON.stringify({summary:'세 부울 조건에 따라 지역 값에 1·2·4를 누적하고 반환합니다.'}));`, { mode: 0o700 });
  const provider = createLocalFunctionNarrativeProvider({ binaryPath, modelPath, taskManager: manager });
  try {
    while (!session.complete) await session.analyzeNext(provider, "ko", new AbortController().signal, { reselectModel: false });
    assert.equal(session.pageCount, 8); assert.equal(await readFile(join(directory, "requests"), "utf8"), "1");
    let nodes = 0;
    for (const page of pages.values()) for (const scenario of page.scenarios) {
      const inputs = Object.fromEntries(scenario.example!.inputs.map(input => [input.name, JSON.parse(input.json)]));
      const expected = (inputs.a ? 1 : 0) + (inputs.b ? 2 : 0) + (inputs.c ? 4 : 0);
      assert.equal(JSON.parse(scenario.example!.result), expected);
      assert.match(scenario.explanation!, /입력은/u); assert.match(scenario.explanation!, /return adjusted/u);
      assert.match(scenario.analysis!.alternative, /다른 예시/u);
      for (const node of scenario.nodeDetails!) if (node.code) assert.ok(node.syntax && node.text && node.reason && node.effect);
      nodes += scenario.nodeDetails!.length;
    }
    assert.equal(nodes, 68); await session.readPage(0); await session.readPage(7);
    assert.equal(await readFile(join(directory, "requests"), "utf8"), "1");
  } finally { await session.dispose(); await manager.dispose(); await rm(directory, { recursive: true, force: true }); }
});
