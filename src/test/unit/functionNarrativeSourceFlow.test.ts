/** Source-grounding regressions use real Kotlin/TypeScript adapters and bounded malformed graph cases. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { analyzeFunctionLogic, type FunctionLogicAnalysis, type FunctionLogicBlock } from "../../analyzer/functionLogic";
import { addFunctionNarrativeValueGrounding, buildFunctionNarrativeContext, buildFunctionNarrativeSourceFlow, buildFunctionNarrativeFlowGuidance, buildFunctionNarrativeScenarioFrames, parseFunctionNarrative, buildFunctionNarrativePrompt } from "../../application/functionNarratives";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";
import { buildInputModel } from "./helpers/neuralScenarioFixtures";
import { evaluateScenarioSeed } from "../../application/codeFlow/functionTutor";
import type { SymbolNode } from "../../shared/types";

/** Finds the selected fixture declaration without depending on analyzer-local identities. */
function fixture(language: "kotlin" | "typescript") {
  const name = language === "kotlin" ? "classifyOrder" : "computeTotal";
  const filePath = resolve(process.cwd(), "src/test/fixtures/functionNarratives", language === "kotlin" ? "guard.kt" : "fee.ts");
  const source = readFileSync(filePath, "utf8");
  const lines = source.trimEnd().split("\n");
  const nameColumn = lines[1].indexOf(name);
  const node: SymbolNode = { id: "private:fixture", name, qualifiedName: name, filePath, kind: "function", language,
    range: { startLine: 1, startCharacter: 0, endLine: lines.length - 1, endCharacter: 1 },
    selectionRange: { startLine: 1, startCharacter: nameColumn, endLine: 1, endCharacter: nameColumn + name.length } };
  const analysis = analyzeFunctionLogic({ functionNode: node, sourceText: source });
  return { node, source, analysis, context: buildFunctionNarrativeContext(node, source, [], analysis) };
}

test("Kotlin grounding snapshots three guard routes and never continues after their first return", () => {
  const { context } = fixture("kotlin");
  assert.equal(context.sourceFlow?.basis, "source-control-flow");
  assert.deepEqual(context.sourceFlow?.paths.map((path) => ({ status: path.status, steps: path.steps.map((step) => [step.code, step.branch?.outcome ?? "", step.source.startLine]) })), [
    { status: "source-terminal", steps: [["!enabled", "true", 3], ['return "disabled"', "", 3]] },
    { status: "source-terminal", steps: [["!enabled", "false", 3], ["amount > 100", "true", 4], ['return "priority"', "", 4]] },
    { status: "source-terminal", steps: [["!enabled", "false", 3], ["amount > 100", "false", 4], ['return "ordinary"', "", 5]] }
  ]);
  // Kotlin retains its language-support gap: route syntax does not prove input feasibility.
  assert.equal(context.sourceFlow?.limited, true);
  assert.equal(context.limited, false, "symbolic support is not an omitted source excerpt");
  assert.ok(!JSON.stringify(context).includes("private:fixture"));
  assert.ok(!JSON.stringify(context).includes("logic-block:"));
  assert.ok(!JSON.stringify(context).includes("src/test/fixtures"));
});

test("TypeScript routes retain the fixed fee branches and omit later calculations on the disabled route", () => {
  const { context } = fixture("typescript");
  const paths = context.sourceFlow!.paths;
  assert.equal(paths.length, 3);
  assert.deepEqual(paths.map((path) => path.steps.filter((step) => step.branch).map((step) => [step.code, step.branch!.outcome])), [
    [["!enabled", "true"]], [["!enabled", "false"], ["base > 100", "true"]], [["!enabled", "false"], ["base > 100", "false"]]
  ]);
  assert.equal(paths[0].steps.at(-1)?.code, "return 0;");
  assert.ok(!paths[0].steps.some((step) => step.code.includes("fee")));
  assert.ok(paths[1].steps.some((step) => step.code === "5"));
  assert.ok(paths[2].steps.some((step) => step.code === "0"));
  for (const path of paths.slice(1)) {
    assert.ok(path.steps.some((step) => step.code === "const total = base + fee;"));
    assert.equal(path.steps.at(-1)?.code, "return total;");
  }
  assert.ok(JSON.stringify(context.sourceFlow).length <= 4000);
});

test("grounding preserves inferred ordinary edges and deduplicates duplicate source transfers", () => {
  const { node, source, analysis } = fixture("kotlin");
  const edges = [{ ...analysis.edges[0], confidence: "inferred" as const }, ...analysis.edges.slice(1), analysis.edges[0]];
  const context = buildFunctionNarrativeContext(node, source, [], { ...analysis, edges });
  assert.equal(context.sourceFlow?.paths.length, 3);
  assert.ok(context.sourceFlow?.paths.every((path) => path.confidence === "inferred"));
});

