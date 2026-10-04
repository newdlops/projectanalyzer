/** Source-resolved helper safety tests: summaries retain parameter defaults and evaluation gaps. */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFunctionTutorInputs } from "../../analyzer/functionTutor";
import { buildInputModel } from "./helpers/neuralScenarioFixtures";

test("branching pure helpers and defaults keep their source return semantics", async () => {
  const model = await buildInputModel('function adjust(x: number, offset = 2) {\n let value = x + offset;\n if (value > 10) return value * 2;\n return value - 3;\n}\nexport function inspect(x: number) {\n const score = adjust(x);\n return score;\n}');
  for (const [input, expected] of [[3, 2], [20, 44]]) {
    const result = evaluateFunctionTutorInputs(model.declaration, [{ parameterId: model.declaration.parameters[0].id, value: { kind: "number", value: input } }]);
    assert.equal(result.status, "verified"); assert.deepEqual(result.terminal?.value, { kind: "number", value: expected });
  }
});

test("unused helper arguments and unused local calculations cannot erase unsupported evaluation", async () => {
  for (const source of [
    'function constant(x: number) {\n return 1;\n}\nexport function inspect(x: number) {\n return constant(external(x));\n}',
    'function constant(x: number) {\n const unused = 1 / x;\n return 1;\n}\nexport function inspect(x: number) {\n return constant(x);\n}',
    'function write(x: number) {\n external(x);\n return 1;\n}\nexport function inspect(x: number) {\n return write(x);\n}'
  ]) {
    const model = await buildInputModel(source);
    const result = evaluateFunctionTutorInputs(model.declaration, [{ parameterId: model.declaration.parameters[0].id, value: { kind: "number", value: 0 } }]);
    assert.equal(result.status, "partial");
  }
});

test("a derived or effectful helper default remains unknown instead of becoming undefined", async () => {
  for (const source of [
    'function helper(x = 2, y = x + 3) {\n return y;\n}\nexport function inspect(n: number) {\n return helper(n);\n}',
    'function helper(x = external()) {\n return x;\n}\nexport function inspect(n: number) {\n return helper();\n}'
  ]) {
    const model = await buildInputModel(source);
    const result = evaluateFunctionTutorInputs(model.declaration, [{ parameterId: model.declaration.parameters[0].id, value: { kind: "number", value: 5 } }]);
    assert.equal(result.status, "partial");
  }
});

test("a reassigned helper binding cannot verify the original declaration's result", async () => {
  for (const assignment of ['helper = (x: number) => x * 3;', '[helper] = [(x: number) => x * 3];']) {
    const model = await buildInputModel('function helper(x: number) {\n return x * 2;\n}\n' + assignment + '\nexport function inspect(n: number) {\n return helper(n);\n}');
    assert.equal(evaluateFunctionTutorInputs(model.declaration, [{ parameterId: model.declaration.parameters[0].id, value: { kind: "number", value: 5 } }]).status, "partial");
  }
});

test("a nested callable with the same name blocks top-level helper resolution", async () => {
  const model = await buildInputModel('function helper(x: number) {\n return x * 2;\n}\nexport function inspect(n: number) {\n function helper(x: number) {\n return x * 3;\n }\n return helper(n);\n}');
  assert.equal(evaluateFunctionTutorInputs(model.declaration, [{ parameterId: model.declaration.parameters[0].id, value: { kind: "number", value: 5 } }]).status, "partial");
});

test("more than four nested helpers stop at the source analysis depth limit", async () => {
  const source = 'function a(x: number) {\n return x + 1;\n}\nfunction b(x: number) {\n return a(x);\n}\nfunction c(x: number) {\n return b(x);\n}\nfunction d(x: number) {\n return c(x);\n}\nfunction e(x: number) {\n return d(x);\n}\nexport function inspect(x: number) {\n const leaf = b(x);\n return e(leaf);\n}';
  const model = await buildInputModel(source);
  assert.equal(evaluateFunctionTutorInputs(model.declaration, [{ parameterId: model.declaration.parameters[0].id, value: { kind: "number", value: 0 } }]).status, "partial");
  const reordered = { ...model.declaration, scenarioCatalog: { ...model.declaration.scenarioCatalog!, programs: model.declaration.scenarioCatalog!.programs.slice().sort((left, right) => left.declaration.functionNode.range!.startLine - right.declaration.functionNode.range!.startLine) } };
  assert.equal(evaluateFunctionTutorInputs(reordered, [{ parameterId: model.declaration.parameters[0].id, value: { kind: "number", value: 0 } }]).status, "partial", "catalog ordering cannot change the actual call-depth budget");
  const supported = await buildInputModel(source.replace("return e(leaf)", "return d(leaf)"));
  const result = evaluateFunctionTutorInputs(supported.declaration, [{ parameterId: supported.declaration.parameters[0].id, value: { kind: "number", value: 0 } }]);
  assert.equal(result.status, "verified"); assert.deepEqual(result.terminal?.value, { kind: "number", value: 2 });
});
