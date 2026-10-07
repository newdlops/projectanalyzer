/** Whole-function source synthesis tests preserve causal detail, correct alternatives and one on-demand model purpose. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { buildFunctionNarrativeContext, bindFunctionNarrativeGraph, buildPrimitiveNarrativeSynthesis,
  selectPrimitiveNarrativeAlternative, buildPrimitiveWorksheetResponse, buildFunctionNarrativeLoopPurpose, buildFunctionNarrativeSourcePurpose, parseFunctionNarrative,
  initializeFunctionNarrativeNodes, createFunctionNarrativeNodeTask, appendFunctionNarrativeNodes,
  createFunctionNarrativeSummaryTask, FunctionNarrativeScenarioRun, hasCompletePrimitiveWorksheet,
  hasCompleteSourceWorksheet, getPrimitiveWorksheetAnalysis } from "../../application/functionNarratives";
import { createLocalFunctionNarrativeProvider } from "../../llm/functionNarratives";
import { FunctionNarrativeScenarioSession } from "../../webview/codeFlow/functionNarrativeScenarioSession";
import { ModelTaskManager } from "../../shared/modelTasks";
import { hasSimplePrimitiveScopes } from "../../application/functionNarratives/primitiveWorksheet/scope";
import { tracePrimitiveRoute } from "../../application/functionNarratives/primitiveWorksheet/trace";
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
  const response = buildPrimitiveWorksheetResponse(preparation, language);
  assert.ok(response, JSON.stringify({ language, source: original.snippets[0].text, path }));
  const scenario = parseFunctionNarrative(response, preparation, language).scenarios[0];
  initializeFunctionNarrativeNodes(path, scenario, "rich");
  let task;
  while ((task = createFunctionNarrativeNodeTask(batch, path, scenario))) {
    const nodes = buildPrimitiveWorksheetResponse(task, language);
    assert.ok(nodes, JSON.stringify({ language, source: original.snippets[0].text, task: task.nodeTask }));
    appendFunctionNarrativeNodes(task, scenario, parseFunctionNarrative(nodes, task, language).scenarios[0]);
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
  const purpose = buildFunctionNarrativeSourcePurpose(original, task, "en"); assert.ok(purpose);
  for (const code of ["amount + 5", "adjusted -= 2", "adjusted *= 3", "adjusted += 4", "(adjusted - 1) * 2"]) assert.ok(purpose.includes(code));
});

test("whole straight-line purposes include every binding and numeric return without dropping defaults or inferred graph operations", () => {
  const original = fixture('fun inspect(amount: Double, count: Int): Double {\n val whole = count / 2\n val adjusted = amount + whole\n return adjusted / 2.0\n}',
    "kotlin", [{ name: "amount", type: "Double" }, { name: "count", type: "Int" }]);
  original.valueNames!.push("count", "whole");
  for (const locale of ["ko", "en"] as const) {
    const task = completed(original, locale), purpose = buildFunctionNarrativeSourcePurpose(original, task, locale); assert.ok(purpose);
    for (const code of ["count / 2", "amount + whole", "adjusted / 2.0"]) assert.ok(purpose.includes(code));
    assert.equal(buildFunctionNarrativeSourcePurpose({ ...original, limited: true }, task, locale), undefined);
    const inferred = { ...original, scenarioGraph: { ...original.scenarioGraph!, nodes: original.scenarioGraph!.nodes.map(node => ({ ...node, confidence: "inferred" as const })) } };
    assert.equal(buildFunctionNarrativeSourcePurpose(inferred, task, locale), undefined);
    const defaulted = { ...original, snippets: original.snippets.map(snippet => ({ ...snippet, text: snippet.text.replace('count: Int', 'count: Int = load()') })) };
    assert.equal(buildFunctionNarrativeSourcePurpose(defaulted, task, locale), undefined, "body-only proof cannot hide default-argument effects");
  }
});

test("whole Kotlin branch purposes preserve all routes and calculations in source order", () => {
  const original = fixture('fun inspect(amount: Int): Int {\n var adjusted = amount - 1\n if (adjusted > 8) return adjusted * 2\n if (adjusted > 0) return adjusted + 3\n return adjusted - 4\n}',
    "kotlin", [{ name: "amount", type: "Int" }]);
  for (const locale of ["ko", "en"] as const) {
    const task = completed(original, locale), purpose = buildFunctionNarrativeSourcePurpose(original, task, locale);
    if (locale === "en") { assert.equal(purpose, undefined, "long complete recipes retain the model instead of losing a route"); continue; }
    assert.ok(purpose);
    for (const code of ["amount - 1", "adjusted > 8=true", "adjusted > 8=false", "adjusted > 0=true", "adjusted > 0=false", "adjusted * 2", "adjusted + 3", "adjusted - 4"]) assert.ok(purpose.includes(code), code);
    assert.ok(purpose.indexOf("amount - 1") < purpose.indexOf("adjusted > 8"));
    const inferred = { ...original, scenarioGraph: { ...original.scenarioGraph!, nodes: original.scenarioGraph!.nodes.map(node => ({ ...node,
      next: node.next.map(edge => ({ ...edge, confidence: "inferred" as const })) })) } };
    assert.equal(buildFunctionNarrativeSourcePurpose(inferred, task, locale), undefined);
  }
});

test("an unchecked route and a larger Cartesian graph cannot be hidden by two verified examples", () => {
  for (const source of [
    'fun inspect(amount: Int): Int {\n if (amount > 10) return amount * 2\n if (amount > 0) return amount + 3\n return load(amount)\n}',
    'fun inspect(a: Boolean, b: Boolean, c: Boolean, enabled: Boolean, amount: Int): Int {\n var adjusted = amount\n if (a) { adjusted += 1 }\n if (b) { adjusted += 2 }\n if (c) { adjusted += 4 }\n if (enabled) { adjusted += 8 }\n return adjusted\n}'
  ]) {
    const original = fixture(source, "kotlin", source.includes("a: Boolean")
      ? [{ name: "a", type: "Boolean" }, { name: "b", type: "Boolean" }, { name: "c", type: "Boolean" }, { name: "enabled", type: "Boolean" }, { name: "amount", type: "Int" }]
      : [{ name: "amount", type: "Int" }]);
    const task = completed(original, "ko");
    assert.equal(buildFunctionNarrativeSourcePurpose(original, task, "ko"), undefined, source);
  }
});

test("nullable Elvis purposes retain each selected operand and declaration, distinguishing null from zero, false and an empty string", () => {
  const examples = [
    { name: "amount", type: "Int?", result: "Int", fallback: "5", value: 0 },
    { name: "label", type: "String?", result: "String", fallback: '"guest"', value: "" },
    { name: "enabled", type: "Boolean?", result: "Boolean", fallback: "true", value: false }
  ];
  for (const example of examples) for (const locale of ["ko", "en"] as const) {
    const original = fixture(`fun inspect(${example.name}: ${example.type}): ${example.result} {\n val adjusted = ${example.name} ?: ${example.fallback}\n return adjusted\n}`,
      "kotlin", [{ name: example.name, type: example.type }]);
    const task = completed(original, locale), purpose = buildFunctionNarrativeSourcePurpose(original, task, locale); assert.ok(purpose);
    for (const text of [`${example.name} != null=true`, `${example.name} != null=false`, "adjusted", example.fallback]) assert.ok(purpose.includes(text), text);
    assert.match(purpose, locale === "ko" ? /초기화/u : /Initialize/u);
    const path = task.sourceFlow!.paths[0], trace = tracePrimitiveRoute(original, path, new Map([[example.name, example.value]]), locale);
    assert.ok(trace); assert.equal(trace.result, JSON.stringify(example.value), "only null selects the fallback operand");
    const defaulted = { ...original, snippets: original.snippets.map(snippet => ({ ...snippet,
      text: snippet.text.replace(`${example.name}: ${example.type}`, `${example.name}: ${example.type} = load()`) })) };
    assert.equal(buildFunctionNarrativeSourcePurpose(defaulted, task, locale), undefined);
  }
});

test("joined branch purposes preserve both mutation arms and perform later writes before the next decision", () => {
  const original = fixture('fun inspect(a: Boolean, b: Boolean, amount: Int): Int {\n var adjusted = amount\n if (a) { adjusted += 1 } else { adjusted -= 2 }\n adjusted *= 2\n if (b) { adjusted += 3 }\n return adjusted\n}',
    "kotlin", [{ name: "a", type: "Boolean" }, { name: "b", type: "Boolean" }, { name: "amount", type: "Int" }]);
  for (const locale of ["ko", "en"] as const) {
    const task = completed(original, locale), purpose = buildFunctionNarrativeSourcePurpose(original, task, locale); assert.ok(purpose);
    for (const text of ["a=true", "a=false", "b=true", "b=false", "adjusted += 1", "adjusted -= 2", "adjusted *= 2", "adjusted += 3"]) assert.ok(purpose.includes(text), text);
    assert.equal(purpose.match(/adjusted \*= 2/gu)?.length, 1, "the shared write must appear once after either arm");
    assert.ok(purpose.indexOf("adjusted -= 2") < purpose.indexOf("adjusted *= 2"));
    assert.ok(purpose.indexOf("adjusted *= 2") < purpose.indexOf("b=true"));
  }
});

test("nullable parameters without a checked Elvis declaration retain model purpose rather than claiming a type proof", () => {
  const original = fixture('fun inspect(enabled: Boolean?): Int {\n if (enabled) return 1\n return 0\n}', "kotlin", [{ name: "enabled", type: "Boolean?" }]);
  const task = completed(original, "en");
  assert.equal(buildFunctionNarrativeSourcePurpose(original, task, "en"), undefined);
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

test("unexecuted primitive-argument calls retain every calculation and explicitly conditional results, never a pure proof", () => {
  for (const language of ["kotlin", "typescript"] as const) for (const locale of ["ko", "en"] as const) {
    const original = fixture(language === "kotlin"
      ? 'fun inspect(amount: Int): Int {\n var adjusted = amount + 5\n adjusted -= 2\n adjusted *= 3\n adjusted += 4\n audit(adjusted)\n return adjusted\n}'
      : 'function inspect(amount: number): number {\n let adjusted = amount + 5;\n adjusted -= 2;\n adjusted *= 3;\n adjusted += 4;\n audit(adjusted);\n return adjusted;\n}',
      language, [{ name: "amount", type: language === "kotlin" ? "Int" : "number" }]);
    const task = completed(original, locale), reading = buildPrimitiveNarrativeSynthesis(task, locale); assert.ok(reading);
    assert.equal(hasCompleteSourceWorksheet(task), true); assert.equal(hasCompletePrimitiveWorksheet(task), false);
    assert.equal(getPrimitiveWorksheetAnalysis(task, locale), undefined); assert.equal(buildFunctionNarrativeLoopPurpose(original, task, locale), undefined);
    const purpose = buildFunctionNarrativeSourcePurpose(original, task, locale); assert.ok(purpose);
    for (const text of ["amount + 5", "adjusted -= 2", "adjusted *= 3", "adjusted += 4", "audit(adjusted)"]) assert.ok(purpose.includes(text));
    assert.match(purpose, locale === "ko" ? /정상 복귀.*미확인/u : /normally.*unknown/u);
    assert.doesNotMatch(purpose, /금액|점수|money|logging|storage/u);
    assert.equal(buildFunctionNarrativeSourcePurpose({ ...original, limited: true }, task, locale), undefined);
    assert.equal(reading.scenarios[0].example!.result, "43");
    assert.ok(reading.scenarios[0].assumptions.length); assert.ok(reading.limitations.length);
    assert.match(reading.scenarios[0].analysis!.alternative, /amount=0/u);
    assert.match(reading.scenarios[0].analysis!.alternative, /13/u);
    assert.match(reading.scenarios[0].analysis!.alternative, locale === "ko" ? /정상 복귀.*미확인/u : /normally.*unknown/u);
    const call = task.summaryTask!.completed.find(step => step.code.startsWith("audit("))!;
    assert.equal(call.values![0].after, locale === "ko" ? "미확인" : "unknown");
    if (locale === "ko") assert.match(reading.scenarios[0].explanation!, /43을 인수로 전달해 audit를 호출/u);
    assert.match(reading.scenarios[0].explanation!, /43 = 43/u);
    const unknownChanged = structuredClone(task); unknownChanged.summaryTask!.completed.find(step => step.code.startsWith("audit("))!.values![0].after = "true";
    assert.equal(buildPrimitiveNarrativeSynthesis(unknownChanged, locale), undefined, "a guessed call result cannot become source evidence");
    assert.doesNotThrow(() => parseFunctionNarrative(JSON.stringify({ ...reading, summary: locale === "ko" ? "계산한 입력을 audit에 전달하고 정상 복귀와 지역 값 유지 가정에서 반환합니다." : "Pass the calculated input to audit; return it assuming normal completion with locals preserved." }), task, locale));
  }
});

test("values and predicates after opaque calls retain their assumptions in the focused node as well as the whole paragraph", () => {
  const original = fixture('function inspect(amount: number): number {\n let adjusted = amount + 5;\n audit(adjusted);\n adjusted += 2;\n if (adjusted > 10) return adjusted * 2;\n return adjusted;\n}',
    "typescript", [{ name: "amount", type: "number" }]);
  for (const locale of ["ko", "en"] as const) {
    const task = completed(original, locale), reading = buildPrimitiveNarrativeSynthesis(task, locale); assert.ok(reading);
    assert.equal(buildFunctionNarrativeSourcePurpose(original, task, locale), undefined, "work after a call must not be reordered into the whole-purpose recipe");
    assert.equal(reading.scenarios[0].example!.result, "34");
    const path = task.sourceFlow!.paths[0], targets = path.steps.filter(step => step.code.startsWith("adjusted +=") || step.kind === "condition");
    const focused = { ...task, summaryTask: undefined, nodeTask: { frame: { when: [], outcome: locale === "ko" ? "소스 경로" : "source route" },
      example: { inputs: task.summaryTask!.inputs, result: task.summaryTask!.resultJson! }, targets,
      reading: { explanation: locale === "ko" ? "소스 순서의 구문 해설입니다." : "Ordered source reading", priorState: [] } } };
    const response = buildPrimitiveWorksheetResponse(focused, locale); assert.ok(response);
    const steps = parseFunctionNarrative(response, focused, locale).scenarios[0].steps;
    assert.equal(steps.length, 2);
    for (const step of steps) {
      assert.match(step.reason!, locale === "ko" ? /가정/u : /Assume/u);
      assert.match(step.text, locale === "ko" ? /정상 복귀.*지역 값/u : /return normally.*preserve locals/u);
    }
    assert.match(reading.scenarios[0].analysis!.pathReason, /17 > 10.*true/u);
    assert.match(reading.scenarios[0].explanation!, locale === "ko" ? /정상 복귀.*지역 값/u : /return normally.*preserve locals/u);
  }
});

test("standalone calls preserve quoted comma arguments and refuse unprovided values without executing a callee", () => {
  const context = fixture('function inspect(amount: number): number {\n audit("a,b", (amount + 2) * 3);\n audit();\n return amount;\n}',
    "typescript", [{ name: "amount", type: "number" }]);
  const task = completed(context, "en"), reading = buildPrimitiveNarrativeSynthesis(task, "en"); assert.ok(reading);
  assert.equal(reading.scenarios[0].example!.result, "10");
  assert.match(reading.scenarios[0].explanation!, /"a,b".*36/u);
  assert.match(reading.scenarios[0].explanation!, /no arguments/u);
  assert.match(reading.scenarios[0].analysis!.alternative, /unknown/u);
  for (const expression of ['missing', 'load(amount)', '...values']) {
    const original = fixture('function inspect(amount: number): number {\n audit(' + expression + ');\n return amount;\n}', "typescript", [{ name: "amount", type: "number" }]);
    const batch = new FunctionNarrativeScenarioRun(original).nextBatch()!;
    assert.equal(buildPrimitiveWorksheetResponse({ ...batch, nodePreparation: true }, "en"), undefined, expression);
  }
});

test("direct eval, receivers, assigned or nonprimitive call results, closures, loops and known non-functions retain model work", () => {
  for (const body of [
    'let adjusted = amount; eval("adjusted = 99"); return adjusted;',
    'let adjusted = amount; service.audit(adjusted); return adjusted;',
    'let adjusted = load(amount); return adjusted;',
    'let adjusted = amount; audit({ value: adjusted }); return adjusted;',
    'let adjusted = amount; audit(() => adjusted++); return adjusted;',
    'let adjusted = amount; function inner() { adjusted++; } audit(adjusted); return adjusted;',
    'let adjusted = amount; while (adjusted < 3) { audit(adjusted); adjusted += 1; } return adjusted;',
    'let adjusted = amount; const audit = 1; audit(adjusted); return adjusted;'
  ]) {
    const context = fixture('function inspect(amount: number): number {\n ' + body + '\n}', "typescript", [{ name: "amount", type: "number" }]);
    const batch = new FunctionNarrativeScenarioRun(context).nextBatch()!;
    assert.equal(buildPrimitiveWorksheetResponse({ ...batch, nodePreparation: true }, "en"), undefined, body);
  }
});

test("an early-return case keeps its own pure calculation while the alternate external call stays conditional", () => {
  const original = fixture('fun inspect(enabled: Boolean, amount: Int): Int {\n if (!enabled) return 0\n val adjusted = amount + 5\n audit(adjusted)\n return adjusted\n}',
    "kotlin", [{ name: "enabled", type: "Boolean" }, { name: "amount", type: "Int" }]);
  const task = completed(original, "ko"), reading = buildPrimitiveNarrativeSynthesis(task, "ko"); assert.ok(reading);
  assert.equal(hasCompletePrimitiveWorksheet(task), true); assert.deepEqual(reading.scenarios[0].assumptions, []);
  assert.doesNotMatch(reading.scenarios[0].explanation!, /audit/u);
  assert.match(reading.scenarios[0].analysis!.alternative, /audit.*정상 복귀.*미확인/u);
  assert.ok(reading.limitations.length);
});

test("the real local provider requests only one purpose for conditional-call scenarios and retains unknowns on cached pages", async () => {
  const original = fixture('function inspect(enabled: boolean, amount: number): number {\n if (!enabled) return 0;\n let adjusted = amount + 5;\n audit(adjusted);\n return adjusted;\n}',
    "typescript", [{ name: "enabled", type: "boolean" }, { name: "amount", type: "number" }]);
  const directory = await mkdtemp(join(tmpdir(), "call-purpose-")), modelPath = join(directory, "fixture.gguf"), binaryPath = join(directory, "runner");
  const manager = new ModelTaskManager(), pages = new Map<number, FunctionNarrative>();
  const session = new FunctionNarrativeScenarioSession(original, { async write(index, narrative) { pages.set(index, narrative); },
    async read(index) { return pages.get(index); }, async dispose() { pages.clear(); } });
  await writeFile(modelPath, "GGUF fixture");
  await writeFile(binaryPath, `#!${process.execPath}\nconst fs=require('node:fs'); const path=require('node:path'); const args=process.argv.slice(2);
    const schema=JSON.parse(fs.readFileSync(args[args.indexOf('--json-schema-file')+1],'utf8'));
    const prompt=fs.readFileSync(args[args.indexOf('--file')+1],'utf8');
    if(schema.properties.scenarios || Object.keys(schema.properties).join(',')!=='summary' || !prompt.includes('audit(adjusted)')
      || !prompt.includes('내부 동작') || prompt.includes('sourceAlternative')) process.exit(2);
    fs.appendFileSync(path.join(__dirname,'requests'),'1');
    process.stdout.write(JSON.stringify({summary:'비활성 입력은 0을 반환하고, 활성 입력은 계산한 값을 audit에 전달한 뒤 정상 복귀와 지역 값 유지 가정에서 반환합니다.'}));`, { mode: 0o700 });
  const provider = createLocalFunctionNarrativeProvider({ binaryPath, modelPath, taskManager: manager });
  try {
    while (!session.complete) await session.analyzeNext(provider, "ko", new AbortController().signal, { reselectModel: false });
    assert.equal(session.pageCount, 2); assert.equal(await readFile(join(directory, "requests"), "utf8"), "1");
    const called = pages.get(1)!.scenarios[0]; assert.equal(called.example!.result, "15");
    assert.ok(called.assumptions.length); assert.ok(pages.get(1)!.limitations.length);
    const call = called.nodeDetails!.find(step => step.code?.startsWith("audit("))!;
    assert.equal(call.values![0].after, "미확인"); assert.match(call.effect!, /미확인/u);
    assert.match(called.nodeDetails!.find(step => step.code === "return adjusted;")!.reason!, /가정/u);
    assert.match(called.nodeDetails!.find(step => step.code === "return adjusted;")!.text, /정상 복귀/u);
    assert.match(called.nodeDetails!.at(-1)!.text, /정상 복귀/u, "structural exit notes inherit the terminal's conditional effect");
    await session.readPage(1); assert.equal(await readFile(join(directory, "requests"), "utf8"), "1");
  } finally { await session.dispose(); await manager.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("a whole straight-line call recipe completes with no model installation while keeping every external uncertainty", async () => {
  const original = fixture('fun inspect(amount: Int): Int {\n var adjusted = amount + 5\n adjusted -= 2\n adjusted *= 3\n adjusted += 4\n audit(adjusted)\n return adjusted\n}',
    "kotlin", [{ name: "amount", type: "Int" }]);
  const manager = new ModelTaskManager(), pages = new Map<number, FunctionNarrative>();
  const session = new FunctionNarrativeScenarioSession(original, { async write(index, narrative) { pages.set(index, narrative); },
    async read(index) { return pages.get(index); }, async dispose() { pages.clear(); } });
  let inference = 0;
  const provider = createLocalFunctionNarrativeProvider({ binaryPath: "/missing-call-runner", modelPath: "/missing-call-model.gguf", taskManager: manager,
    onMetrics() { inference++; } });
  try {
    await session.analyzeNext(provider, "ko", new AbortController().signal, { reselectModel: false });
    assert.equal(session.complete, true); assert.equal(inference, 0);
    const page = await session.readPage(0); assert.equal(page!.modelName, "소스 분석");
    assert.match(page!.narrative.summary, /정상 복귀.*미확인/u);
    assert.equal(page!.narrative.scenarios[0].example!.result, "43");
    assert.equal(page!.narrative.scenarios[0].nodeDetails!.length, 8);
    assert.ok(page!.narrative.limitations.length); assert.ok(page!.narrative.scenarios[0].assumptions.length);
  } finally { await session.dispose(); await manager.dispose(); }
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

test("Kotlin and TypeScript primitive loops retain both current-value checks, the body write and the independently checked exit", () => {
  for (const language of ["kotlin", "typescript"] as const) {
    for (const postTest of [false, true]) {
    const body = postTest ? 'do {\n adjusted += 1\n } while (adjusted < 3)' : 'while (adjusted < 3) {\n adjusted += 1\n }';
    const source = language === "kotlin" ? 'fun inspect(amount: Int): Int {\n var adjusted = amount\n ' + body + '\n return adjusted\n}'
      : 'function inspect(amount: number): number {\n let adjusted = amount;\n ' + body.replace('adjusted += 1', 'adjusted += 1;') + '\n return adjusted;\n}';
    const original = fixture(source, language, [{ name: "amount", type: language === "kotlin" ? "Int" : "number" }]);
    for (const locale of ["ko", "en"] as const) {
      const task = completed(original, locale), reading = buildPrimitiveNarrativeSynthesis(task, locale); assert.ok(reading);
      assert.equal(reading.scenarios[0].example!.inputs[0].json, postTest ? "1" : "2"); assert.equal(reading.scenarios[0].example!.result, "3");
      assert.deepEqual(task.summaryTask!.completed.filter(step => step.code === "adjusted < 3").map(step => step.values![0].after), ["true", "false"]);
      assert.match(reading.scenarios[0].analysis!.pathReason, /true.*false/u);
      assert.match(reading.scenarios[0].analysis!.alternative, /adjusted < 3=false/u);
      const writes = task.summaryTask!.completed.filter(step => step.code.startsWith("adjusted +="));
      assert.deepEqual(writes.map(step => step.values![0].after), postTest ? ["2", "3"] : ["3"]);
      const purpose = buildFunctionNarrativeLoopPurpose(original, task, locale); assert.ok(purpose);
      assert.match(purpose, /adjusted < 3/u); assert.match(purpose, /adjusted \+= 1/u);
      assert.match(purpose, locale === "ko" ? /참인 동안/u : /while adjusted < 3 is true/u);
      if (postTest) assert.match(purpose, locale === "ko" ? /먼저 한 번/u : /once before the first test/u);
      assert.doesNotMatch(purpose, /금액|점수|until true/u);
      const missing = { ...original, limited: true };
      assert.equal(buildFunctionNarrativeLoopPurpose(missing, task, locale), undefined);
    }
    }
  }
});

test("whole-loop purposes refuse extra branches and post-loop calculations instead of dropping their meaning", () => {
  const source = 'function inspect(amount: number): number {\n let adjusted = amount;\n while (adjusted < 3) { adjusted += 1; }\n return adjusted * 2;\n}';
  const original = fixture(source, "typescript", [{ name: "amount", type: "number" }]);
  const task = completed(original, "en");
  assert.equal(buildFunctionNarrativeLoopPurpose(original, task, "en"), undefined);
});

test("a complete loop recipe publishes both detailed pages without model files, runners or inference", async () => {
  const original = fixture('function inspect(amount: number): number {\n let adjusted = amount;\n do { adjusted += 1; } while (adjusted < 3);\n return adjusted;\n}',
    "typescript", [{ name: "amount", type: "number" }]);
  const pages = new Map<number, FunctionNarrative>(), manager = new ModelTaskManager();
  let modelRequests = 0;
  const provider = createLocalFunctionNarrativeProvider({ binaryPath: "/missing-loop-runner", modelPath: "/missing-loop-model.gguf",
    taskManager: manager, onMetrics() { modelRequests++; } });
  const session = new FunctionNarrativeScenarioSession(original, { async write(index, page) { pages.set(index, page); },
    async read(index) { return pages.get(index); }, async dispose() { pages.clear(); } });
  try {
    while (!session.complete) await session.analyzeNext(provider, "en", new AbortController().signal, { reselectModel: false });
    assert.equal(modelRequests, 0); assert.equal(session.pageCount, 2);
    assert.deepEqual([...pages.values()].flatMap(page => page.scenarios.map(scenario => scenario.example!.result)), ["3", "11"]);
    for (const page of pages.values()) {
      assert.match(page.summary, /once before the first test/u);
      assert.ok(page.scenarios[0].nodeDetails!.filter(step => step.code).every(step => step.syntax && step.text && step.reason && step.effect));
    }
    const cached = await session.readPage(1); assert.equal(cached!.modelName, "Source analysis"); assert.equal(modelRequests, 0);
  } finally { await session.dispose(); await manager.dispose(); }
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

test("all eight detailed paths preserve shared control and cache navigation without a model or runner", async () => {
  const original = fixture('function inspect(a: boolean, b: boolean, c: boolean): number {\n let adjusted = 0;\n if (a) adjusted += 1;\n if (b) adjusted += 2;\n if (c) adjusted += 4;\n return adjusted;\n}',
    "typescript", ["a", "b", "c"].map(name => ({ name, type: "boolean" })));
  const manager = new ModelTaskManager(), pages = new Map<number, FunctionNarrative>();
  const session = new FunctionNarrativeScenarioSession(original, { async write(index, narrative) { pages.set(index, narrative); },
    async read(index) { return pages.get(index); }, async dispose() { pages.clear(); } });
  let requests = 0;
  const provider = createLocalFunctionNarrativeProvider({ binaryPath: "/missing/serial-branch-runner", modelPath: "/missing/serial-branch-model.gguf",
    taskManager: manager, onMetrics() { requests++; } });
  try {
    while (!session.complete) await session.analyzeNext(provider, "ko", new AbortController().signal, { reselectModel: false });
    assert.equal(session.pageCount, 8); assert.equal(requests, 0);
    let nodes = 0;
    for (const page of pages.values()) for (const scenario of page.scenarios) {
      const inputs = Object.fromEntries(scenario.example!.inputs.map(input => [input.name, JSON.parse(input.json)]));
      const expected = (inputs.a ? 1 : 0) + (inputs.b ? 2 : 0) + (inputs.c ? 4 : 0);
      assert.equal(JSON.parse(scenario.example!.result), expected);
      assert.match(scenario.explanation!, /입력은/u); assert.match(scenario.explanation!, /return adjusted/u);
      assert.match(scenario.analysis!.alternative, /다른 예시/u);
      for (const name of ["a", "b", "c"]) for (const choice of ["true", "false"]) assert.ok(page.summary.includes(`${name}=${choice}`));
      for (const node of scenario.nodeDetails!) if (node.code) assert.ok(node.syntax && node.text && node.reason && node.effect);
      nodes += scenario.nodeDetails!.length;
    }
    assert.equal(nodes, 68); await session.readPage(0); await session.readPage(7);
    assert.equal(requests, 0); assert.equal((await session.readPage(7))!.modelName, "소스 분석");
  } finally { await session.dispose(); await manager.dispose(); }
});

test("unproved default setup still receives one whole-source model purpose with all branches, then reuses its producer across eight pages", async () => {
  const original = fixture('function inspect(a: boolean = unknown(), b: boolean, c: boolean): number {\n let adjusted = 0;\n if (a) adjusted += 1;\n if (b) adjusted += 2;\n if (c) adjusted += 4;\n return adjusted;\n}',
    "typescript", ["a", "b", "c"].map(name => ({ name, type: "boolean" })));
  const directory = await mkdtemp(join(tmpdir(), "source-default-purpose-")), modelPath = join(directory, "fixture.gguf"), binaryPath = join(directory, "runner");
  const manager = new ModelTaskManager(), pages = new Map<number, FunctionNarrative>();
  const session = new FunctionNarrativeScenarioSession(original, { async write(index, narrative) { pages.set(index, narrative); },
    async read(index) { return pages.get(index); }, async dispose() { pages.clear(); } });
  await writeFile(modelPath, "GGUF fixture");
  await writeFile(binaryPath, `#!${process.execPath}\nconst fs=require('node:fs'); const path=require('node:path'); const args=process.argv.slice(2);
    const schema=JSON.parse(fs.readFileSync(args[args.indexOf('--json-schema-file')+1],'utf8'));
    const prompt=fs.readFileSync(args[args.indexOf('--file')+1],'utf8');
    if(Object.keys(schema.properties).join(',')!=='summary' || !['if (a)','if (b)','if (c)','unknown()'].every(text=>prompt.includes(text))
      || prompt.includes('selectedRoutes') || prompt.includes('sourceAlternative')) process.exit(2);
    fs.appendFileSync(path.join(__dirname,'requests'),'1');
    process.stdout.write(JSON.stringify({summary:'주어진 부울 입력에 따라 1·2·4를 누적해 반환합니다. 생략된 a의 기본값 호출 결과는 미확인입니다.'}));`, { mode: 0o700 });
  const provider = createLocalFunctionNarrativeProvider({ binaryPath, modelPath, taskManager: manager });
  try {
    while (!session.complete) await session.analyzeNext(provider, "ko", new AbortController().signal, { reselectModel: false });
    assert.equal(session.pageCount, 8); assert.equal(await readFile(join(directory, "requests"), "utf8"), "1");
    for (const page of pages.values()) for (const scenario of page.scenarios) {
      const inputs = Object.fromEntries(scenario.example!.inputs.map(input => [input.name, JSON.parse(input.json)]));
      assert.equal(JSON.parse(scenario.example!.result), (inputs.a ? 1 : 0) + (inputs.b ? 2 : 0) + (inputs.c ? 4 : 0));
      assert.match(page.summary, /기본값.*미확인/u);
    }
    assert.match((await session.readPage(7))!.modelName, /^Local/u); await session.readPage(0);
    assert.equal(await readFile(join(directory, "requests"), "utf8"), "1");
  } finally { await session.dispose(); await manager.dispose(); await rm(directory, { recursive: true, force: true }); }
});
