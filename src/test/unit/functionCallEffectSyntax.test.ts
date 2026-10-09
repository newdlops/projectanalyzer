/** Real parser fixtures preserve explicit calls/writes and lexical cleanup scope without successful effects or completion proof. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFunctionCallSourceSyntax, readFunctionCallReturnSyntax } from "../../analyzer/functionCalls";
import { loadFunctionCallReadingFixture } from "./helpers/functionCallReadingFixture";

async function fixture(language: "typescript" | "kotlin", body: string) {
  const source = (language === "kotlin" ? "fun addFee(value: Int): Int { " : "export function addFee(value: number): number { ") + body + " }";
  const parent = language === "kotlin" ? "fun checkout(amount: Int): Int { return addFee(amount) }"
    : 'import { addFee } from "./readingHelpers"; export function checkout(amount: number): number { return addFee(amount); }';
  const data = await loadFunctionCallReadingFixture(language, name => name === "readingHelpers" ? source : parent);
  return { source, callee: data.graph.nodes.find(node => node.name === "addFee")! };
}

for (const language of ["typescript", "kotlin"] as const) test(`${language} shares return/effect snapshot and keeps catch/finally syntax distinct`, async () => {
  const f = await fixture(language, language === "kotlin"
    ? "try { return value + 5 } catch (error: Exception) { return 0 } finally { audit(value) }"
    : "try { return value + 5; } catch (error) { return 0; } finally { audit(value); }");
  const syntax = readFunctionCallSourceSyntax(f.callee, f.source)!;
  assert.equal(syntax.effects.limited, false); assert.equal(syntax.effects.syntaxOnly, true);
  assert.deepEqual(syntax.returns, readFunctionCallReturnSyntax(f.callee, f.source));
  assert.deepEqual(syntax.effects.sites.map(site => [site.kind, site.code]), [["call", "audit(value)"]]);
  assert.deepEqual(syntax.effects.sites[0].regions.map(region => region.kind), ["finally"]);
  assert.ok(!Object.hasOwn(syntax.effects.sites[0], "result") && !Object.hasOwn(syntax.effects.sites[0], "observed"));
});

for (const language of ["typescript", "kotlin"] as const) test(`${language} writes/nested calls/repeated text retain every distinct authored occurrence`, async () => {
  const declaration = language === "kotlin" ? "val n = outer(inner(value))" : "const n = outer(inner(value));";
  const f = await fixture(language, declaration + (language === "kotlin" ? "\naudit(n)\naudit(n)\nreturn n" : " audit(n); audit(n); return n;"));
  const syntax = readFunctionCallSourceSyntax(f.callee, f.source)!;
  assert.equal(syntax.effects.limited, false);
  assert.equal(syntax.effects.sites.filter(site => site.kind === "write").length, 1);
  const calls = syntax.effects.sites.filter(site => site.kind === "call");
  assert.equal(calls.length, 4); assert.equal(calls.filter(site => site.code === "audit(n)").length, 2);
  assert.ok(calls.some(site => site.code === "outer(inner(value))") && calls.some(site => site.code === "inner(value)"));
  assert.notDeepEqual(calls.at(-1)!.range, calls.at(-2)!.range);
  assert.equal(readFunctionCallSourceSyntax(f.callee, f.source, { maxEffectSites: 2 })?.effects.limited, true);
});

test("nested callables, depth/source bounds and stale same-name selections never become complete effects", async () => {
  const f = await fixture("typescript", "function later() { audit(value); } return value;");
  assert.ok(!readFunctionCallSourceSyntax(f.callee, f.source)?.effects.sites.some(site => site.code.includes("audit(value)")), "nested declaration bodies cannot lend calls to the enclosing function");
  const callback = await fixture("typescript", "register(() => audit(value)); return value;");
  const callbackSyntax = readFunctionCallSourceSyntax(callback.callee, callback.source)!;
  assert.ok(callbackSyntax.effects.sites.some(site => site.code === "register(() => audit(value))"), "the authored registration expression retains callback syntax");
  assert.ok(!callbackSyntax.effects.sites.some(site => site.code === "audit(value)"), "a callback body cannot become a separate immediate call");
  const guarded = await fixture("typescript", "if (value > 0) { if (value < 10) { audit(value); } } return value;");
  assert.equal(readFunctionCallSourceSyntax(guarded.callee, guarded.source, { maxDepth: 1 })?.effects.limited, true);
  const long = await fixture("typescript", 'audit("' + "x".repeat(200) + '"); return value;');
  assert.equal(readFunctionCallSourceSyntax(long.callee, long.source)?.effects.limited, true);
  assert.equal(readFunctionCallSourceSyntax({ ...f.callee, selectionRange: { ...f.callee.selectionRange,
    startCharacter: f.callee.selectionRange.startCharacter + 1 } }, f.source), undefined);
});

test("writes inside returns/predicates/arguments never become a falsely complete no-write inventory", async () => {
  for (const body of ["return value++;", "if (value++ > 0) return value; return 0;", "audit(value = 2); return value;"]) {
    const f = await fixture("typescript", body);
    const effects = readFunctionCallSourceSyntax(f.callee, f.source)!.effects;
    assert.ok(effects.limited || effects.sites.some(site => site.kind === "write" && site.code.includes("value = 2")), body);
  }
});

test("an empty explicit inventory retains syntax-only semantics instead of proving no implicit effects", async () => {
  const f = await fixture("typescript", "return value.member;");
  const syntax = readFunctionCallSourceSyntax(f.callee, f.source)!;
  assert.equal(syntax.effects.limited, false); assert.deepEqual(syntax.effects.sites, []);
  assert.equal(syntax.effects.syntaxOnly, true);
});
