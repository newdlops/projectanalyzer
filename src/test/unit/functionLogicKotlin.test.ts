/**
 * Kotlin function integration contracts. Hand-checked source cases protect
 * cursor scope, expression exits, lexical values, and symbolic Tutor boundaries.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeFunctionLogic, findFunctionAtPosition } from "../../analyzer/functionLogic";
import type { FunctionLogicAnalysis } from "../../analyzer/functionLogic";
import { analyzeFunctionTutorDeclaration } from "../../analyzer/functionTutor";
import type { SymbolNode } from "../../shared/types";

const source = [
  "class Orders {",
  "  /** Accepts an order name and returns its source-backed result. */",
  "  fun submit(name: String?, enabled: Boolean = true): String {",
  "    val clean = name ?: return \"missing\"",
  "    if (!enabled) return \"disabled\"",
  "    val result = when (clean) {",
  "      \"draft\" -> \"queued\"",
  "      else -> save(clean)",
  "    }",
  "    return result",
  "  }",
  "  fun save(name: String): String = name",
  "}",
  "fun String.normalized(): String = if (isEmpty()) \"empty\" else this"
].join("\n");

test("Kotlin cursor chooses a member and an expression-bodied extension by source range", () => {
  const member = resolveAt(source, "return result");
  const extension = resolveAt(source, 'if (isEmpty())');
  assert.equal(member?.qualifiedName, "Orders.submit");
  assert.equal(member?.kind, "method");
  assert.equal(member?.selectionRange.startLine, 2);
  assert.equal(extension?.name, "normalized");
  assert.equal(extension?.language, "kotlin");
});

test("Kotlin Logic retains Elvis early exit and separate when result arms", () => {
  const logic = analyzeFunctionLogic({ functionNode: submitNode(), sourceText: source });
  assert.equal(logic.language, "kotlin");
  assert.ok(logic.blocks.some((block) => block.kind === "condition" && block.label.includes("name")));
  assert.ok(logic.blocks.some((block) => block.kind === "return" && block.label.includes('"missing"')));
  assert.ok(logic.blocks.some((block) => block.kind === "switch" && block.label.includes("clean")));
  assert.ok(logic.edges.some((edge) => edge.kind === "case" && edge.label?.includes('"draft"')));
  assert.ok(logic.callsites.some((call) => call.calleeName === "save"));
  assert.ok(logic.valueBindings?.some((binding) => binding.name === "clean" && binding.kind === "constant"));
  assert.ok(logic.valueBindings?.some((binding) => binding.name === "name" && binding.kind === "parameter"));
  const exits = new Set(logic.blocks.filter((block) => block.kind === "return").map((block) => block.id));
  assert.ok(logic.edges.some((edge) => exits.has(edge.sourceId) && edge.kind === "return"));
});

test("Kotlin Tutor reads nullable and default parameters without claiming concrete evaluation", () => {
  const functionNode = submitNode();
  const logic = analyzeFunctionLogic({ functionNode, sourceText: source });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode, sourceText: source, functionLogic: logic });
  assert.equal(declaration.language, "kotlin");
  assert.deepEqual(declaration.parameters.map((parameter) => parameter.name), ["name", "enabled"]);
  assert.equal(declaration.parameters[0].optional, false, "nullable is not an omitted argument");
  assert.equal(declaration.parameters[0].typeText, "String?");
  assert.equal(declaration.parameters[1].optional, true);
  assert.deepEqual(declaration.parameters[1].defaultValue, { kind: "boolean", value: true });
  const program = declaration.program as typeof declaration.program & { evaluationMode?: string };
  assert.equal(program.evaluationMode, "symbolic-only");
  assert.ok(declaration.gaps.some((gap) => gap.kind === "language-support"));
});

test("Kotlin while and do-while retain exact predicates and keep equal body calls outside the predicate", () => {
  for (const statement of ['while (value < 3) { value += 1 }', 'do { value += 1 } while (value < 3)']) {
    const text = 'fun inspect(amount: Int): Int {\n var value = amount\n ' + statement + '\n return value\n}';
    const node = { ...resolveAt(text, "var value")!, id: "function:kotlin-loop" };
    const logic = analyzeFunctionLogic({ functionNode: node, sourceText: text });
    const loop = logic.blocks.find(block => block.kind === "loop")!;
    assert.equal(loop.condition?.expression, "value < 3");
    assert.equal(loop.condition?.groupExpression, "value < 3");
    assert.ok(loop.valueAccesses?.some(access => access.name === "value" && access.access === "read"));
  }
  const text = 'fun inspect(): Int {\n while (ready()) {\n ready()\n }\n return 0\n}';
  const logic = analyzeFunctionLogic({ functionNode: { ...resolveAt(text, "while")!, id: "function:kotlin-loop-call" }, sourceText: text });
  const loop = logic.blocks.find(block => block.kind === "loop")!;
  assert.equal(logic.callsites.find(call => call.range.startLine === 1)?.blockId, loop.id);
  assert.notEqual(logic.callsites.find(call => call.range.startLine === 2)?.blockId, loop.id);
});

