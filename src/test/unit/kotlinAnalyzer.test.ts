/** Kotlin graph fixtures protect lexical ownership and conservative direct-call resolution. */
import assert from "node:assert/strict";
import test from "node:test";
import { KotlinAnalyzer } from "../../analyzer/languages/kotlin";
import { createContentHash } from "../../shared/hash";
import { createNodeId } from "../../shared/ids";
import type { GraphEdge, SourceFile, SymbolNode } from "../../shared/types";

test("Kotlin graph extracts class/interface/object and bodyless function symbols", async () => {
  const file = createFile("Owners.kt", [
    "interface Contract { fun run(value: Int): Int }",
    "class Service { fun run(value: Int) = value }",
    "object Singleton { fun start() = 1 }"
  ].join("\n"));
  const { symbols } = await analyze([file]);
  assert.deepEqual(symbols.map((node) => [node.kind, node.qualifiedName]), [
    ["interface", "Contract"], ["method", "Contract.run"],
    ["class", "Service"], ["method", "Service.run"],
    ["class", "Singleton"], ["method", "Singleton.start"]
  ]);
  const service = symbols.find((node) => node.qualifiedName === "Service")!;
  const run = symbols.find((node) => node.qualifiedName === "Service.run")!;
  assert.equal(run.parentId, service.id);
  assert.equal(run.id, createNodeId(["symbol", "/workspace/Owners.kt", "method", "Service.run", "1", "20"]));
});

test("Kotlin graph resolves lexical local/member calls and preserves cycles/repeated ranges", async () => {
  const file = createFile("Calls.kt", [
    "class Service {",
    "  fun helper(value: Int) = value",
    "  fun run() {",
    "    fun local(value: Int = 1) = helper(value)",
    "    local()", "    helper(1)", "    helper(2)", "  }", "}",
    "fun cycle() { cycle() }"
  ].join("\n"));
  const { symbols, edges } = await analyze([file]);
  const names = new Map(symbols.map((node) => [node.id, node.qualifiedName]));
  assert.deepEqual(edges.map((edge) => [names.get(edge.sourceId), names.get(edge.targetId)]), [
    ["Service.run", "Service.run.local"], ["Service.run", "Service.helper"],
    ["Service.run", "Service.helper"], ["Service.run.local", "Service.helper"], ["cycle", "cycle"]
  ]);
  assert.equal(new Set(edges.map((edge) => edge.id)).size, edges.length);
  assert.ok(edges.every((edge) => edge.confidence === "resolved"));
});

test("Kotlin graph leaves overloads, receiver calls, shadowed values and deferred bodies unresolved", async () => {
  const file = createFile("Ambiguous.kt", [
    "fun helper(value: Int) = value", "fun helper(value: String) = value",
    "fun hidden() = 1", "fun shadowed() = 1", "fun String.extension() = length",
    "fun run(shadowed: () -> Int) {", "  helper(1)", "  other.hidden()",
    "  shadowed()", "  \"text\".extension()", "  val action = { hidden() }", "}"
  ].join("\n"));
  const { edges } = await analyze([file]);
  assert.deepEqual(edges, []);
});

test("Kotlin graph resolves package/import top-level functions and .kts declarations", async () => {
  const helper = createFile("Helper.kt", "package library\nfun helper(value: Int = 1) = value\n");
  const app = createFile("App.kts", "import library.helper\nfun start() = helper()\n");
  const unrelated = createFile("Other.kt", "package elsewhere\nfun helper() = 2\n");
  const { symbols, edges } = await analyze([helper, app, unrelated]);
  const start = symbols.find((node) => node.filePath.endsWith("App.kts") && node.name === "start")!;
  const target = symbols.find((node) => node.filePath.endsWith("Helper.kt") && node.name === "helper")!;
  assert.equal(edges.length, 1);
  assert.equal(edges[0].sourceId, start.id);
  assert.equal(edges[0].targetId, target.id);
});

test("Kotlin local symbols cannot escape a sibling overload scope", async () => {
  const file = createFile("LocalOverloads.kt", [
    "fun outer(value: Int) { fun hidden() = value; hidden() }",
    "fun outer(value: String) { hidden() }"
  ].join("\n"));
  const { symbols, edges } = await analyze([file]);
  const first = symbols.find((node) => node.name === "outer" && node.selectionRange.startLine === 0)!;
  assert.equal(edges.length, 1);
  assert.equal(edges[0].sourceId, first.id);
});

test("Kotlin explicit import aliases resolve to their declared symbol", async () => {
  const helper = createFile("AliasHelper.kt", "package library\nfun helper() = 1");
  const app = createFile("AliasApp.kt", "import library.helper as invoke\nfun run() = invoke()");
  const { symbols, edges } = await analyze([helper, app]);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].targetId, symbols.find((node) => node.name === "helper")!.id);
});

