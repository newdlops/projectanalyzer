/** Conservative primitive worksheets verify source calculations, route feasibility, detail and fallback boundaries. */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { bindFunctionNarrativeGraph, buildFunctionNarrativeContext, buildPrimitiveWorksheetResponse, FunctionNarrativeScenarioRun,
  parseFunctionNarrative, initializeFunctionNarrativeNodes, createFunctionNarrativeNodeTask, appendFunctionNarrativeNodes,
  createFunctionNarrativeSummaryTask, hasCompletePrimitiveWorksheet, getPrimitiveWorksheetAnalysis } from "../../application/functionNarratives";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";
import { buildLocalNarrativeInput } from "../../llm/functionNarratives/localInput";
import { readPrimitiveExpression } from "../../application/functionNarratives/primitiveWorksheet/expression";
import type { SymbolNode } from "../../shared/types";

/** Uses the production analyzer/route iterator; only the final LLM synthesis is outside these pure worksheet checks. */
function fixture(source: string, language: "kotlin" | "typescript" = "kotlin", parameters?: Array<{ name: string; type: string }>) {
  const lines = source.split("\n"), node: SymbolNode = { id: "worksheet", name: "inspect", qualifiedName: "inspect", kind: "function", language,
    filePath: "/fixture/inspect." + (language === "kotlin" ? "kt" : "ts"), range: { startLine: 0, startCharacter: 0, endLine: lines.length - 1, endCharacter: lines.at(-1)!.length },
    selectionRange: { startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 11 } };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText: source });
  const context = bindFunctionNarrativeGraph({ ...buildFunctionNarrativeContext(node, source, [], logic), detailLevel: "rich" as const,
    parameters: parameters ?? [{ name: "enabled", type: language === "kotlin" ? "Boolean" : "boolean" }, { name: "amount", type: language === "kotlin" ? "Int" : "number" }],
    valueNames: ["enabled", "amount", "label", "adjusted", "condition", "result"] }, logic.blocks.map((_, i) => "node:" + i), []);
  return new FunctionNarrativeScenarioRun(context);
}

test("primitive expression stacks preserve precedence, parentheses, unary operators and latest named values", () => {
  const state = new Map([['amount', 10], ['adjusted', 13]]);
  assert.equal(readPrimitiveExpression('(adjusted - 1) * 2 + amount', state, true)!.value, 34);
  assert.equal(readPrimitiveExpression('-amount * -2', state, true)!.value, 20);
  assert.deepEqual(readPrimitiveExpression('-amount * -2', state, true)!.operations, ['u-', '*']);
  assert.equal(readPrimitiveExpression('!(amount > 10) && adjusted >= 13', state, true)!.value, true);
  assert.equal(readPrimitiveExpression('"a" + "b"', state, true)!.value, 'ab');
  assert.deepEqual(readPrimitiveExpression('"a" + "b"', state, true)!.operations, ['s+']);
  assert.equal(readPrimitiveExpression('true', new Map([['true', 10]]), true)!.value, true);
  assert.equal(readPrimitiveExpression('"$amount"', state, true), undefined, "Kotlin interpolation is not a JSON string literal");
  assert.equal(readPrimitiveExpression('amount * 1.0', state, true), undefined, "Kotlin Double literals retain model fallback");
  assert.equal(readPrimitiveExpression('amount === adjusted', state, true), undefined, "Kotlin boxed identity is not primitive value equality");
  assert.equal(readPrimitiveExpression('-0', state, false), undefined, "JS negative zero must not silently become JSON zero");
  assert.equal(readPrimitiveExpression('-7 / 2', state, true)!.value, -3);
  assert.equal(readPrimitiveExpression('7 / -2', state, true)!.value, -3);
  assert.equal(readPrimitiveExpression('-7 % 2', state, true)!.value, -1);
  assert.equal(readPrimitiveExpression('7 / 2', state, false)!.value, 3.5);
  for (const expression of ['load()', 'amount.value', 'amount / 0', 'amount % 0', 'amount + missing', '2147483647 + 1', 'amount (2)', '(amount + 2', 'amount; 2', '1 == true']) {
    assert.equal(readPrimitiveExpression(expression, state, true), undefined, expression);
  }
});

