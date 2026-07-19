/**
 * Cursor-function resolver tests. They cover innermost selection, declaration
 * bindings, class callables, lambdas, JSX, Python, Java, and unsupported source.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { findFunctionAtPosition } from "../../analyzer/functionLogic";

const source = [
  "export function outer(input: number) {",
  "  const transform = (value: number) => {",
  "    return [value].map((item) => {",
  "      if (item > 0) return item * 2;",
  "      return item;",
  "    });",
  "  };",
  "  return transform(input);",
  "}",
  "",
  "class Service {",
  "  constructor(private readonly value: number) {}",
  "  get doubled() { return this.value * 2; }",
  "  run() { return this.doubled; }",
  "}"
].join("\n");

test("selects a variable-bound arrow from its binding and the outer function elsewhere", () => {
  const bindingTarget = resolveAt(source, "transform =");
  const outerTarget = resolveAt(source, "return transform(input)");

  assert.equal(bindingTarget?.name, "transform");
  assert.equal(bindingTarget?.kind, "function");
  assert.equal(bindingTarget?.range.startLine, 1);
  assert.equal(bindingTarget?.selectionRange.startCharacter, 8);
  assert.equal(outerTarget?.name, "outer");
});

test("prefers the innermost anonymous callback over both enclosing functions", () => {
  const target = resolveAt(source, "if (item > 0)");

  assert.equal(target?.name, "anonymous function");
  assert.equal(target?.anonymous, true);
  assert.match(target?.qualifiedName ?? "", /^outer\.transform\.<anonymous@3:/u);
  assert.equal(target?.range.startLine, 2);
  assert.equal(target?.range.endLine, 5);
});

test("preserves constructor, accessor, and method callable roles", () => {
  const constructorTarget = resolveAt(source, "private readonly value");
  const accessorTarget = resolveAt(source, "return this.value * 2");
  const methodTarget = resolveAt(source, "return this.doubled");

  assert.deepEqual(
    [constructorTarget?.kind, constructorTarget?.name],
    ["constructor", "constructor"]
  );
  assert.deepEqual([accessorTarget?.kind, accessorTarget?.name], ["method", "doubled"]);
  assert.deepEqual([methodTarget?.kind, methodTarget?.name], ["method", "run"]);
  assert.equal(methodTarget?.qualifiedName, "Service.run");
});

test("parses JSX language modes and still chooses a nested event callback", () => {
  const jsx = [
    "const Card = () => (",
    "  <button onClick={() => submit()}>Save</button>",
    ");"
  ].join("\n");
  const target = resolveAt(jsx, "submit()", "typescriptreact", "/workspace/Card.tsx");

  assert.equal(target?.anonymous, true);
  assert.match(target?.qualifiedName ?? "", /^Card\.<anonymous@2:/u);
});

test("selects Python methods, constructors, and the innermost named lambda", () => {
  const python = [
    "class Service:",
    "    def __init__(self, value):",
    "        self.value = value",
    "",
    "    def run(self, items):",
    "        transform = lambda item: self.save(item)",
    "        return [transform(item) for item in items]"
  ].join("\n");
  const constructor = resolveAt(
    python,
    "self.value",
    "python",
    "/workspace/service.py"
  );
  const method = resolveAt(
    python,
    "return [transform",
    "python",
    "/workspace/service.py"
  );
  const lambda = resolveAt(
    python,
    "self.save(item)",
    "python",
    "/workspace/service.py"
  );

  assert.deepEqual([constructor?.kind, constructor?.name], ["constructor", "__init__"]);
  assert.equal(method?.qualifiedName, "Service.run");
  assert.deepEqual([lambda?.kind, lambda?.name], ["function", "transform"]);
  assert.equal(lambda?.qualifiedName, "Service.run.transform");
});

test("selects Java constructors, methods, and the innermost named lambda", () => {
  const java = [
    "class Service {",
    "  Service(int value) { this.value = value; }",
    "  int run(int input) {",
    "    java.util.function.Function<Integer, Integer> transform =",
    "      value -> save(value);",
    "    return transform.apply(input);",
    "  }",
    "}"
  ].join("\n");
  const constructor = resolveAt(
    java,
    "this.value",
    "java",
    "/workspace/Service.java"
  );
  const method = resolveAt(
    java,
    "return transform",
    "java",
    "/workspace/Service.java"
  );
  const lambda = resolveAt(
    java,
    "save(value)",
    "java",
    "/workspace/Service.java"
  );

  assert.deepEqual([constructor?.kind, constructor?.name], ["constructor", "Service"]);
  assert.equal(method?.qualifiedName, "Service.run");
  assert.deepEqual([lambda?.kind, lambda?.name], ["function", "transform"]);
  assert.equal(lambda?.qualifiedName, "Service.run.transform");
});

test("returns no target outside a callable or for an unsupported language", () => {
  const outside = resolveAt("import { value } from './value';\nfunction run() {}", "import");
  const rust = resolveAt("fn run() {\n    true\n}", "true", "rust", "/workspace/run.rs");

  assert.equal(outside, undefined);
  assert.equal(rust, undefined);
});

/** Resolves the first occurrence of a marker into zero-based editor coordinates. */
function resolveAt(
  content: string,
  marker: string,
  languageId = "typescript",
  filePath = "/workspace/source.ts"
) {
  const offset = content.indexOf(marker);
  assert.notEqual(offset, -1, `missing marker: ${marker}`);
  const before = content.slice(0, offset);
  const lines = before.split("\n");
  return findFunctionAtPosition({
    filePath,
    languageId,
    sourceText: content,
    position: {
      line: lines.length - 1,
      character: lines.at(-1)?.length ?? 0
    }
  });
}
