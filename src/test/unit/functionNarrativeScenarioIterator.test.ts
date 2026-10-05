/** Complete scenario enumeration uses real language CFGs, including >4 paths and finite loop abstraction. */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { buildFunctionNarrativeContext, createFunctionNarrativeScenarioIterator, numberFunctionNarrativeContext } from "../../application/functionNarratives";
import type { SymbolNode } from "../../shared/types";

/** Constructs one immutable fixture declaration; no VS Code, file reads, model or evaluator is involved. */
function fixture(source: string, language: "typescript" | "python" | "kotlin" = "typescript") {
  const lines = source.split("\n");
  const node: SymbolNode = { id: "private:scenario-fixture", name: "inspect", qualifiedName: "inspect", kind: "function", language,
    filePath: `/private/inspect.${language === "python" ? "py" : language === "kotlin" ? "kt" : "ts"}`,
    range: { startLine: 0, startCharacter: 0, endLine: lines.length - 1, endCharacter: lines.at(-1)!.length },
    selectionRange: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 7 } };
  const analysis = analyzeFunctionLogic({ functionNode: node, sourceText: source });
  return { context: buildFunctionNarrativeContext(node, source, [], analysis), analysis };
}

test("all eight independent decision combinations survive a bounded legacy three-path preview", () => {
  const { context } = fixture('function inspect(a: boolean, b: boolean, c: boolean) {\n let total = 0;\n if (a) total += 1;\n if (b) total += 2;\n if (c) total += 4;\n return total;\n}');
  assert.ok(context.sourceFlow!.paths.length <= 3);
  const iterator = createFunctionNarrativeScenarioIterator(context)!;
  const paths = [...iterator];
  assert.equal(paths.length, 8);
  assert.ok(paths.every((path) => path.status === "source-terminal"));
  assert.equal(new Set(paths.map((path) => path.steps.filter((step) => step.branch).map((step) => step.branch!.outcome).join())).size, 8);
  assert.ok(paths.every((path) => path.steps.at(-1)?.code === "return total;"));
  assert.equal(iterator.next().done, true);
});

test("Kotlin early exits are complete and never include operations after their return", () => {
  const { context } = fixture('fun inspect(value: Int): String {\n if (value < 0) return "negative"\n if (value == 0) return "zero"\n if (value < 10) return "small"\n if (value < 100) return "medium"\n return "large"\n}', "kotlin");
  const paths = [...createFunctionNarrativeScenarioIterator(context)!];
  assert.equal(paths.length, 5);
  assert.deepEqual(paths.map((path) => path.steps.at(-1)?.code), ['return "negative"', 'return "zero"', 'return "small"', 'return "medium"', 'return "large"']);
  assert.ok(paths.every((path) => path.steps.filter((step) => step.kind === "return").length === 1));
});

test("Python loop skip, continue, break and normal body routes all reach their source terminal", () => {
  const { context } = fixture('def inspect(enabled, items):\n    if not enabled:\n        return 0\n    total = 0\n    for item in items:\n        if item < 0:\n            continue\n        if item == 0:\n            break\n        total += item\n    return total', "python");
  const paths = [...createFunctionNarrativeScenarioIterator(context)!];
  assert.equal(paths.length, 5);
  assert.ok(paths.every((path) => path.status === "source-terminal"));
  assert.ok(paths.some((path) => path.steps.some((step) => step.kind === "continue")));
  assert.ok(paths.some((path) => path.steps.some((step) => step.kind === "break")));
  assert.ok(paths.some((path) => path.steps.some((step) => step.branch?.outcome === "repeat-exit")));
});

test("inferred edges remain inferred and partial routes stay separate instead of disabling all frames", () => {
  const { context } = fixture('function inspect(flag: boolean) {\n if (flag) return 1;\n return 0;\n}');
  context.scenarioGraph!.nodes[context.scenarioGraph!.entry].next[0].confidence = "inferred";
  const inferred = [...createFunctionNarrativeScenarioIterator(context)!];
  assert.equal(inferred.length, 2); assert.ok(inferred.every((path) => path.confidence === "inferred"));
  const condition = context.scenarioGraph!.nodes.find((node) => node.kind === "condition")!;
  condition.next[0].target = -1;
  const mixed = [...createFunctionNarrativeScenarioIterator(context)!];
  assert.equal(mixed.length, 2);
  assert.equal(mixed[0].reason, "missing-block"); assert.equal(mixed[1].status, "source-terminal");
});

test("unknown cycles and explicit depth limits terminate without hiding a coverage gap", () => {
  const { context } = fixture('function inspect() {\n return 1;\n}');
  const graph = context.scenarioGraph!;
  graph.nodes[1].kind = "operation"; graph.nodes[1].next = [{ target: 1, outcome: "next", confidence: "inferred" }];
  assert.equal([...createFunctionNarrativeScenarioIterator(context)!][0].reason, "cycle");
  assert.equal([...createFunctionNarrativeScenarioIterator(context, { maxDepth: 1 })!][0].reason, "depth-limit");
});

test("Host scenario graph is compact and never included in a model's numbered source data", () => {
  const { context } = fixture('function inspect(a: boolean) {\n if (a) return 1;\n return 0;\n}');
  assert.ok(context.scenarioGraph); assert.equal(numberFunctionNarrativeContext(context).scenarioGraph, undefined);
  assert.ok(!JSON.stringify(context.scenarioGraph).includes("private:"));
  assert.ok(!JSON.stringify(context.scenarioGraph).includes("logic-block:"));
  assert.equal(createFunctionNarrativeScenarioIterator({ ...context, scenarioGraph: undefined }), undefined);
});