test("Kotlin typed operands distinguish integral Double values from Int, retain mixed subexpression types and reject unsafe conversions", () => {
  const state = new Map([['amount', 7], ['count', 7]]), types = new Map<string, "Int" | "Double">([['amount', 'Double'], ['count', 'Int']]);
  assert.equal(readPrimitiveExpression('amount / 2', state, true, types)!.value, 3.5);
  assert.equal(readPrimitiveExpression('count / 2', state, true, types)!.value, 3);
  assert.equal(readPrimitiveExpression('(count / 2) + amount / 2', state, true, types)!.value, 6.5);
  assert.deepEqual(readPrimitiveExpression('(count / 2) + amount / 2', state, true, types)!.divisionKinds, ['Int', 'Double']);
  assert.equal(readPrimitiveExpression('amount * 1.0', state, true, types)!.numericKind, 'Double');
  assert.equal(readPrimitiveExpression('count * 2', state, true, types)!.numericKind, 'Int');
  assert.equal(readPrimitiveExpression('-amount / 2', state, true, types)!.value, -3.5);
  assert.equal(readPrimitiveExpression('-count / 2', state, true, types)!.value, -3);
  for (const expression of ['amount == count', 'amount / 0.0', '0.0 / -amount', '2147483647 + 1', 'amount * 1.0f', 'amount.toInt()', 'amount === amount']) {
    assert.equal(readPrimitiveExpression(expression, state, true, types), undefined, expression);
  }
  assert.equal(readPrimitiveExpression('count / 2', state, true, new Map([['amount', 'Double']])), undefined, 'numeric bindings without a static kind cannot borrow Int semantics');
});

test("Kotlin Double worksheets preserve fractional writes, Int division inside mixed expressions, precise floating results and loop exit values", () => {
  const examples = [
    { source: 'fun inspect(amount: Double): Double {\n var adjusted = amount / 2\n adjusted += 0.5\n return adjusted * 3.0\n}', parameters: [{ name: "amount", type: " Double " }], result: "16.5", fraction: true },
    { source: 'fun inspect(amount: Double, count: Int): Double {\n val whole = count / 2\n val adjusted = amount + whole\n return adjusted / 2.0\n}', parameters: [{ name: "amount", type: "Double" }, { name: "count", type: "Int" }], result: "7.5", fraction: true },
    { source: 'fun inspect(amount: Double): Double {\n var adjusted = amount\n while (adjusted < 3.0) { adjusted += 1.0 }\n return adjusted\n}', parameters: [{ name: "amount", type: "Double" }], result: "3", fraction: false }
  ];
  for (const example of examples) for (const locale of ["ko", "en"] as const) {
    const run = fixture(example.source, "kotlin", example.parameters), batch = run.nextBatch()!, preparation = { ...batch, valueNames: [...batch.valueNames!, "whole"], nodePreparation: true };
    const response = buildPrimitiveWorksheetResponse(preparation, locale); assert.ok(response, example.source);
    const path = batch.sourceFlow!.paths[0], scenario = parseFunctionNarrative(response, preparation, locale).scenarios[0];
    initializeFunctionNarrativeNodes(path, scenario, "rich");
    let task;
    while ((task = createFunctionNarrativeNodeTask(preparation, path, scenario))) {
      const reading = buildPrimitiveWorksheetResponse(task, locale); assert.ok(reading, example.source);
      appendFunctionNarrativeNodes(task, scenario, parseFunctionNarrative(reading, task, locale).scenarios[0]);
    }
    assert.equal(scenario.nodeDetails!.at(-1)!.values![0].after, example.result);
    if (example.fraction) assert.ok(scenario.nodeDetails!.some(step => /Double/u.test(step.syntax!)), "Double division must not be described as Int truncation");
    if (example.source.includes("count")) {
      const integer = scenario.nodeDetails!.find(step => step.code === "val whole = count / 2")!;
      assert.match(integer.syntax!, locale === "ko" ? /정수 나눗셈/u : /integer division/u);
    }
  }
});

test("Float rounding, nullable numeric smart casts, negative-zero and narrowing writes remain explicit model fallbacks", () => {
  for (const [source, parameters] of [
    ['fun inspect(amount: Float): Float { return amount / 2f }', [{ name: "amount", type: "Float" }]],
    ['fun inspect(amount: Double?): Double { return amount ?: 0.0 }', [{ name: "amount", type: "Double?" }]],
    ['fun inspect(amount: Double, count: Int?): Double { return amount + (count ?: 0) }', [{ name: "amount", type: "Double" }, { name: "count", type: "Int?" }]],
    ['fun inspect(amount: Double): Int { var adjusted = 1\n adjusted += amount\n return adjusted }', [{ name: "amount", type: "Double" }]],
    ['fun inspect(amount: Double): Double { var adjusted = amount\n adjusted = 2\n return adjusted }', [{ name: "amount", type: "Double" }]]
  ] as const) {
    const batch = fixture(source, "kotlin", [...parameters]).nextBatch()!;
    assert.equal(buildPrimitiveWorksheetResponse({ ...batch, nodePreparation: true }, "en"), undefined, source);
  }
});

