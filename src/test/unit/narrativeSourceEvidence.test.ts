/** Independent compiler evidence distinguishes callees, arguments and chained calls. */
import assert from "node:assert/strict";
import test from "node:test";
import { readTypeScriptSourceCalls } from "../../analyzer/sourceEvidence";
import { extractWholeSourceRange } from "../../application/narrativeSources";
import { SourceCaptureError } from "../../shared/narrativeSources";
import type { SourceRange, SymbolNode } from "../../shared/types";

/** One physical line makes expected offsets independent of the range implementation. */
function facts(body: string, override = {}) {
  const text = `function sample(){ ${body} }`, range: SourceRange = { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: text.length };
  const node: SymbolNode = { id: "sample", kind: "function", name: "sample", qualifiedName: "sample", filePath: "/workspace/evidence.ts",
    language: "typescript", range, selectionRange: { ...range, startCharacter: 9, endCharacter: 15 } };
  const result = readTypeScriptSourceCalls(node, text, range, { maxNodes: 10000, maxDepth: 100, ...override })!;
  return { text, node, result, slices: result.calls.map((call) => call.evidenceRanges.map((owned) => extractWholeSourceRange(text, owned))) };
}

test("compiler evidence includes the whole call, complete callee and native opening prefix", () => {
  const { result, slices } = facts('return finish("input");');
  assert.equal(result.limited, false); assert.deepEqual(slices, [['finish("input")', "finish", "finish("]]);
});

test("nested argument invocations own separate evidence ranges", () => {
  const { slices } = facts("return outer(inner(value));");
  assert.equal(slices.length, 2); assert.ok(slices.some((ranges) => ranges.includes("outer(")));
  assert.ok(slices.some((ranges) => ranges.includes("inner(")));
  assert.ok(slices.every((ranges) => !(ranges.includes("outer(") && ranges.includes("inner("))));
});

test("a chained dynamic call cannot steal the inner invocation's whole range", () => {
  const { slices } = facts("return factory()();");
  assert.equal(slices.length, 2);
  const outer = slices.find((ranges) => ranges.includes("factory()()"))!, inner = slices.find((ranges) => ranges.includes("factory("))!;
  assert.ok(!outer.includes("factory()")); assert.ok(inner.includes("factory()"));
});

test("constructor prefixes begin at the constructor expression and retain the new expression", () => {
  const { slices } = facts("return new Thing(value);");
  assert.deepEqual(slices, [["new Thing(value)", "Thing", "Thing("]]);
});

test("call-looking strings inside arguments do not create parser call evidence", () => {
  const { result, slices } = facts('return target("fake(inner())");');
  assert.equal(result.calls.length, 1); assert.ok(!slices[0].includes("fake(")); assert.ok(!slices[0].includes("inner("));
});

test("nested callable bodies retain their own dependency owner", () => {
  const { result, slices } = facts("function held(){ return ignored(); } return seen();");
  assert.equal(result.calls.length, 1); assert.ok(slices[0].includes("seen("));
});

test("syntax traversal limits reject instead of returning a favorable call subset", () => {
  for (const limits of [{ maxNodes: 1 }, { maxDepth: 0 }]) assert.throws(() => facts("return target(value);", limits),
    (error: unknown) => error instanceof SourceCaptureError && error.code === "context-too-large");
});

test("compiler parser recovery is explicitly limited for incomplete source", () => {
  const { text, node } = facts("return target(value);");
  const incomplete = text.slice(0, -1).trimEnd(), range = { ...node.range, endCharacter: incomplete.length };
  assert.equal(readTypeScriptSourceCalls({ ...node, range }, incomplete, range, { maxNodes: 10000, maxDepth: 100 })!.limited, true);
});

test("a selected extent containing unowned trailing bytes is rejected rather than clamped", () => {
  const { text, node } = facts("return target(value);");
  assert.equal(readTypeScriptSourceCalls(node, text + " ", { ...node.range, endCharacter: text.length + 1 }, { maxNodes: 10000, maxDepth: 100 }), undefined);
});