test("Kotlin local function selection does not merge its return into the parent", () => {
  const text = "fun outer(value: Int): Int {\n  fun inner() = 99\n  return value\n}";
  const inner = resolveAt(text, "99");
  const outer = resolveAt(text, "return value");
  assert.equal(inner?.qualifiedName, "outer.inner");
  assert.equal(outer?.name, "outer");
  assert.ok(outer);
  const node: SymbolNode = { ...outer, id: "outer", metadata: { cursorResolved: true } };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText: text });
  assert.ok(!logic.blocks.some((block) => block.kind === "return" && block.label.includes("99")));
});

const flowFixture = readFileSync(resolve(process.cwd(), "src/test/fixtures/functionLogic/kotlin_flow.kt"), "utf8");

test("Kotlin expression-bodied nested if/when returns only the selected arm", () => {
  const logic = fixtureLogic("select");
  const paths = acyclicPaths(logic);
  assert.equal(paths.length, 3);
  const terminalLabels = paths.map((path) => path.filter((id) => logic.blocks.find((block) => block.id === id)?.kind === "return")
    .map((id) => logic.blocks.find((block) => block.id === id)?.label));
  assert.ok(terminalLabels.every((labels) => labels.length === 1));
  assert.deepEqual(terminalLabels.flat().sort(), ['return "off"', 'return "other"', 'return "zero"']);
});

test("Kotlin if initializer records separate writes reaching the following return", () => {
  const logic = fixtureLogic("choose");
  const binding = logic.valueBindings?.find((candidate) => candidate.name === "result");
  assert.ok(binding);
  const writes = logic.blocks.filter((block) => block.valueChanges?.some((change) => change.target === "result"));
  assert.deepEqual(writes.map((block) => block.valueChanges?.[0].value).sort(), ["1", "2"]);
  const terminal = logic.blocks.find((block) => block.kind === "return");
  assert.ok(terminal);
  assert.deepEqual(new Set(logic.valueFlows?.filter((flow) => flow.bindingId === binding.id && flow.targetBlockId === terminal.id)
    .map((flow) => flow.sourceBlockId)), new Set(writes.map((block) => block.id)));
});

test("Kotlin safe-call plus Elvis has receiver-null, result-null, and selected-value routes", () => {
  const logic = fixtureLogic("optional");
  const paths = acyclicPaths(logic);
  assert.equal(paths.length, 3);
  assert.ok(logic.blocks.some((block) => block.condition?.expression === "user != null"));
  assert.ok(logic.blocks.some((block) => block.condition?.expression === "user?.fetch() != null"));
  const fetch = logic.callsites.find((call) => call.calleeName === "fetch");
  assert.ok(fetch?.blockId, "The nullable result test owns the call even on the Elvis fallback route.");
  const fetchPaths = paths.filter((path) => path.includes(fetch.blockId!));
  assert.equal(fetchPaths.length, 2);
  assert.ok(fetchPaths.some((path) => path.some((id) => logic.blocks.find((block) => block.id === id)?.label === "return missing()")));
  assert.ok(paths.every((path) => path.filter((id) => logic.blocks.find((block) => block.id === id)?.kind === "return").length === 1));
});

test("Kotlin post-test loop enters its body before evaluating its first condition", () => {
  const logic = fixtureLogic("repeated");
  const loop = logic.blocks.find((block) => block.kind === "loop" && block.label.startsWith("do /"));
  assert.ok(loop);
  const body = logic.blocks.find((block) => block.parentBlockId === loop.id);
  assert.ok(body);
  assert.ok(logic.edges.some((edge) => edge.targetId === body.id && edge.sourceId !== loop.id));
  assert.ok(logic.edges.some((edge) => edge.sourceId === body.id && edge.targetId === loop.id && edge.kind === "repeat"));
  const outer = logic.blocks.find((block) => block.kind === "loop" && block.label.startsWith("for"));
  assert.ok(outer);
  const jump = logic.blocks.find((block) => block.label === "continue@outer");
  assert.ok(jump);
  assert.ok(logic.edges.some((edge) => edge.sourceId === jump.id && edge.targetId === outer.id && edge.confidence === "exact"));
});

