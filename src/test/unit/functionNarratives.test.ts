/** Source-context and narrative contracts are tested without an extension host or application execution. */
import assert from "node:assert/strict";
import test from "node:test";
import { buildFunctionNarrativeContext, parseFunctionNarrative, buildFunctionNarrativePrompt } from "../../application/functionNarratives";
import type { SymbolNode } from "../../shared/types";

const node: SymbolNode = {
  id: "private:root", name: "describe", qualifiedName: "private.describe", kind: "function", language: "kotlin",
  filePath: "/private/work/Secret.kt", range: { startLine: 2, startCharacter: 0, endLine: 5, endCharacter: 1 },
  selectionRange: { startLine: 2, startCharacter: 4, endLine: 2, endCharacter: 12 }
};

test("LLM context includes a Kotlin function without parameters and its nearby constant, without exposing paths", () => {
  const source = 'const val LIMIT = 3\n/** Displays the result. */\nfun describe() {\n  if (LIMIT > 0) println("ready")\n  else println("empty")\n}\n';
  const context = buildFunctionNarrativeContext(node, source);
  assert.equal(context.language, "kotlin");
  assert.ok(context.snippets.some((snippet) => snippet.role === "function" && snippet.text.includes('fun describe() {') && snippet.text.includes('else println("empty")')));
  assert.ok(context.snippets.some((snippet) => snippet.text.includes("const val LIMIT = 3")));
  assert.equal(context.limited, false);
  assert.ok(!JSON.stringify(context).includes("/private/work"));
  assert.ok(!JSON.stringify(context).includes("private:root"));
});

test("structured LLM output rejects invented source locations and executable extra fields", () => {
  const context = buildFunctionNarrativeContext(node, 'const val LIMIT = 3\n/** Displays the result. */\nfun describe() {\n  if (LIMIT > 0) println("ready")\n  else println("empty")\n}\n');
  const narrative = { summary: "설정된 상수에 따라 메시지를 출력한다.", scenarios: [{ title: "양수일 때", when: ["LIMIT > 0"], steps: [{ text: 'ready를 출력한다.', source: { snippetId: "root", startLine: 4, endLine: 4 } }], outcome: "출력 후 종료한다.", assumptions: [] }], limitations: [] };
  assert.deepEqual(parseFunctionNarrative(JSON.stringify(narrative), context), narrative);
  assert.deepEqual(parseFunctionNarrative("```json\n" + JSON.stringify(narrative) + "\n```", context), narrative);
  for (const changed of [
    { ...narrative, command: "open-source" },
    { ...narrative, scenarios: Array(5).fill(narrative.scenarios[0]) },
    { ...narrative, scenarios: [{ ...narrative.scenarios[0], steps: [{ text: "invented", source: { snippetId: "foreign", startLine: 4, endLine: 4 } }] }] },
    { ...narrative, scenarios: [{ ...narrative.scenarios[0], steps: [{ text: "invented", source: { snippetId: "root", startLine: 99, endLine: 100 } }] }] }
  ]) assert.throws(() => parseFunctionNarrative(JSON.stringify(changed), context), { message: "invalid-response" });
  assert.throws(() => parseFunctionNarrative("Response: " + JSON.stringify(narrative), context), { message: "invalid-response" });
  assert.throws(() => parseFunctionNarrative(" ".repeat(24001), context), { message: "invalid-response" });
  const prompt = buildFunctionNarrativePrompt(context, "ko");
  assert.ok(prompt[1].includes('fun describe()'));
  assert.ok(prompt[0].includes("Korean"));
});

test("LLM context bounds huge bodies and includes only same-file source-connected helpers", () => {
  const source = Array.from({ length: 2000 }, (_, i) => `  println("${i}")`).join("\n");
  const root = { ...node, range: { ...node.range, startLine: 0, endLine: 1900 } };
  const foreign = { ...node, id: "foreign", name: "foreign", filePath: "/other/Unrelated.kt" };
  const context = buildFunctionNarrativeContext(root, source, [root, foreign, foreign]);
  assert.ok(context.snippets.length > 0);
  assert.ok(context.snippets.length <= 5);
  assert.ok(context.snippets.reduce((total, snippet) => total + snippet.text.length, 0) <= 18000);
  assert.equal(context.limited, true);
  assert.ok(!JSON.stringify(context).includes("foreign"));
});

test("LLM root excerpts exclude adjacent declarations on the same source line", () => {
  const source = 'fun unrelated() = "other"; fun describe() = "ready"; fun later() = "later"';
  const start = source.indexOf("fun describe"); const end = source.indexOf("; fun later");
  const inline = { ...node, range: { startLine: 0, startCharacter: start, endLine: 0, endCharacter: end } };
  const context = buildFunctionNarrativeContext(inline, source);
  assert.equal(context.snippets[0].text, 'fun describe() = "ready"');
  assert.equal(context.limited, false);
});
