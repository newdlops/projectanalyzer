/** Function Guide tests cover bounded declaration facts, codebase context, scenarios, and opaque projection. */

import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { analyzeFunctionTutorDeclaration } from "../../analyzer/functionTutor";
import { buildFunctionTutorModel, CodeFlowInsightCache } from "../../application/codeFlow";
import { createFunctionTutorPayload } from "../../application/codeFlow/functionTutor";
import type { SymbolNode } from "../../shared/types";
import { createGraph } from "./helpers/projectReadingGuideFixtures";
import { getFunctionTutorBrowserSource } from "../../webview/codeFlow/tutor";

const filePath = "/workspace/src/discount.ts";
const source = [
  "export function discount(amount: number = 10, member: boolean = false) {",
  "  let value = amount;",
  "  if (amount >= 100) value += 10;",
  "  if (member) value += 5;",
  "  return value;",
  "}",
  "discount(120, true);"
].join("\n");

test("Function Guide derives bounded typed/default/branch scenarios without executing calls", async () => {
  const node = createFunctionNode();
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText: source });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText: source, functionLogic: logic });
  assert.equal(declaration.parameters.length, 2);
  assert.equal(declaration.parameters[0].typeKind, "number");
  assert.deepEqual(declaration.parameters[0].defaultValue, { kind: "number", value: 10 });
  assert.ok(declaration.constraints.some((constraint) => constraint.operator === "gte"));
  assert.ok(declaration.program.blocks.some((block) => block.operations.some((operation) => operation.kind === "assign")));
  const graph = createGraph({ files: [filePath], callables: [node] });
  graph.edges.push({
    id: "call:discount",
    kind: "calls",
    sourceId: "caller",
    targetId: node.id,
    filePath,
    range: { startLine: 6, startCharacter: 0, endLine: 6, endCharacter: 19 },
    confidence: "exact"
  });
  const insights = new CodeFlowInsightCache().get(graph);
  const model = await buildFunctionTutorModel({
    graph,
    declaration,
    functionLogic: logic,
    architectureIndex: insights.functionArchitecture,
    semanticFlows: insights.semanticFlows,
    functionIndex: insights.functionIndex,
    readSourceText: async () => source
  });
  assert.ok(model.callsites.length > 0);
  assert.ok(model.seeds.length > 0 && model.seeds.length <= 12);
  assert.ok(model.seeds.some((seed) => seed.source === "callsite"));
  assert.ok(model.seeds.every((seed) => seed.inputs.length === declaration.parameters.length));
  assert.equal(model.guide.chapters.length, 5);
  // Fixed questions are semantic descriptors, not Host-provided English.
  assert.deepEqual(model.guide.chapters.map((chapter) => chapter.questionKey), [
    "place", "inputs", "decisions", "work", "outcomes"
  ]);
  assert.ok(model.guide.chapters.every((chapter) => chapter.answerKey === chapter.kind));
  assert.notEqual(model.availability, "unavailable");
});

test("Function Guide retains attached JSDoc as bounded source documentation", () => {
  const sourceText = [
    "/**",
    " * Applies a bounded member discount.",
    " * @param amount Requested amount.",
    " * @returns A static discount candidate.",
    " */",
    "export function discount(amount: number) { return amount; }"
  ].join("\n");
  const node = {
    ...createFunctionNode(),
    range: { startLine: 5, startCharacter: 0, endLine: 5, endCharacter: 58 },
    selectionRange: { startLine: 5, startCharacter: 16, endLine: 5, endCharacter: 24 }
  };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  assert.equal(declaration.documentation?.kind, "jsdoc");
  assert.equal(declaration.documentation?.summary, "Applies a bounded member discount.");
  assert.deepEqual(declaration.documentation?.tags, [
    { kind: "parameter", parameterName: "amount", text: "Requested amount." },
    { kind: "returns", text: "A static discount candidate." }
  ]);
  assert.equal(declaration.documentation?.evidence[0]?.range.startLine, 0);
});

test("Function Guide reads only the first Python body docstring and keeps detached text out", () => {
  const sourceText = [
    "# Detached comment.",
    "def discount(amount: int):",
    "  \"\"\"Returns a bounded amount.\"\"\"",
    "  return amount"
  ].join("\n");
  const node = {
    ...createFunctionNode(),
    language: "python",
    filePath: "/workspace/src/demo.py",
    range: { startLine: 1, startCharacter: 0, endLine: 3, endCharacter: 15 },
    selectionRange: { startLine: 1, startCharacter: 4, endLine: 1, endCharacter: 12 }
  };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  assert.equal(declaration.documentation?.kind, "docstring");
  assert.equal(declaration.documentation?.summary, "Returns a bounded amount.");
  assert.equal(declaration.documentation?.evidence[0]?.range.startLine, 2);
});

test("Function Guide derives bounded Python declaration facts from its parser-owned header", () => {
  const node = { ...createFunctionNode(), language: "python", filePath: "/workspace/src/demo.py" };
  const sourceText = "def discount(amount: int = 10, member: bool = False):\n  if amount >= 100:\n    return amount\n  return 0\n";
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({
    functionNode: node,
    sourceText,
    functionLogic: logic
  });
  assert.deepEqual(declaration.parameters.map((parameter) => parameter.name), ["amount", "member"]);
  assert.equal(declaration.parameters[0].typeKind, "number");
  assert.deepEqual(declaration.parameters[0].defaultValue, { kind: "number", value: 10 });
  assert.equal(declaration.parameters[1].typeKind, "boolean");
  assert.deepEqual(declaration.parameters[1].defaultValue, { kind: "boolean", value: false });
  assert.ok(declaration.constraints.some((constraint) => constraint.operator === "gte"));
});