test("Kotlin local functions stay inside their declaring branch block", async () => {
  const file = createFile("BranchScope.kt", [
    "fun helper() = 1", "fun outer(flag: Boolean) {", "  if (flag) {",
    "    fun helper() = 2", "    helper()", "  }", "  helper()", "}"
  ].join("\n"));
  const { symbols, edges } = await analyze([file]);
  const byId = new Map(symbols.map((node) => [node.id, node]));
  assert.deepEqual(edges.map((edge) => [edge.range?.startLine,
    byId.get(edge.targetId)?.selectionRange.startLine]), [[4, 3], [6, 0]]);
});

test("Kotlin sibling blocks resolve their own locals and restore the outside function", async () => {
  const file = createFile("SiblingBlocks.kt", [
    "fun helper() = 1", "fun outer(flag: Boolean) {", "  if (flag) {",
    "    fun helper() = 2", "    helper()", "  }", "  if (!flag) {",
    "    fun helper() = 3", "    helper()", "  }", "  helper()", "}"
  ].join("\n"));
  const { symbols, edges } = await analyze([file]);
  const byId = new Map(symbols.map((node) => [node.id, node]));
  assert.deepEqual(edges.map((edge) => [edge.range?.startLine,
    byId.get(edge.targetId)?.selectionRange.startLine]), [[4, 3], [8, 7], [10, 0]]);
});

test("Kotlin nested block locals shadow only calls within their lexical range", async () => {
  const file = createFile("NestedBlocks.kt", [
    "fun outer(flag: Boolean) {", "  fun helper() = 1", "  helper()", "  if (flag) {",
    "    fun helper() = 2", "    helper()", "    if (flag) { helper() }", "  }", "  helper()", "}"
  ].join("\n"));
  const { symbols, edges } = await analyze([file]);
  const byId = new Map(symbols.map((node) => [node.id, node]));
  assert.deepEqual(edges.map((edge) => [edge.range?.startLine,
    byId.get(edge.targetId)?.selectionRange.startLine]), [[2, 1], [5, 4], [6, 4], [8, 1]]);
});

test("Kotlin member extension this calls cannot target the lexical Host receiver", async () => {
  const file = createFile("MemberExtensionThis.kt", [
    "class Subject { fun save() = 1 }",
    "class Host { fun save() = 2; fun Subject.run() = this.save() }"
  ].join("\n"));
  const { edges } = await analyze([file]);
  assert.deepEqual(edges, []);
});

test("Kotlin member extension implicit receiver calls stay unresolved across local functions", async () => {
  const file = createFile("MemberExtensionImplicit.kt", [
    "class Subject { fun save() = 1 }", "class Host {", "  fun save() = 2",
    "  fun Subject.run() {", "    fun local() = save()", "    save()", "    local()", "  }", "}"
  ].join("\n"));
  const { symbols, edges } = await analyze([file]);
  const byId = new Map(symbols.map((node) => [node.id, node]));
  assert.deepEqual(edges.map((edge) => [byId.get(edge.sourceId)?.qualifiedName,
    byId.get(edge.targetId)?.qualifiedName]), [["Host.Subject.run", "Host.Subject.run.local"]]);
});

test("Kotlin nested functions do not target a top-level function shadowed by a captured parameter", async () => {
  const file = createFile("CapturedParameter.kt", [
    "fun helper() = 1", "fun outer(helper: () -> Int) {",
    "  fun local() = helper()", "  local()", "}"
  ].join("\n"));
  const { symbols, edges } = await analyze([file]);
  const byId = new Map(symbols.map((node) => [node.id, node]));
  assert.deepEqual(edges.map((edge) => [byId.get(edge.sourceId)?.qualifiedName,
    byId.get(edge.targetId)?.qualifiedName]), [["outer", "outer.local"]]);
});

test("Kotlin nested functions keep captured callable values unresolved", async () => {
  const file = createFile("CapturedValue.kt", [
    "fun helper() = 1", "fun outer() {", "  val helper = { 2 }",
    "  fun local() = helper()", "  local()", "}"
  ].join("\n"));
  const { symbols, edges } = await analyze([file]);
  const byId = new Map(symbols.map((node) => [node.id, node]));
  assert.deepEqual(edges.map((edge) => [byId.get(edge.sourceId)?.qualifiedName,
    byId.get(edge.targetId)?.qualifiedName]), [["outer", "outer.local"]]);
});

/** Creates source snapshots with genuine content hashes, matching the common pipeline. */
function createFile(name: string, content: string): SourceFile {
  return { path: `/workspace/${name}`, languageId: "kotlin", content,
    sizeBytes: Buffer.byteLength(content), contentHash: createContentHash(content) };
}

/** Exercises parser/symbol/call extraction together rather than mocking the syntax boundary. */
async function analyze(files: SourceFile[]): Promise<{ symbols: SymbolNode[]; edges: GraphEdge[] }> {
  const analyzer = new KotlinAnalyzer();
  const symbols: SymbolNode[] = [];
  const edges: GraphEdge[] = [];
  for (const file of files) {
    const parsed = await analyzer.parse(file);
    symbols.push(...await analyzer.extractSymbols(parsed));
    edges.push(...await analyzer.extractEdges(parsed, { sourceFiles: files, workspaceRoot: "/workspace" }));
  }
  return { symbols, edges };
}