test("Kotlin and TypeScript worksheets preserve route-selected inputs, current writes and full return expressions", () => {
  for (const language of ["kotlin", "typescript"] as const) for (const locale of ["ko", "en"] as const) {
    const source = language === "kotlin" ? 'fun inspect(enabled: Boolean, amount: Int): Int {\n if (!enabled) return 0\n var adjusted = amount + 5\n adjusted -= 2\n return adjusted * 2\n}'
      : 'function inspect(enabled: boolean, amount: number): number {\n if (!enabled) return 0;\n let adjusted = amount + 5;\n adjusted -= 2;\n return adjusted / 2;\n}';
    const run = fixture(source, language);
    let covered = 0;
    while (!run.complete) {
      const batch = run.nextBatch()!, preparation = { ...batch, nodePreparation: true };
      const text = buildPrimitiveWorksheetResponse(preparation, locale); assert.ok(text);
      const narrative = parseFunctionNarrative(text, preparation, locale);
      for (let index = 0; index < narrative.scenarios.length; index++) {
        const scenario = narrative.scenarios[index], path = batch.sourceFlow!.paths[index];
        initializeFunctionNarrativeNodes(path, scenario, "rich");
        let task;
        while ((task = createFunctionNarrativeNodeTask(batch, path, scenario))) {
          const reading = buildPrimitiveWorksheetResponse(task, locale); assert.ok(reading);
          appendFunctionNarrativeNodes(task, scenario, parseFunctionNarrative(reading, task, locale).scenarios[0]);
        }
        const inputs = Object.fromEntries(scenario.example!.inputs.map(input => [input.name, JSON.parse(input.json)]));
        const result = scenario.nodeDetails!.at(-1)!.values![0].after;
        assert.equal(JSON.parse(result), inputs.enabled ? language === "kotlin" ? (inputs.amount + 3) * 2 : (inputs.amount + 3) / 2 : 0);
        for (const step of scenario.nodeDetails!) {
          assert.ok(step.syntax && step.text && step.reason && step.effect && step.values?.length);
          if (step.code === 'return adjusted * 2' || step.code === 'return adjusted * 2;') assert.match(step.reason!, /13 \* 2 = 26/u);
          if (step.code === 'return adjusted / 2;') {
            assert.match(step.reason!, /13 \/ 2 = 6\.5/u);
            assert.match(step.syntax!, locale === "ko" ? /나눗셈/u : /division/u);
            assert.doesNotMatch(step.syntax!, /Double|Int\b|정수|truncat/u, "TypeScript number division must not borrow Kotlin type labels");
          }
        }
        covered++;
      }
      run.commitBatch();
    }
    assert.equal(covered, 2);
  }
});

test("calls, nested scopes, immutable reassignment, loops, inferred routes and unknown parameter types retain LLM fallback", () => {
  const sources = [
    'fun inspect(enabled: Boolean, amount: Int): Int {\n val adjusted = load(amount)\n return adjusted\n}',
    'fun inspect(enabled: Boolean, amount: Int): Int {\n var adjusted = amount\n if (enabled) { val adjusted = 9 }\n return adjusted\n}',
    'fun inspect(enabled: Boolean, amount: Int): Int {\n val adjusted = amount\n adjusted += 1\n return adjusted\n}',
    'fun inspect(enabled: Boolean, amount: Int): Int {\n adjusted = amount\n return adjusted\n}',
    'fun inspect(enabled: Boolean, amount: Int): Int {\n var adjusted = amount\n while (enabled) adjusted += 1\n return adjusted\n}'
  ];
  for (const source of sources) {
    const batch = fixture(source).nextBatch()!;
    assert.equal(buildPrimitiveWorksheetResponse({ ...batch, nodePreparation: true }, "en"), undefined);
  }
  const batch = fixture('fun inspect(enabled: Boolean, amount: Int): Int {\n return amount + 1\n}').nextBatch()!;
  assert.equal(buildPrimitiveWorksheetResponse({ ...batch, nodePreparation: true, limited: true }, "en"), undefined);
  assert.ok(buildPrimitiveWorksheetResponse({ ...batch, nodePreparation: true, groundingLimited: true }, "en"), "complete source proofs do not depend on the bounded IR fact selection");
  assert.equal(buildPrimitiveWorksheetResponse({ ...batch, nodePreparation: true, snippets: batch.snippets.map(snippet => ({ ...snippet, truncated: true })) }, "en"), undefined);
  assert.equal(buildPrimitiveWorksheetResponse({ ...batch, nodePreparation: true, parameters: [{ name: "amount", type: "Float" }] }, "en"), undefined);
  assert.equal(buildPrimitiveWorksheetResponse({ ...batch, nodePreparation: true, sourceFlow: { ...batch.sourceFlow!, paths: batch.sourceFlow!.paths.map(path => ({ ...path, confidence: "inferred" })) } }, "en"), undefined);
});