test("Function Guide derives Java parameter categories without claiming unavailable support", () => {
  const node = { ...createFunctionNode(), language: "java", filePath: "/workspace/src/Demo.java" };
  const sourceText = "class Demo { int discount(int amount, boolean member) { if (amount >= 100) return amount; return 0; } }";
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  assert.deepEqual(declaration.parameters.map((parameter) => parameter.name), ["amount", "member"]);
  assert.deepEqual(declaration.parameters.map((parameter) => parameter.typeKind), ["number", "boolean"]);
});

test("Function Guide preserves functional-language inputs as bounded unknown scenarios", () => {
  const node = { ...createFunctionNode(), language: "fsharp", filePath: "/workspace/src/demo.fs" };
  const sourceText = "let discount amount member = if member then amount else 0";
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  assert.deepEqual(declaration.parameters.map((parameter) => parameter.name), ["amount", "member"]);
  assert.equal(declaration.parameters.every((parameter) => parameter.typeKind === "unknown"), true);
});

test("Function Guide reads Elixir defaults without treating the default as an input name", () => {
  const node = { ...createFunctionNode(), language: "elixir", filePath: "/workspace/src/demo.ex" };
  const sourceText = "def discount(amount, member \\ false) do\n  if member, do: amount, else: 0\nend";
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  assert.deepEqual(declaration.parameters.map((parameter) => parameter.name), ["amount", "member"]);
  assert.deepEqual(declaration.parameters[1]?.defaultValue, { kind: "boolean", value: false });
});

test("Function Guide projects only opaque browser identities and bounded evidence tokens", async () => {
  const node = createFunctionNode();
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText: source });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText: source, functionLogic: logic });
  const graph = createGraph({ files: [filePath], callables: [node] });
  const insights = new CodeFlowInsightCache().get(graph);
  const model = await buildFunctionTutorModel({
    graph,
    declaration,
    functionLogic: logic,
    architectureIndex: insights.functionArchitecture,
    semanticFlows: insights.semanticFlows,
    functionIndex: insights.functionIndex,
    readSourceText: async () => source
  });
  const blockIds = new Map(logic.blocks.map((block, index) => [block.id, `block-token-${index}`]));
  const edgeIds = new Map(logic.edges.map((edge, index) => [edge.id, `edge-token-${index}`]));
  const bindingIds = new Map((logic.valueBindings ?? []).map((binding, index) => [binding.id, `binding-token-${index}`]));
  const payload = createFunctionTutorPayload(model, {
    flowId: "code-flow:token",
    blockIds,
    edgeIds,
    bindingIds,
    createEvidenceToken: () => "code-evidence:token"
  });
  assert.ok(payload);
  assert.equal(payload?.version, 2);
  assert.equal(payload?.guide.chapters.length, 5);
  const serialized = JSON.stringify(payload);
  assert.ok(Buffer.byteLength(serialized, "utf8") < 96 * 1024, "Function Guide payload must stay below 96 KiB");
  assert.doesNotMatch(serialized, new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.doesNotMatch(serialized, /function:discount/u);
  assert.match(serialized, /code-evidence:token/u);
});

test("Function Guide scenario interpreter remains bounded and never evaluates source strings", () => {
  const sourceText = getFunctionTutorBrowserSource();
  assert.doesNotMatch(sourceText, /\beval\s*\(/u);
  assert.doesNotMatch(sourceText, /\bnew Function\b/u);
  const runScenario = new Function(`${sourceText}\nreturn functionTutorRunScenario;`)() as (tutor: Record<string, unknown>, seed: Record<string, unknown>) => Array<Record<string, unknown>>;
  const finiteTutor = {
    program: {
      entryBlockId: "entry",
      bindings: [{ bindingId: "amount", parameterId: "parameter", name: "amount", kind: "parameter", certainty: "exact" }, { bindingId: "total", name: "total", kind: "local", certainty: "exact" }],
      blocks: [{ blockId: "entry", kind: "entry", operations: [] }, {
        blockId: "calculate", kind: "operation", operations: [{ kind: "define", bindingId: "total", value: { kind: "binary", operator: "add", left: { kind: "binding", bindingId: "amount" }, right: { kind: "literal", value: { kind: "number", value: 5 } } } }], terminal: { kind: "return", value: { kind: "binding", bindingId: "total" } }
      }],
      edges: [{ edgeId: "next", sourceBlockId: "entry", targetBlockId: "calculate", kind: "next", certainty: "exact" }]
    }
  };
  const seed = { certainty: "exact", inputs: [{ parameterId: "parameter", value: { kind: "number", value: 10 } }] };
  const finite = runScenario(finiteTutor, seed);
  assert.deepEqual(finite[0]?.terminal, { kind: "return", value: { kind: "number", value: 15 } });
  const loopingTutor = {
    program: {
      entryBlockId: "loop",
      bindings: [],
      blocks: [{ blockId: "loop", kind: "loop", operations: [] }],
      edges: [{ edgeId: "repeat", sourceBlockId: "loop", targetBlockId: "loop", kind: "back", certainty: "exact" }]
    }
  };
  const looping = runScenario(loopingTutor, { certainty: "exact", inputs: [] });
  assert.equal(looping[0]?.limited, true);
  assert.equal((looping[0]?.terminal as { reason?: string } | undefined)?.reason, "loop-budget");
});

function createFunctionNode(): SymbolNode {
  return {
    id: "function:discount",
    kind: "function",
    name: "discount",
    qualifiedName: "discount",
    filePath,
    range: { startLine: 0, startCharacter: 0, endLine: 5, endCharacter: 1 },
    selectionRange: { startLine: 0, startCharacter: 16, endLine: 0, endCharacter: 24 },
    language: "typescript"
  };
}
