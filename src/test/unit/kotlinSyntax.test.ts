/** Kotlin parser boundary fixtures protect lexical scopes, UTF-16 ranges, and budgets. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  collectKotlinCallables, collectKotlinCalls, disposeKotlinSyntaxCache,
  findKotlinDescendants, getKotlinBodyStatements, getKotlinSyntaxCacheStats,
  invalidateKotlinSyntaxCache, kotlinNodeRange, kotlinNodeText, kotlinPositionOffset,
  parseKotlinSource, setKotlinSyntaxCachePreferredPath
} from "../../analyzer/languages/kotlin";

test("Kotlin official grammar preserves function, local, extension, and owner facts", () => {
  const text = fs.readFileSync(path.resolve(__dirname, "../../../src/test/fixtures/kotlin/Declarations.kt"), "utf8");
  const source = parseKotlinSource(text, "/workspace/Declarations.kt");
  assert.deepEqual(source.diagnostics, []);
  assert.deepEqual(collectKotlinCallables(source).map((callable) => ({
    name: callable.qualifiedName, kind: callable.kind, expression: callable.expressionBody,
    owner: callable.lexicalTypeOwner, receiver: callable.receiverType,
    suspend: callable.suspend, parameters: callable.parameters.map((parameter) => ({
      name: parameter.name, type: parameter.typeText, default: parameter.defaultText,
      vararg: parameter.vararg === true
    }))
  })), [
    { name: "Service.helper", kind: "method", expression: true, owner: "Service", receiver: undefined, suspend: false,
      parameters: [{ name: "value", type: "Int", default: undefined, vararg: false }] },
    { name: "Service.run", kind: "method", expression: false, owner: "Service", receiver: undefined, suspend: true,
      parameters: [{ name: "name", type: "String?", default: "null", vararg: false },
        { name: "values", type: "Int", default: undefined, vararg: true }] },
    { name: "Service.run.local", kind: "function", expression: true, owner: "Service", receiver: undefined, suspend: false,
      parameters: [{ name: "value", type: "Int", default: "1", vararg: false }] },
    { name: "String.decorate", kind: "function", expression: true, owner: "", receiver: "String", suspend: false,
      parameters: [{ name: "suffix", type: "String", default: "\"!\"", vararg: false }] },
    { name: "Singleton.start", kind: "method", expression: true, owner: "Singleton", receiver: undefined, suspend: false,
      parameters: [] }
  ]);
});

test("Kotlin call facts prune local function, lambda, and object execution scopes", () => {
  const source = parseKotlinSource([
    "fun outer() {", "  fun local() = hidden()", "  val action = { deferred() }",
    "  val objectValue = object { fun member() = ignored() }", "  direct(nested())",
    "  list.forEach { deferredAgain() }", "}"
  ].join("\n"), "/workspace/Calls.kt");
  assert.deepEqual(source.diagnostics, []);
  const outer = collectKotlinCallables(source)[0];
  assert.deepEqual(getKotlinBodyStatements(outer.body).map((node) => node.name),
    ["statement", "statement", "statement", "statement", "statement"]);
  assert.deepEqual(collectKotlinCalls(source, outer.body).map((call) =>
    [call.calleeText, call.argumentCount]), [["direct", 1], ["nested", 0], ["list.forEach", 1]]);
});

test("Kotlin UTF-16 ranges include Korean, emoji, CRLF, and string-owned fake syntax", () => {
  const text = "// 😀 가짜 fun ignored() {}\r\nfun 한글(이름: String = \"😀\"): String {\r\n  val 문장 = \"\"\"if (fake) { when } 😀\"\"\"\r\n  return 이름\r\n}\r\n";
  const source = parseKotlinSource(text, "/workspace/Unicode.kt");
  assert.deepEqual(source.diagnostics, []);
  const callable = collectKotlinCallables(source)[0];
  assert.equal(callable.name, "한글");
  assert.equal(kotlinNodeText(source, callable.node), text.slice(text.indexOf("fun 한글"), text.lastIndexOf("}") + 1));
  assert.deepEqual(kotlinNodeRange(source, callable.node),
    { startLine: 1, startCharacter: 0, endLine: 4, endCharacter: 1 });
  assert.equal(kotlinPositionOffset(source, { line: 1, character: 4 }), callable.selectionFrom);
  assert.equal(findKotlinDescendants(callable.body, (node) => node.name === "ifExpression").length, 0);
  assert.ok(Object.isFrozen(source) && Object.isFrozen(source.root) && Object.isFrozen(source.root.children));
});

test("Kotlin script entry accepts declarations beside executable script statements", () => {
  const source = parseKotlinSource("println(\"start\")\nfun declared() = 1\n", "/workspace/task.kts");
  assert.deepEqual(source.diagnostics, []);
  assert.equal(source.root.name, "script");
  assert.deepEqual(collectKotlinCallables(source).map((item) => item.name), ["declared"]);
});

test("Kotlin parser errors and token/nesting limits are explicit instead of thrown", () => {
  assert.ok(parseKotlinSource("fun broken( {", "/workspace/Broken.kt").diagnostics
    .some((diagnostic) => diagnostic.code === "syntax-error"));
  const nested = `fun deep() = ${"(".repeat(129)}1${")".repeat(129)}`;
  assert.ok(parseKotlinSource(nested, "/workspace/Deep.kt").diagnostics
    .some((diagnostic) => diagnostic.code === "nesting-limit"));
  const tokens = "val x = 1;\n".repeat(20000);
  assert.ok(parseKotlinSource(tokens, "/workspace/Tokens.kts").diagnostics
    .some((diagnostic) => diagnostic.code === "token-limit"));
});

test("Kotlin cache shares dirty source snapshots and releases bounded entries", () => {
  disposeKotlinSyntaxCache();
  const first = parseKotlinSource("fun one() = 1", "/workspace/A.kt");
  assert.equal(parseKotlinSource("fun one() = 1", "/workspace/A.kt"), first);
  assert.notEqual(parseKotlinSource("fun one() = 2", "/workspace/A.kt"), first);
  assert.equal(getKotlinSyntaxCacheStats().entries, 1);
  for (let index = 0; index < 12; index += 1) {
    parseKotlinSource(`fun function${index}() = ${index}`, `/workspace/File${index}.kt`);
  }
  assert.equal(getKotlinSyntaxCacheStats().entries, 8);
  assert.ok(getKotlinSyntaxCacheStats().sourceBytes <= 2 * 1024 * 1024);
  invalidateKotlinSyntaxCache("/workspace/File11.kt");
  assert.equal(getKotlinSyntaxCacheStats().entries, 7);
  disposeKotlinSyntaxCache();
  assert.equal(getKotlinSyntaxCacheStats().entries, 0);
});

test("Kotlin public module keeps generated grammar and ANTLR unloaded before first parse", () => {
  const modulePath = path.resolve(__dirname, "../../analyzer/languages/kotlin/index.js");
  const result = spawnSync(process.execPath, ["-e", [
    "const api=require(process.argv[1]);",
    "console.log(JSON.stringify({stats:api.getKotlinSyntaxCacheStats(),",
    "loaded:Object.keys(require.cache).some(key=>/antlr4|kotlinParserRuntime|KotlinLexer|KotlinParser/.test(key))}));"
  ].join(""), modulePath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    stats: { entries: 0, sourceBytes: 0, parseCount: 0, parserLoads: 0 }, loaded: false
  });
});

test("Kotlin cache evicts source text above two MiB and keeps the recently selected root", () => {
  disposeKotlinSyntaxCache();
  const text = `// ${"가".repeat(105000)}\nfun one() = 1`;
  const current = parseKotlinSource(text, "/workspace/Current.kt");
  for (let index = 0; index < 8; index += 1) {
    parseKotlinSource(text, `/workspace/Budget${index}.kt`);
    parseKotlinSource(text, "/workspace/Current.kt");
  }
  assert.equal(parseKotlinSource(text, "/workspace/Current.kt"), current);
  assert.ok(getKotlinSyntaxCacheStats().entries < 8);
  assert.ok(getKotlinSyntaxCacheStats().sourceBytes <= 2 * 1024 * 1024);
  disposeKotlinSyntaxCache();
});

test("Kotlin cache keeps the selected editor root while workspace files replace older snapshots", () => {
  disposeKotlinSyntaxCache();
  setKotlinSyntaxCachePreferredPath("/workspace/Selected.kt");
  const selected = parseKotlinSource("fun selected() = 1", "/workspace/Selected.kt");
  for (let index = 0; index < 12; index += 1) {
    parseKotlinSource(`fun workspace${index}() = 1`, `/workspace/Workspace${index}.kt`);
  }
  assert.equal(parseKotlinSource("fun selected() = 1", "/workspace/Selected.kt"), selected);
  assert.equal(getKotlinSyntaxCacheStats().entries, 8);
  disposeKotlinSyntaxCache();
});

test("Kotlin callee text preserves escaped names and strips grammar trivia for generic calls", () => {
  const source = parseKotlinSource("fun run() { `has space` /* outer /* nested */ comment */ (); generic<Int>(1); factory().run() }", "/workspace/Names.kt");
  assert.deepEqual(source.diagnostics, []);
  const callable = collectKotlinCallables(source)[0];
  assert.deepEqual(collectKotlinCalls(source, callable.body).map((call) => [call.calleeText, call.calleeName]), [
    ["`has space`", "has space"], ["generic", "generic"], ["factory", "factory"], ["factory().run", "run"]
  ]);
});