test("Kotlin try and catch both enter cleanup, and cleanup is not an entry choice", () => {
  const logic = fixtureLogic("cleanup");
  const release = logic.blocks.find((block) => block.label === "release()");
  const work = logic.blocks.find((block) => block.label === "work()");
  const failed = logic.blocks.find((block) => block.label === "failed(error)");
  const tryBlock = logic.blocks.find((block) => block.kind === "try");
  assert.ok(release && work && failed && tryBlock);
  assert.ok(logic.edges.some((edge) => edge.sourceId === work.id && edge.targetId === release.id));
  assert.ok(logic.edges.some((edge) => edge.sourceId === failed.id && edge.targetId === release.id));
  assert.ok(!logic.edges.some((edge) => edge.sourceId === tryBlock.id && edge.targetId === release.id));
});

test("Kotlin lambda/local/suspend scopes stay source-backed and symbolic", () => {
  const logic = fixtureLogic("scopes");
  assert.ok(!logic.callsites.some((call) => call.calleeName === "hidden"));
  assert.ok(logic.callsites.some((call) => call.calleeName === "forEach"));
  assert.ok(!logic.blocks.some((block) => block.kind === "return" && /88|99/u.test(block.label)));
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: logic.functionNode, sourceText: flowFixture, functionLogic: logic });
  assert.equal(declaration.program.evaluationMode, "symbolic-only");
  assert.ok(declaration.gaps.some((gap) => /suspend|scheduling/u.test(gap.summary)));
});

test("Kotlin mixed short-circuit expression preserves source predicate order", () => {
  const logic = fixtureLogic("mixed");
  const conditions = logic.blocks.filter((block) => block.kind === "condition");
  assert.deepEqual(conditions.map((block) => block.condition?.expression), ["a", "b", "c"]);
  const paths = acyclicPaths(logic);
  for (const path of paths) {
    const selected = path.filter((id) => conditions.some((block) => block.id === id));
    assert.equal(selected[0], conditions[0].id);
    assert.ok(selected.indexOf(conditions[1].id) < 0 || selected.indexOf(conditions[1].id) > selected.indexOf(conditions[0].id));
  }
});

test("Kotlin unresolved labels remain inferred instead of exact nearest-loop jumps", () => {
  const text = "fun labels() { while (active()) { break@missing } }";
  const target = resolveAt(text, "break@missing");
  assert.ok(target);
  const logic = analyzeFunctionLogic({ functionNode: { ...target, id: "labels" }, sourceText: text });
  const jump = logic.blocks.find((block) => block.kind === "break");
  assert.ok(jump);
  assert.ok(logic.edges.filter((edge) => edge.sourceId === jump.id).every((edge) => edge.confidence === "inferred"));
  assert.ok(logic.gaps.some((gap) => /labeled jump/u.test(gap.message)));
});

test("Kotlin Elvis condition consumes the nullable parameter on the early-exit route", () => {
  const logic = analyzeFunctionLogic({ functionNode: submitNode(), sourceText: source });
  const guard = logic.blocks.find((block) => block.condition?.expression === "name != null");
  assert.ok(guard);
  assert.ok(guard.valueAccesses?.some((access) => access.name === "name" && access.access === "read" && access.usage === "consume"));
});

test("Kotlin Tutor retains invocation effects inside initializer and return blocks", () => {
  const functionNode = submitNode();
  const logic = analyzeFunctionLogic({ functionNode, sourceText: source });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode, sourceText: source, functionLogic: logic });
  const saveArm = logic.blocks.find((block) => block.valueChanges?.some((change) => change.target === "result" && change.value === "save(clean)"));
  assert.ok(saveArm);
  const saveProgram = declaration.program.blocks.find((block) => block.blockId === saveArm.id);
  assert.ok(saveProgram?.operations.some((operation) => operation.kind === "effect" && operation.summary === "save()"));
  const optionalLogic = fixtureLogic("optional");
  const optional = analyzeFunctionTutorDeclaration({ functionNode: optionalLogic.functionNode, sourceText: flowFixture, functionLogic: optionalLogic });
  const missing = optionalLogic.blocks.find((block) => block.label === "return missing()");
  assert.ok(missing);
  assert.ok(optional.program.blocks.find((block) => block.blockId === missing.id)?.operations
    .some((operation) => operation.kind === "effect" && operation.summary === "missing()"));
});