test("cycle, missing block, depth and deferred relations keep only bounded known prefixes", () => {
  const { node, source, analysis, context } = fixture("kotlin");
  const [entry, condition] = analysis.blocks;
  for (const [target, expected] of [[condition.id, "cycle"], ["unresolved", "missing-block"]] as const) {
    const malformed: FunctionLogicAnalysis = { ...analysis, blocks: [entry, condition], edges: [analysis.edges[0],
      { id: "bad", sourceId: condition.id, targetId: target, kind: "next", confidence: "inferred" }] };
    const flow = buildFunctionNarrativeSourceFlow(malformed, source, context);
    assert.equal(flow.paths[0].reason, expected);
    assert.equal(flow.paths[0].status, "partial");
    assert.equal(flow.limited, true);
    assert.equal(flow.paths[0].steps.length, 1);
  }
  const shallow = buildFunctionNarrativeSourceFlow(analysis, source, context, { maxDepth: 2 });
  assert.ok(shallow.paths.every((path) => path.status === "partial" && path.reason === "depth-limit"));
  const deferred: FunctionLogicBlock = { ...analysis.blocks[2], id: "callback", kind: "callable" };
  const withCallback = { ...analysis, blocks: [...analysis.blocks, deferred], edges: [...analysis.edges,
    { id: "deferred", sourceId: entry.id, targetId: deferred.id, kind: "deferred" as const, confidence: "exact" as const }] };
  assert.deepEqual(buildFunctionNarrativeSourceFlow(withCallback, source, context), context.sourceFlow);
  assert.equal(buildFunctionNarrativeContext(node, source).sourceFlow, undefined);
});

test("source and output budgets never attach invisible suffixes or a terminal beyond a missing statement", () => {
  const { source, analysis, context } = fixture("typescript");
  const firstOnly = { ...context, snippets: context.snippets.filter((snippet) => snippet.role === "function")
    .map((snippet) => ({ ...snippet, endLine: 3, text: snippet.text.split("\n").slice(0, 2).join("\n"), truncated: true })) };
  const missing = buildFunctionNarrativeSourceFlow(analysis, source, firstOnly);
  assert.equal(missing.paths[0].reason, "missing-source");
  assert.equal(missing.paths[0].status, "partial");
  assert.ok(!missing.paths[0].steps.some((step) => step.kind === "return"));
  const clipped = { ...context, snippets: context.snippets.map((snippet) => snippet.id === "root"
    ? { ...snippet, text: snippet.text.split("\n").slice(0, 1).concat("  const ba").join("\n"), endLine: 3, truncated: true } : snippet) };
  const clippedFlow = buildFunctionNarrativeSourceFlow(analysis, source, clipped);
  assert.equal(clippedFlow.paths.length, 0);
  assert.equal(clippedFlow.limited, true);
  const bounded = buildFunctionNarrativeSourceFlow(analysis, source, context, { maxCharacters: 1000, maxPaths: 1 });
  assert.ok(JSON.stringify(bounded).length <= 1000);
  assert.ok(bounded.paths.length <= 1);
  assert.equal(bounded.limited, true);
  const inlineSource = "export function inspect(flag: boolean) { if (flag) return 1; if (flag) return 2; return 3; }";
  const inlineNode: SymbolNode = { ...analysis.functionNode, name: "inspect", qualifiedName: "inspect",
    range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: inlineSource.length },
    selectionRange: { startLine: 0, startCharacter: 16, endLine: 0, endCharacter: 23 } };
  const inlineLogic = analyzeFunctionLogic({ functionNode: inlineNode, sourceText: inlineSource });
  const inlineContext = buildFunctionNarrativeContext(inlineNode, inlineSource);
  const cut = inlineSource.indexOf("if (flag)", inlineSource.indexOf("if (flag)") + 1);
  inlineContext.snippets[0] = { ...inlineContext.snippets[0], text: inlineSource.slice(0, cut), truncated: true };
  const inlineFlow = buildFunctionNarrativeSourceFlow(inlineLogic, inlineSource, inlineContext);
  assert.ok(inlineFlow.paths.length > 0);
  assert.ok(inlineFlow.paths.every((path) => path.steps.filter((step) => step.kind === "condition").length <= 1),
    "an identical visible predicate does not authorize its hidden second occurrence");
});