test("nullable Kotlin string Elvis retains the selected operand and return as JSON strings", () => {
  const run = fixture('fun inspect(label: String?): String {\n val adjusted = label ?: "guest"\n return adjusted\n}', "kotlin", [{ name: "label", type: "String?" }]);
  let count = 0;
  while (!run.complete) {
    const batch = run.nextBatch()!, preparation = { ...batch, nodePreparation: true };
    const text = buildPrimitiveWorksheetResponse(preparation, "ko"); assert.ok(text);
    const narrative = parseFunctionNarrative(text, preparation, "ko"), scenario = narrative.scenarios[0], path = batch.sourceFlow!.paths[0];
    initializeFunctionNarrativeNodes(path, scenario, "rich");
    let task;
    while ((task = createFunctionNarrativeNodeTask(batch, path, scenario))) {
      const reading = buildPrimitiveWorksheetResponse(task, "ko"); assert.ok(reading);
      appendFunctionNarrativeNodes(task, scenario, parseFunctionNarrative(reading, task, "ko").scenarios[0]);
    }
    const label = JSON.parse(scenario.example!.inputs[0].json);
    assert.equal(JSON.parse(scenario.nodeDetails!.at(-1)!.values![0].after), label ?? "guest");
    const summary = createFunctionNarrativeSummaryTask(batch, path, scenario);
    assert.equal(hasCompletePrimitiveWorksheet(summary), true);
    const factualAnalysis = getPrimitiveWorksheetAnalysis(summary, "ko");
    assert.ok(factualAnalysis); assert.match(factualAnalysis.pathReason, /조건 판단/u);
    assert.match(factualAnalysis.stateChange, /adjusted|반환/u);
    assert.deepEqual((buildLocalNarrativeInput(summary, "ko").summaryTask as any).sourceVerifiedAnalysis, factualAnalysis);
    const schema = createLocalNarrativeSchema(summary, "ko") as any;
    assert.deepEqual(schema.properties.limitations.const, []);
    assert.deepEqual(schema.properties.scenarios.items[0].properties.assumptions.const, []);
    assert.equal(schema.properties.scenarios.items[0].properties.analysis.properties.pathReason.const, factualAnalysis.pathReason);
    const incorrect = structuredClone(summary);
    incorrect.summaryTask!.completed[0].values![0].after = "wrong";
    assert.equal(getPrimitiveWorksheetAnalysis(incorrect, "ko"), undefined, "contradictory evidence stays model-owned");
    const wrongBefore = structuredClone(summary);
    wrongBefore.summaryTask!.completed[0].values![0].before = "999";
    assert.equal(getPrimitiveWorksheetAnalysis(wrongBefore, "ko"), undefined, "conflicting preceding state keeps model fields");
    assert.equal(hasCompletePrimitiveWorksheet({ ...summary, summaryTask: { ...summary.summaryTask!, resultJson: '"wrong"' } }), false);
    assert.match(scenario.nodeDetails![0].syntax!, /Elvis/u); count++; run.commitBatch();
  }
  assert.equal(count, 2);
});

test("a focused worksheet cannot contradict already carried model state", () => {
  const batch = fixture('fun inspect(enabled: Boolean, amount: Int): Int {\n var adjusted = amount + 5\n adjusted -= 2\n return adjusted * 2\n}').nextBatch()!;
  const preparation = { ...batch, nodePreparation: true }, scenario = parseFunctionNarrative(buildPrimitiveWorksheetResponse(preparation, "en")!, preparation, "en").scenarios[0];
  const path = batch.sourceFlow!.paths[0]; initializeFunctionNarrativeNodes(path, scenario, "rich");
  const task = createFunctionNarrativeNodeTask(batch, path, scenario)!;
  assert.ok(buildPrimitiveWorksheetResponse(task, "en"));
  task.nodeTask!.reading!.priorState = [{ name: "adjusted", value: "999" }];
  assert.equal(buildPrimitiveWorksheetResponse(task, "en"), undefined);
});
