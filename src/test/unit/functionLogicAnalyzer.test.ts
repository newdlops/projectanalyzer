/**
 * Function Logic analyzer tests. Fixtures cover structured branch/loop paths,
 * syntax-backed evidence, language adapters, bounded traversal, and honest gaps.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  analyzeFunctionLogic,
  type FunctionLogicBlockKind
} from "../../analyzer/functionLogic";
import type { SymbolNode } from "../../shared/types";

const projectRoot = path.resolve(__dirname, "../../..");

const source = [
  "export async function processOrder(order: Order, limit: number) {",
  "  if (!order.items.length) {",
  "    throw new Error('empty');",
  "  }",
  "  let total = 0;",
  "  for (const item of order.items) {",
  "    total += item.price;",
  "  }",
  "  if (total > limit) {",
  "    await audit.publish(total);",
  "  } else {",
  "    await repository.save(order);",
  "  }",
  "  return { total };",
  "}"
].join("\n");

test("builds statement, branch, repeat, effect, and exit paths inside a function", () => {
  const analysis = analyzeFunctionLogic({
    functionNode: createFunctionNode("processOrder", "/workspace/src/orders.ts", 0),
    sourceText: source
  });

  assert.equal(analysis.language, "typescript");
  assert.match(analysis.signature, /processOrder\(order: Order, limit: number\)/u);
  assert.deepEqual(analysis.blocks.map((block) => block.kind), [
    "entry",
    "condition",
    "throw",
    "mutation",
    "loop",
    "mutation",
    "condition",
    "effect",
    "effect",
    "return",
    "exit"
  ]);

  const firstCondition = analysis.blocks.find((block) => block.label.startsWith("if !order.items"));
  const loop = analysis.blocks.find((block) => block.kind === "loop");
  const mutation = analysis.blocks.find((block) => block.label.includes("total +="));
  const secondCondition = analysis.blocks.find((block) => block.label.startsWith("if total > limit"));
  const effects = analysis.blocks.filter((block) => block.kind === "effect");
  assert.ok(firstCondition && loop && mutation && secondCondition);
  assert.equal(firstCondition.range.startLine, 1);
  assert.equal(mutation.range.startLine, 6);
  assert.deepEqual(effects.map((block) => block.confidence), ["inferred", "inferred"]);
  assert.deepEqual(effects.map((block) => block.branchLabel), ["true", "false"]);

  assertEdgeKindsFrom(analysis, firstCondition.id, ["true", "false"]);
  assertEdgeKindsFrom(analysis, loop.id, ["iterate", "exit"]);
  assertEdgeKindsFrom(analysis, mutation.id, ["repeat"]);
  assertEdgeKindsFrom(analysis, secondCondition.id, ["true", "false"]);
  assert.ok(analysis.edges.some((edge) => edge.kind === "return"));
  assert.ok(analysis.edges.some((edge) => edge.kind === "throw"));
  assert.deepEqual(analysis.callsites.map((callsite) => callsite.calleeText), [
    "Error",
    "audit.publish",
    "repository.save"
  ]);
  assert.deepEqual(analysis.summary, {
    blockCount: 11,
    branchCount: 2,
    loopCount: 1,
    callCount: 3,
    effectCount: 2,
    mutationCount: 2,
    valueChangeCount: 3,
    exitCount: 2
  });
});

test("models a concise arrow body as an implicit return", () => {
  const arrowSource = "const normalize = (value: string) => value.trim();";
  const analysis = analyzeFunctionLogic({
    functionNode: createFunctionNode("normalize", "/workspace/src/text.ts", 0),
    sourceText: arrowSource
  });

  assert.deepEqual(analysis.blocks.map((block) => block.kind), ["entry", "return", "exit"]);
  assert.deepEqual(analysis.edges.map((edge) => edge.kind), ["next", "return"]);
  assert.equal(analysis.blocks[1]?.range.startCharacter, arrowSource.indexOf("value.trim"));
  assert.equal(analysis.callsites[0]?.calleeText, "value.trim");
});

test("does not attach a changed source file to a different nearby function", () => {
  const analysis = analyzeFunctionLogic({
    functionNode: createFunctionNode("processOrder", "/workspace/src/orders.ts", 0),
    sourceText: "export function anotherFunction() { return true; }"
  });

  assert.equal(analysis.blocks.length, 0);
  assert.equal(analysis.gaps[0]?.code, "functionNotFound");
});

test("builds Python condition, loop, match, mutation, call, and exit paths", () => {
  const pythonSource = [
    "class OrderService:",
    "    def process(self, order, limit):",
    "        if not is_ready(order):",
    "            raise ValueError('not ready')",
    "        total = 0",
    "        for item in order.items:",
    "            total += item.price",
    "        match order.status:",
    "            case 'open':",
    "                self.repository.save(order)",
    "            case _:",
    "                return None",
    "        return total"
  ].join("\n");
  const analysis = analyzeFunctionLogic({
    functionNode: {
      ...createFunctionNode("process", "/workspace/src/orders.py", 1),
      qualifiedName: "OrderService.process",
      language: "python"
    },
    sourceText: pythonSource
  });

  assert.equal(analysis.language, "python");
  assert.match(analysis.signature, /^def process\(self, order, limit\):/u);
  assert.deepEqual(analysis.blocks.map((block) => block.kind), [
    "entry",
    "condition",
    "throw",
    "mutation",
    "loop",
    "mutation",
    "switch",
    "effect",
    "return",
    "return",
    "exit"
  ]);
  const condition = analysis.blocks.find((block) => block.kind === "condition");
  const loop = analysis.blocks.find((block) => block.kind === "loop");
  const match = analysis.blocks.find((block) => block.kind === "switch");
  assert.ok(condition && loop && match);
  assertEdgeKindsFrom(analysis, condition.id, ["true", "false"]);
  assertEdgeKindsFrom(analysis, loop.id, ["iterate", "exit"]);
  assertEdgeKindsFrom(analysis, match.id, ["case", "case"]);
  assert.deepEqual(analysis.callsites.map((callsite) => callsite.calleeText), [
    "is_ready",
    "ValueError",
    "self.repository.save"
  ]);
  assert.equal(analysis.summary.callCount, 3);
  assert.equal(analysis.gaps.some((gap) => gap.code === "languageUnsupported"), false);
});

test("builds Java condition, loop, switch, try, mutation, call, and exit paths", () => {
  const javaSource = [
    "class OrderService {",
    "  int process(Order order, int limit) {",
    "    if (!isReady(order)) {",
    "      throw new IllegalStateException();",
    "    }",
    "    int total = 0;",
    "    for (Item item : order.items()) {",
    "      total += item.price();",
    "    }",
    "    try {",
    "      repository.save(order);",
    "    } finally {",
    "      audit.publish(total);",
    "    }",
    "    switch (order.status()) {",
    "      case OPEN: return total;",
    "      default: return 0;",
    "    }",
    "  }",
    "}"
  ].join("\n");
  const analysis = analyzeFunctionLogic({
    functionNode: {
      ...createFunctionNode("process", "/workspace/src/OrderService.java", 1),
      qualifiedName: "OrderService.process",
      language: "java"
    },
    sourceText: javaSource
  });

  assert.equal(analysis.language, "java");
  assert.match(analysis.signature, /int process\(Order order, int limit\) \{/u);
  assert.ok(analysis.blocks.some((block) => block.kind === "condition"));
  assert.ok(analysis.blocks.some((block) => block.kind === "loop"));
  assert.ok(analysis.blocks.some((block) => block.kind === "try"));
  assert.ok(analysis.blocks.some((block) => block.kind === "switch"));
  assert.ok(analysis.blocks.some((block) => block.kind === "mutation"));
  assert.ok(analysis.blocks.some((block) => block.kind === "effect"));
  const condition = analysis.blocks.find((block) => block.kind === "condition");
  const loop = analysis.blocks.find((block) => block.kind === "loop");
  const switchBlock = analysis.blocks.find((block) => block.kind === "switch");
  assert.ok(condition && loop && switchBlock);
  assertEdgeKindsFrom(analysis, condition.id, ["true", "false"]);
  assertEdgeKindsFrom(analysis, loop.id, ["iterate", "exit"]);
  assertEdgeKindsFrom(analysis, switchBlock.id, ["case", "case"]);
  assert.ok(analysis.callsites.some((callsite) => callsite.calleeText === "isReady"));
  assert.ok(analysis.callsites.some((callsite) => callsite.calleeText === "repository.save"));
  assert.equal(analysis.gaps.some((gap) => gap.code === "languageUnsupported"), false);
});

test("retains root callsites in Python and Java expression-bodied lambdas", () => {
  const python = analyzeFunctionLogic({
    functionNode: {
      ...createFunctionNode("loader", "/workspace/src/loaders.py", 0),
      language: "python"
    },
    sourceText: "loader = lambda: repository.load()"
  });
  const java = analyzeFunctionLogic({
    functionNode: {
      ...createFunctionNode("loader", "/workspace/src/Loaders.java", 1),
      qualifiedName: "Loaders.loader",
      language: "java"
    },
    sourceText: [
      "class Loaders {",
      "  Function<String> loader = value -> repository.load(value);",
      "}"
    ].join("\n")
  });

  assert.deepEqual(python.blocks.map((block) => block.kind), ["entry", "return", "exit"]);
  assert.deepEqual(java.blocks.map((block) => block.kind), ["entry", "return", "exit"]);
  assert.deepEqual(python.callsites.map((callsite) => callsite.calleeText), [
    "repository.load"
  ]);
  assert.deepEqual(java.callsites.map((callsite) => callsite.calleeText), [
    "repository.load"
  ]);
  assert.equal(python.summary.callCount, 1);
  assert.equal(java.summary.callCount, 1);
});

test("preserves complete graph-box statement text across supported languages", () => {
  const sourceTail = "graph_text_tail_sentinel";
  const expression = [
    ...Array.from({ length: 45 }, (_, index) => `sourceValue${index}`),
    sourceTail
  ].join(" + ");
  const analyses = [
    analyzeFunctionLogic({
      functionNode: createFunctionNode("complete", "/workspace/src/complete.ts", 0),
      sourceText: `function complete() { result = ${expression}; }`
    }),
    analyzeFunctionLogic({
      functionNode: {
        ...createFunctionNode("complete", "/workspace/src/complete.py", 0),
        language: "python"
      },
      sourceText: `def complete():\n    result = ${expression}`
    }),
    analyzeFunctionLogic({
      functionNode: {
        ...createFunctionNode("complete", "/workspace/src/Complete.java", 1),
        qualifiedName: "Complete.complete",
        language: "java"
      },
      sourceText: `class Complete {\n  void complete() { result = ${expression}; }\n}`
    })
  ];

  for (const analysis of analyses) {
    const statement = analysis.blocks.find((block) => block.label.includes("result ="));
    assert.ok(statement, `missing complete statement for ${analysis.language}`);
    assert.ok(statement.label.includes(sourceTail));
    assert.doesNotMatch(statement.label, /…/u);
    assert.ok(statement.label.length > 180);
  }
});

test("preserves complete case text on branch badges across supported languages", () => {
  const branchTail = "graph_branch_tail_sentinel";
  const pattern = `"${"complete-branch-value-".repeat(12)}${branchTail}"`;
  const analyses = [
    analyzeFunctionLogic({
      functionNode: createFunctionNode("choose", "/workspace/src/choose.ts", 0),
      sourceText: `function choose(value) { switch (value) { case ${pattern}: return 1; default: return 0; } }`
    }),
    analyzeFunctionLogic({
      functionNode: {
        ...createFunctionNode("choose", "/workspace/src/choose.py", 0),
        language: "python"
      },
      sourceText: `def choose(value):\n    match value:\n        case ${pattern}:\n            return 1\n        case _:\n            return 0`
    }),
    analyzeFunctionLogic({
      functionNode: {
        ...createFunctionNode("choose", "/workspace/src/Choose.java", 1),
        qualifiedName: "Choose.choose",
        language: "java"
      },
      sourceText: `class Choose {\n  int choose(String value) { switch (value) { case ${pattern}: return 1; default: return 0; } }\n}`
    })
  ];

  for (const analysis of analyses) {
    const branch = analysis.blocks.find((block) => block.branchLabel?.includes(branchTail));
    assert.ok(branch, `missing complete case badge for ${analysis.language}`);
    assert.ok((branch.branchLabel?.length ?? 0) > 180);
    assert.doesNotMatch(branch.branchLabel ?? "", /…/u);
  }
});

test("analyzes the standalone complex workflow fixture as a deep expandable flow", () => {
  const fixturePath = path.join(
    projectRoot,
    "src/test/fixtures/functionLogic/complexOrderWorkflow.ts"
  );
  const sourceText = fs.readFileSync(fixturePath, "utf8");
  const functionName = "processComplexOrderBatch";
  const declarationOffset = sourceText.indexOf(`export function ${functionName}`);
  assert.ok(declarationOffset >= 0);
  const declarationLine = sourceText.slice(0, declarationOffset).split("\n").length - 1;
  const analysis = analyzeFunctionLogic({
    functionNode: createFunctionNode(functionName, fixturePath, declarationLine),
    sourceText
  });
  const kinds = new Set(analysis.blocks.map((block) => block.kind));
  const callsiteNames = new Set(analysis.callsites.map((callsite) => callsite.calleeName));
  const valueTargets = new Set(analysis.blocks.flatMap((block) =>
    block.valueChanges?.map((change) => change.target) ?? []
  ));
  const completeCondition = analysis.blocks.find((block) =>
    block.kind === "condition"
      && block.label.includes("manual-verification-required")
  );

  assert.ok(analysis.blocks.length > 40);
  const expectedKinds: FunctionLogicBlockKind[] = [
    "condition",
    "loop",
    "switch",
    "try",
    "mutation",
    "effect",
    "call",
    "break",
    "continue",
    "throw",
    "return"
  ];
  for (const kind of expectedKinds) {
    assert.ok(kinds.has(kind), `missing ${kind} block`);
  }
  assert.ok(analysis.summary.branchCount >= 8);
  assert.ok(analysis.summary.loopCount >= 2);
  assert.ok(analysis.summary.valueChangeCount >= 25);
  for (const calleeName of [
    "shouldSkipOrder",
    "normalizeOrder",
    "isHighRiskOrder",
    "reserveInventory",
    "rollbackReservations",
    "buildBatchSummary",
    "normalizeError"
  ]) {
    assert.ok(callsiteNames.has(calleeName), `missing ${calleeName} callsite`);
  }
  assert.ok(completeCondition && completeCondition.label.length > 180);
  assert.doesNotMatch(completeCondition.label, /…/u);
  assert.ok(valueTargets.has(
    "result.summary.reconciliation.identifiers."
      + "environmentSpecificCompositeAuditKeyForDownstreamReconciliation"
  ));
});

test("analyzes the standalone Python workflow fixture with Python-specific control flow", () => {
  const fixturePath = path.join(
    projectRoot,
    "src/test/fixtures/functionLogic/complex_order_workflow.py"
  );
  const sourceText = fs.readFileSync(fixturePath, "utf8");
  const functionName = "process_complex_order_batch";
  const declarationOffset = sourceText.indexOf(`def ${functionName}`);
  assert.ok(declarationOffset >= 0);
  const declarationLine = sourceText.slice(0, declarationOffset).split("\n").length - 1;
  const analysis = analyzeFunctionLogic({
    functionNode: {
      ...createFunctionNode(functionName, fixturePath, declarationLine),
      language: "python"
    },
    sourceText
  });
  const kinds = new Set(analysis.blocks.map((block) => block.kind));
  const callsiteNames = new Set(analysis.callsites.map((callsite) => callsite.calleeName));
  const valueTargets = analysis.blocks.flatMap((block) =>
    block.valueChanges?.map((change) => change.target) ?? []
  );
  const completeCondition = analysis.blocks.find((block) =>
    block.kind === "condition"
      && block.label.includes("manual-verification-required")
  );
  const longTarget = valueTargets.find((target) =>
    target.includes(
      "environment_specific_composite_audit_key_for_downstream_reconciliation"
    )
  );
  const expectedKinds: FunctionLogicBlockKind[] = [
    "condition",
    "loop",
    "switch",
    "try",
    "mutation",
    "effect",
    "call",
    "break",
    "continue",
    "throw",
    "return"
  ];

  assert.ok(analysis.blocks.length > 40);
  for (const kind of expectedKinds) {
    assert.ok(kinds.has(kind), `missing Python ${kind} block`);
  }
  assert.ok(analysis.summary.branchCount >= 8);
  assert.ok(analysis.summary.loopCount >= 2);
  assert.ok(analysis.summary.valueChangeCount >= 25);
  for (const calleeName of [
    "should_skip_order",
    "normalize_order",
    "is_high_risk_order",
    "reserve_inventory",
    "rollback_reservations",
    "build_batch_summary",
    "normalize_error"
  ]) {
    assert.ok(callsiteNames.has(calleeName), `missing ${calleeName} callsite`);
  }
  assert.ok(completeCondition && completeCondition.label.length > 180);
  assert.doesNotMatch(completeCondition.label, /…/u);
  assert.ok(longTarget && longTarget.length > 80);
  assert.doesNotMatch(longTarget, /…/u);
  assert.ok(analysis.blocks.some((block) =>
    block.label.includes("post-loop continuation")
  ));
});

test("reports unsupported languages and enforces the visible block budget", () => {
  const unsupported = analyzeFunctionLogic({
    functionNode: {
      ...createFunctionNode("process_order", "/workspace/src/orders.rs", 0),
      language: "rust"
    },
    sourceText: "fn process_order(order: Order) -> Order { order }"
  });
  const bounded = analyzeFunctionLogic({
    functionNode: createFunctionNode("processOrder", "/workspace/src/orders.ts", 0),
    sourceText: source,
    maxBlocks: 3
  });

  assert.equal(unsupported.language, "unsupported");
  assert.equal(unsupported.gaps[0]?.code, "languageUnsupported");
  assert.equal(bounded.blocks.length, 5, "entry and exit remain outside the statement budget");
  assert.ok(bounded.gaps.some((gap) => gap.message.includes("3-block reading limit")));
});

/** Creates the source-backed callable identity supplied by graph analysis. */
function createFunctionNode(name: string, filePath: string, line: number): SymbolNode {
  const selectionRange = {
    startLine: line,
    startCharacter: 22,
    endLine: line,
    endCharacter: 22 + name.length
  };
  return {
    id: `function:${name}`,
    kind: "function",
    name,
    qualifiedName: name,
    filePath,
    range: selectionRange,
    selectionRange,
    language: "typescript"
  };
}

/** Asserts the complete outgoing transfer vocabulary for one block. */
function assertEdgeKindsFrom(
  analysis: ReturnType<typeof analyzeFunctionLogic>,
  sourceId: string,
  expectedKinds: string[]
): void {
  assert.deepEqual(
    analysis.edges.filter((edge) => edge.sourceId === sourceId).map((edge) => edge.kind),
    expectedKinds
  );
}
