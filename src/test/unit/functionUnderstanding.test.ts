/** Reading overview counts remain source-scoped through attachment and malformed ancestry. */
import assert from "node:assert/strict";
import test from "node:test";
import { createFunctionUnderstandingModel, getFunctionUnderstandingBrowserSource } from "../../webview/codeFlow/understanding";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import type { FunctionLogicBlockPayloadKind } from "../../protocol/functionLogic";

const block = (id: string, kind: FunctionLogicBlockPayloadKind, parentBlockId?: string) => ({ id, kind, parentBlockId });

test("overview separates returns, errors and possible effects without counting nested callbacks", () => {
  const blocks = [block("entry", "entry"), block("branch", "condition"), block("return", "return", "branch"),
    block("error", "throw"), block("effect", "effect"), block("callback", "callable"), block("cleanup", "return", "callback")];
  const result = createFunctionUnderstandingModel({ blocks, layout: { nodes: blocks.map((b) => ({ blockId: b.id })) },
    valueBindings: [{ kind: "parameter", name: "request" }, { kind: "local", name: "temporary" }] });
  assert.deepEqual(result, { inputs: ["request"], entryId: "entry", decisionIds: ["branch"], returnIds: ["return"], throwIds: ["error"], effectIds: ["effect"] });
});

test("overview maps root program IDs and excludes attached functions, duplicate and stale blocks", () => {
  const blocks = [block("root-entry", "entry"), block("root-result", "return"), block("child-result", "return"), block("root-result", "return"), block("hidden", "condition")];
  const result = createFunctionUnderstandingModel({ blocks, layout: { nodes: blocks.slice(0, 3).map((b) => ({ blockId: b.id })) },
    tutor: { parameters: [{ name: "amount" }], program: { blocks: [{ blockId: "entry" }, { blockId: "result" }] } }
  }, (id) => "root-" + id);
  assert.deepEqual(result.inputs, ["amount"]); assert.equal(result.entryId, "root-entry");
  assert.deepEqual(result.returnIds, ["root-result"]); assert.deepEqual(result.decisionIds, []);
  const legacy = createFunctionUnderstandingModel({ blocks: blocks.map((b) => ({ ...b, functionScopeId: b.id.startsWith("child") ? "child" : "root" })),
    layout: { nodes: blocks.map((b) => ({ blockId: b.id })) }, valueBindings: [
      { name: "amount", kind: "parameter", definitionBlockId: "root-entry" },
      { name: "nested", kind: "parameter", definitionBlockId: "child-result" }
    ] });
  assert.deepEqual(legacy.returnIds, ["root-result"]); assert.deepEqual(legacy.inputs, ["amount"]);
});

test("cycle, depth-bound and empty summaries do not invent a result", () => {
  const blocks = [block("a", "return", "b"), block("b", "condition", "a"), block("c", "return", "d"), block("d", "condition", "e"), block("e", "condition")];
  const result = createFunctionUnderstandingModel({ blocks, layout: { nodes: blocks.map((b) => ({ blockId: b.id })) } }, undefined, 1);
  assert.deepEqual(result.returnIds, []);
  assert.deepEqual(createFunctionUnderstandingModel({ blocks: [], layout: { nodes: [] } }).inputs, []);
});

test("source-backed Django writes join outcome counts without duplicating a graph site", () => {
  const blocks = [block("entry", "entry"), block("write", "call")];
  const result = createFunctionUnderstandingModel({ blocks, layout: { nodes: blocks.map((b) => ({ blockId: b.id })) }, tutor: {
    parameters: [], program: { blocks: blocks.map((b) => ({ blockId: b.id })) }, frameworkBehavior: { facts: [
      { kind: "django-query-write", blockId: "write" }, { kind: "django-query-write", blockId: "write" },
      { kind: "django-query-write", blockId: "attached" }, { kind: "django-query-lazy", blockId: "entry" }
    ] }
  } });
  assert.deepEqual(result.effectIds, ["write"]);
});

test("browser model and bilingual framework explanations are executable production source", () => {
  const evaluate = new Function(`${getBrowserLocalizationSource()} ${getFunctionUnderstandingBrowserSource()} return { model: createFunctionUnderstandingModel, copy: projectAnalyzerUiCopy };`)();
  assert.deepEqual(evaluate.model({ blocks: [], layout: { nodes: [] } }), createFunctionUnderstandingModel({ blocks: [], layout: { nodes: [] } }));
  for (const [key, text] of Object.entries(evaluate.copy.en)) {
    if (!key.startsWith("understanding-") && !key.startsWith("framework-react-") && !key.startsWith("framework-django-")) continue;
    assert.equal(typeof evaluate.copy.ko[key], "string", key);
    assert.notEqual(evaluate.copy.ko[key], text, key);
  }
});
