/**
 * Python context-manager Function Logic regression tests. They keep each with
 * header separate from its body and verify continuation after context exit.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  analyzeFunctionLogic,
  type FunctionLogicAnalysis,
  type FunctionLogicBlock
} from "../../analyzer/functionLogic";
import type { SymbolNode } from "../../shared/types";

const projectRoot = path.resolve(__dirname, "../../..");
const fixturePath = path.join(
  projectRoot,
  "src/test/fixtures/functionLogic/python_with_workflow.py"
);
const sourceText = fs.readFileSync(fixturePath, "utf8");

test("separates a Python with header, body statements, and following continuation", () => {
  const analysis = analyzeFixtureFunction("read_document");
  const withBlock = findBlock(analysis, (block) => block.label.startsWith("with "));
  const readBlock = findBlock(analysis, (block) => block.label.includes("resource.read()"));
  const validateBlock = findBlock(analysis, (block) => block.label.includes("validate_payload"));
  const publishBlock = findBlock(analysis, (block) => block.label.includes("publish_payload"));

  assert.equal(withBlock.kind, "try");
  assert.equal(
    withBlock.label,
    "with open_resource(path) as resource, acquire_lock(path)"
  );
  assert.doesNotMatch(withBlock.label, /resource\.read|validate_payload|\n/u);
  assert.equal(readBlock.depth, withBlock.depth + 1);
  assert.equal(validateBlock.depth, withBlock.depth + 1);
  assert.equal(publishBlock.depth, withBlock.depth);
  assertEdge(analysis, withBlock, readBlock, "next", "with body");
  assertEdge(analysis, readBlock, validateBlock, "next");
  assertEdge(analysis, validateBlock, publishBlock, "next");
  assertCallsites(analysis, [
    "open_resource",
    "acquire_lock",
    "resource.read",
    "validate_payload",
    "publish_payload"
  ]);
});

test("separates an async with header without swallowing awaited body calls", () => {
  const analysis = analyzeFixtureFunction("sync_remote_document");
  const withBlock = findBlock(analysis, (block) => block.label.startsWith("async with "));
  const fetchBlock = findBlock(analysis, (block) => block.label.includes("session.fetch()"));
  const persistBlock = findBlock(analysis, (block) => block.label.includes("session.persist"));
  const notifyBlock = findBlock(analysis, (block) => block.label.includes("client.notify"));

  assert.equal(withBlock.kind, "try");
  assert.equal(withBlock.label, "async with client.session(key) as session");
  assert.doesNotMatch(withBlock.label, /session\.fetch|session\.persist|\n/u);
  assert.equal(fetchBlock.depth, withBlock.depth + 1);
  assert.equal(persistBlock.depth, withBlock.depth + 1);
  assert.equal(notifyBlock.depth, withBlock.depth);
  assertEdge(analysis, withBlock, fetchBlock, "next", "with body");
  assertEdge(analysis, fetchBlock, persistBlock, "next");
  assertEdge(analysis, persistBlock, notifyBlock, "next");
  assertCallsites(analysis, [
    "client.session",
    "session.fetch",
    "session.persist",
    "client.notify"
  ]);
});

/** Runs the public analyzer with an exact fixture-backed Python symbol. */
function analyzeFixtureFunction(name: string): FunctionLogicAnalysis {
  const declarationPattern = new RegExp(`(?:async\\s+)?def\\s+${name}\\b`, "u");
  const match = declarationPattern.exec(sourceText);
  assert.ok(match, `missing ${name} fixture declaration`);
  const nameOffset = sourceText.indexOf(name, match.index);
  const lineStart = sourceText.lastIndexOf("\n", nameOffset - 1) + 1;
  const startLine = sourceText.slice(0, lineStart).split("\n").length - 1;
  const startCharacter = nameOffset - lineStart;
  return analyzeFunctionLogic({
    functionNode: createPythonFunctionNode(name, startLine, startCharacter),
    sourceText
  });
}

/** Creates one source-backed Python function identity for analyzer matching. */
function createPythonFunctionNode(
  name: string,
  startLine: number,
  startCharacter: number
): SymbolNode {
  const selectionRange = {
    startLine,
    startCharacter,
    endLine: startLine,
    endCharacter: startCharacter + name.length
  };
  return {
    id: `function:${name}`,
    kind: "function",
    name,
    qualifiedName: name,
    filePath: fixturePath,
    range: selectionRange,
    selectionRange,
    language: "python"
  };
}

/** Returns the one expected visible block with a focused failure message. */
function findBlock(
  analysis: FunctionLogicAnalysis,
  predicate: (block: FunctionLogicBlock) => boolean
): FunctionLogicBlock {
  const block = analysis.blocks.find(predicate);
  assert.ok(block, "expected Function Logic block was not produced");
  return block;
}

/** Verifies one exact directed CFG edge and its optional branch label. */
function assertEdge(
  analysis: FunctionLogicAnalysis,
  source: FunctionLogicBlock,
  target: FunctionLogicBlock,
  kind: string,
  label?: string
): void {
  assert.ok(analysis.edges.some((edge) =>
    edge.sourceId === source.id
      && edge.targetId === target.id
      && edge.kind === kind
      && edge.label === label
  ), `missing ${kind} edge from ${source.label} to ${target.label}`);
}

/** Asserts that context, body, and continuation calls remain source-backed. */
function assertCallsites(
  analysis: FunctionLogicAnalysis,
  expectedCalleeTexts: string[]
): void {
  assert.deepEqual(
    analysis.callsites.map((callsite) => callsite.calleeText),
    expectedCalleeTexts
  );
}