test("value grounding preserves literal branch choices and addition without evaluating external calls", async () => {
  const { source } = fixture("typescript");
  const model = await buildInputModel(source.replace("computeTotal", "inspect"));
  const context = buildFunctionNarrativeContext(model.declaration.functionNode, source.replace("computeTotal", "inspect"), [], model.functionLogic);
  const grounded = addFunctionNarrativeValueGrounding(context, model);
  assert.deepEqual(grounded.valueFacts?.map((fact) => [fact.target, fact.operation, fact.operands]), [
    ["fee", "conditional", ["base > 100", "5", "0"]], ["total", "add", ["base", "fee"]]
  ]);
  assert.equal(grounded.checkedExamples, undefined, "Math.max is unsupported; no input result is invented");
  const guidance = buildFunctionNarrativeFlowGuidance(grounded, "ko");
  assert.ok(guidance.includes("fee = base > 100가 true이면 값 5, false이면 값 0 선택"));
  assert.ok(guidance.includes("total = + 연산(base, fee)"));
  assert.ok(!guidance.includes("logic-block:"));
  assert.equal(context.valueFacts, undefined, "the cached input context is immutable");
  assert.deepEqual(buildFunctionNarrativeScenarioFrames(grounded).map((frame) => frame.when[0]), ["enabled = false", "enabled = true", "enabled = true"]);
  assert.ok(JSON.stringify(grounded.sourceFlow).length <= 4000);
});

test("completed input checks share exact primitive cases and stop before unsupported or symbolic computation", async () => {
  const source = 'export function inspect(amount: number, enabled: boolean) {\n if (!enabled) return 0;\n if (amount > 100) return amount + 5;\n return amount;\n}';
  const model = await buildInputModel(source);
  const context = buildFunctionNarrativeContext(model.declaration.functionNode, source, [], model.functionLogic);
  const grounded = addFunctionNarrativeValueGrounding(context, model);
  assert.ok(grounded.checkedExamples?.length);
  assert.ok(grounded.checkedExamples!.every((example) => example.basis === "static-evaluation"));
  const numeric = grounded.checkedExamples!.find((example) => example.inputs.some((input) => input.name === "amount" && input.value === "101")
    && example.inputs.some((input) => input.name === "enabled" && input.value === "true"));
  assert.equal(numeric?.terminal.value, "106");
  assert.ok(!JSON.stringify(grounded).includes("tutor-parameter:"));
  const partialModel = { ...model, seeds: model.seeds.map((seed) => ({ ...seed,
    quality: { ...seed.quality!, evaluation: { ...seed.quality!.evaluation, status: "partial" as const } } })) };
  assert.equal(addFunctionNarrativeValueGrounding(context, partialModel).checkedExamples, undefined);
  const symbolicModel = { ...model, declaration: { ...model.declaration, program: { ...model.declaration.program, evaluationMode: "symbolic-only" as const } } };
  assert.equal(addFunctionNarrativeValueGrounding(context, symbolicModel).checkedExamples, undefined);
  const inferredModel = { ...model, functionLogic: { ...model.functionLogic, edges: model.functionLogic.edges.map((edge) => ({ ...edge, confidence: "inferred" as const })) } };
  assert.equal(addFunctionNarrativeValueGrounding(context, inferredModel).checkedExamples, undefined);
  const calculationSource = 'export function inspect(amount: number) {\n const total = amount + 5;\n return total;\n}';
  const calculationModel = await buildInputModel(calculationSource);
  const calculationContext = buildFunctionNarrativeContext(calculationModel.declaration.functionNode, calculationSource, [], calculationModel.functionLogic);
  assert.ok(addFunctionNarrativeValueGrounding(calculationContext, calculationModel).checkedExamples?.length);
  const onlyTerminal = { ...calculationContext, snippets: [{ ...calculationContext.snippets[0],
    startLine: 3, endLine: 3, text: calculationSource.split("\n")[2] }] };
  assert.equal(addFunctionNarrativeValueGrounding(onlyTerminal, calculationModel).checkedExamples, undefined,
    "a visible terminal cannot authorize a result calculated by an omitted statement");
});

test("optional, nullable and aliased Boolean predicates retain source choices without equating nullish inputs to false", async () => {
  for (const parameter of ["enabled?: boolean", "enabled: boolean | null", "enabled: boolean | undefined", "enabled: Flag"]) {
    const source = `type Flag = boolean | null;\nexport function inspect(${parameter}) {\n if (!enabled) return 0;\n return 1;\n}`;
    const model = await buildInputModel(source);
    const context = buildFunctionNarrativeContext(model.declaration.functionNode, source, [], model.functionLogic);
    const grounded = addFunctionNarrativeValueGrounding(context, { ...model, seeds: [] });
    assert.ok(grounded.sourceFlow?.paths.every((path) => path.steps.every((step) => !step.branch?.inputCondition)), parameter);
    assert.deepEqual(buildFunctionNarrativeScenarioFrames(grounded).map((frame) => frame.when), [["!enabled => true"], ["!enabled => false"]]);
  }
});