test("Kotlin descendant queries honor scope pruning and caller-supplied depth bounds", () => {
  const source = parseKotlinSource("fun outer() { fun local() = inner(); outerCall() }", "/workspace/Depth.kt");
  const callable = collectKotlinCallables(source)[0];
  assert.equal(findKotlinDescendants(callable.body, (node) => node.name === "callSuffix", undefined, 1).length, 0);
  assert.equal(findKotlinDescendants(callable.body, (node) => node.name === "callSuffix",
    (node) => node.name === "functionDeclaration").length, 1);
});

test("Kotlin calls within the accepted delimiter depth retain invocation evidence", () => {
  const source = parseKotlinSource(`fun nested() = ${"(".repeat(120)}inner()${")".repeat(120)}`, "/workspace/AcceptedDepth.kt");
  assert.deepEqual(source.diagnostics, []);
  const callable = collectKotlinCallables(source)[0];
  assert.deepEqual(collectKotlinCalls(source, callable.body).map((call) => call.calleeName), ["inner"]);
});

test("Kotlin deeply nested generic types hit the token nesting guard before parser lookahead", () => {
  const modulePath = path.resolve(__dirname, "../../analyzer/languages/kotlin/index.js");
  // An isolated deadline prevents a removed guard from hanging the whole suite.
  const result = spawnSync(process.execPath, ["-e", [
    "const api=require(process.argv[1]);",
    "const source=api.parseKotlinSource('fun deep(value: '+'List<'.repeat(1600)+'Int'+'>'.repeat(1600)+') = 1','/workspace/GenericDepth.kt');",
    "console.log(JSON.stringify({codes:source.diagnostics.map(item=>item.code),children:source.root.children.length}));"
  ].join(""), modulePath], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { codes: ["nesting-limit"], children: 0 });
});

test("Kotlin comparison angles do not accumulate across independent conditions", () => {
  const source = parseKotlinSource(`fun compare(value: Int) { ${"if (value<1) tick(); ".repeat(140)} }`, "/workspace/ComparisonDepth.kt");
  assert.deepEqual(source.diagnostics, []);
  assert.equal(collectKotlinCalls(source, collectKotlinCallables(source)[0].body).length, 140);
});