test("Kotlin safe-call initializer writes both null and selected values on their own routes", () => {
  const text = "fun safe(user: User?): String? { val name = user?.name; return name }";
  const target = resolveAt(text, "val name");
  assert.ok(target);
  const logic = analyzeFunctionLogic({ functionNode: { ...target, id: "safe" }, sourceText: text });
  const binding = logic.valueBindings?.find((candidate) => candidate.name === "name");
  const terminal = logic.blocks.find((block) => block.kind === "return");
  assert.ok(binding && terminal);
  const writes = logic.blocks.filter((block) => block.valueChanges?.some((change) => change.target === "name"));
  assert.deepEqual(writes.map((block) => block.valueChanges?.[0].value).sort(), ["null", "user?.name"]);
  assert.deepEqual(new Set(logic.valueFlows?.filter((flow) => flow.bindingId === binding.id && flow.targetBlockId === terminal.id)
    .map((flow) => flow.sourceBlockId)), new Set(writes.map((block) => block.id)));
});

test("Kotlin chained safe calls skip later invocations when an earlier receiver is null", () => {
  const text = 'fun chained(root: Root?): String { return root?.one()?.two() ?: "missing" }';
  const target = resolveAt(text, "return root");
  assert.ok(target);
  const logic = analyzeFunctionLogic({ functionNode: { ...target, id: "chained" }, sourceText: text });
  const paths = acyclicPaths(logic);
  assert.equal(paths.length, 4);
  const one = logic.callsites.find((call) => call.calleeName === "one");
  const two = logic.callsites.find((call) => call.calleeName === "two");
  assert.ok(one?.blockId && two?.blockId);
  assert.equal(paths.filter((path) => path.includes(one.blockId!)).length, 3);
  assert.equal(paths.filter((path) => path.includes(two.blockId!)).length, 2);
});

test("Kotlin break inside when targets its surrounding loop", () => {
  const text = "fun stop(code: Int) { while (active()) { when (code) { 0 -> break; else -> tick() } }; done() }";
  const target = resolveAt(text, "while");
  assert.ok(target);
  const logic = analyzeFunctionLogic({ functionNode: { ...target, id: "stop" }, sourceText: text });
  const jump = logic.blocks.find((block) => block.kind === "break");
  const done = logic.blocks.find((block) => block.label === "done()");
  assert.ok(jump && done);
  assert.ok(logic.edges.some((edge) => edge.sourceId === jump.id && edge.targetId === done.id && edge.confidence === "exact"));
});

/** Opens a named declaration from a real Kotlin fixture through both public dispatchers. */
function fixtureLogic(name: string): FunctionLogicAnalysis {
  const target = resolveAt(flowFixture, `fun ${name}(`);
  assert.ok(target);
  return analyzeFunctionLogic({ functionNode: { ...target, id: `kotlin-${name}` }, sourceText: flowFixture });
}

/** Enumerates source routes with explicit depth, result, and per-path cycle guards. */
function acyclicPaths(logic: FunctionLogicAnalysis): string[][] {
  const entry = logic.blocks.find((block) => block.kind === "entry");
  assert.ok(entry);
  const pending = [{ path: [entry.id], seen: new Set([entry.id]) }];
  const results: string[][] = [];
  let visits = 0;
  while (pending.length && visits++ < 3000 && results.length < 100) {
    const state = pending.pop();
    assert.ok(state);
    const current = state.path.at(-1)!;
    const block = logic.blocks.find((candidate) => candidate.id === current);
    if (block?.kind === "exit") { results.push(state.path); continue; }
    if (state.path.length >= 50) continue;
    for (const edge of logic.edges.filter((candidate) => candidate.sourceId === current
      && candidate.kind !== "defines" && candidate.kind !== "deferred")) {
      if (state.seen.has(edge.targetId)) continue;
      pending.push({ path: [...state.path, edge.targetId], seen: new Set([...state.seen, edge.targetId]) });
    }
  }
  return results;
}

/** Produces an independent symbol fixture with the exact declaration name span. */
function submitNode(): SymbolNode {
  return {
    id: "orders-submit", kind: "method", name: "submit", qualifiedName: "Orders.submit",
    filePath: "/workspace/Orders.kt", language: "kotlin",
    range: { startLine: 2, startCharacter: 2, endLine: 10, endCharacter: 3 },
    selectionRange: { startLine: 2, startCharacter: 6, endLine: 2, endCharacter: 12 }
  };
}

/** Converts a marker to UTF-16 editor coordinates through the public dispatcher. */
function resolveAt(text: string, marker: string) {
  const offset = text.indexOf(marker);
  assert.ok(offset >= 0);
  const lines = text.slice(0, offset).split("\n");
  return findFunctionAtPosition({ filePath: "/workspace/Orders.kt", languageId: "kotlin", sourceText: text,
    position: { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 } });
}