test("grounding excludes deferred writes, foreign caller values and omitted or oversized context", async () => {
  const source = 'export function inspect(amount: number) {\n const task = () => { const nested = amount + 5; return nested; };\n return amount;\n}';
  const model = await buildInputModel(source);
  const context = buildFunctionNarrativeContext(model.declaration.functionNode, source, [], model.functionLogic);
  assert.ok(!addFunctionNarrativeValueGrounding(context, model).valueFacts?.some((fact) => fact.target === "nested"));
  const onlyCallers = { ...model, seeds: model.seeds.map((seed) => ({ ...seed, source: "callsite" as const })) };
  assert.equal(addFunctionNarrativeValueGrounding(context, onlyCallers).checkedExamples, undefined);
  assert.equal(addFunctionNarrativeValueGrounding({ ...context, snippets: [] }, model).checkedExamples, undefined);
  const budgetSource = 'export function inspect(amount: number) {\n return amount;\n}';
  const budgetModel = await buildInputModel(budgetSource);
  const budgetContext = buildFunctionNarrativeContext(budgetModel.declaration.functionNode, budgetSource, [], budgetModel.functionLogic);
  // Every distinct fixture input is checked by the real evaluator, not attached
  // to a terminal value from an unrelated baseline input.
  const many = { ...budgetModel, seeds: Array.from({ length: 100 }, (_, i) => evaluateScenarioSeed(budgetModel.declaration, {
    ...budgetModel.seeds[0], inputs: budgetModel.seeds[0].inputs.map((input) => ({ ...input, value: { kind: "number" as const, value: i } })) })) };
  const bounded = addFunctionNarrativeValueGrounding(budgetContext, many);
  assert.ok((bounded.checkedExamples?.length ?? 0) <= 3);
  assert.ok(JSON.stringify({ facts: bounded.valueFacts, examples: bounded.checkedExamples }).length <= 2100);
  assert.equal(bounded.groundingLimited, true);
  assert.equal(bounded.limited, false, "sample omission does not claim that source code was omitted");
});

test("both providers bind conditions, terminal syntax and citations to the same source route", () => {
  const { context } = fixture("kotlin");
  const frames = buildFunctionNarrativeScenarioFrames(context);
  assert.deepEqual(frames.map((frame) => [frame.when, frame.outcome]), [
    [["!enabled => true"], 'return "disabled"'],
    [["!enabled => false", "amount > 100 => true"], 'return "priority"'],
    [["!enabled => false", "amount > 100 => false"], 'return "ordinary"']
  ]);
  const narrative = { summary: "Return a source-authored order label.", scenarios: frames.map((frame, i) => ({
    title: `Route ${i + 1}`, when: frame.when, outcome: frame.outcome, assumptions: [],
    explanation: "Read the given predicate choices and return the stated source label.",
    steps: [{ text: frame.outcome, source: frame.sources.at(-1)! }]
  })), limitations: [] };
  assert.deepEqual(parseFunctionNarrative(JSON.stringify(narrative), context), narrative);
  const wrongConditions = structuredClone(narrative); wrongConditions.scenarios[0].when = ["enabled=true"];
  const wrongReturn = structuredClone(narrative); wrongReturn.scenarios[0].outcome = 'return "ordinary"';
  const wrongSource = structuredClone(narrative); wrongSource.scenarios[0].steps[0].source = { snippetId: "root", startLine: 5, endLine: 5 };
  const omitted = structuredClone(narrative); omitted.scenarios.pop();
  for (const invalid of [wrongConditions, wrongReturn, wrongSource, omitted]) {
    assert.throws(() => parseFunctionNarrative(JSON.stringify(invalid), context), { message: "invalid-response" });
  }
  const schema = createLocalNarrativeSchema(context) as any;
  assert.equal(schema.properties.scenarios.items.length, 3);
  for (const [i, slot] of schema.properties.scenarios.items.entries()) {
    assert.deepEqual(slot.properties.when.const, frames[i].when);
    assert.equal(slot.properties.outcome.const, frames[i].outcome);
    assert.deepEqual(slot.properties.steps.items.properties.source.enum, frames[i].sources);
  }
  assert.ok(buildFunctionNarrativePrompt(context, "en")[0].includes("SOURCE FRAMES"));
});

test("partial, inferred and implicit exits keep the legacy unconstrained response contract", () => {
  const { context } = fixture("kotlin");
  for (const path of [
    { ...context.sourceFlow!.paths[0], status: "partial" as const },
    { ...context.sourceFlow!.paths[0], confidence: "inferred" as const },
    { ...context.sourceFlow!.paths[0], steps: [{ ...context.sourceFlow!.paths[0].steps[0], kind: "exit", code: "exit" }] }
  ]) {
    const partial = { ...context, sourceFlow: { ...context.sourceFlow!, paths: [path] } };
    assert.deepEqual(buildFunctionNarrativeScenarioFrames(partial), []);
    const schema = createLocalNarrativeSchema(partial) as any;
    assert.equal(Array.isArray(schema.properties.scenarios.items), false);
  }
});
