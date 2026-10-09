/** Real parser evidence retains lexical returns/catch regions while whole source proof still refuses unsupported control semantics. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFunctionCallReturnSyntax, createFunctionCallSourceReader } from "../../analyzer/functionCalls";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { loadFunctionCallReadingFixture } from "./helpers/functionCallReadingFixture";
import type { SymbolNode } from "../../shared/types";

async function fixture(language: "typescript" | "kotlin", body: string) {
  const source = (language === "kotlin" ? "fun addFee(value: Int): Int { " : "export function addFee(value: number): number { ") + body + " }";
  const parent = language === "kotlin" ? "fun checkout(amount: Int): Int { return addFee(amount) }"
    : 'import { addFee } from "./readingHelpers"; export function checkout(amount: number): number { return addFee(amount); }';
  const data = await loadFunctionCallReadingFixture(language, name => name === "readingHelpers" ? source : parent);
  return { ...data, source, parent, callee: data.graph.nodes.find(node => node.name === "addFee")! };
}

for (const language of ["typescript", "kotlin"] as const) test(`${language} catch syntax retains every source return without claiming saved-result or execution proof`, async () => {
  const body = language === "kotlin" ? "try { return value + 5 } catch (error: Exception) { return 0 } finally { audit(value) }"
    : "try { return value + 5; } catch (error) { return 0; } finally { audit(value); }";
  const f = await fixture(language, body), syntax = readFunctionCallReturnSyntax(f.callee, f.source);
  assert.ok(syntax); assert.equal(syntax.syntaxOnly, true); assert.equal(syntax.limited, false);
  assert.deepEqual(syntax.sites.map(site => site.expression), ["value + 5", "0"]);
  assert.deepEqual(syntax.sites.map(site => site.regions.map(region => region.kind)), [["try"], ["catch"]]);
  assert.notDeepEqual(syntax.sites[0].range, syntax.sites[1].range);
  assert.ok(syntax.sites.every(site => !Object.hasOwn(site, "result") && !Object.hasOwn(site, "observed")));
  const call = analyzeFunctionLogic({ functionNode: f.root, sourceText: f.parent }).callsites[0];
  const reader = createFunctionCallSourceReader(f.root, f.parent);
  assert.deepEqual(reader.readUse(call.range, "addFee(amount)"), { kind: "return" });
  assert.equal(reader.read(f.callee, f.source, call.range, "addFee(amount)"), undefined);
});

for (const language of ["typescript", "kotlin"] as const) test(`${language} duplicate/conditional and finally-override returns remain distinct lexical sites`, async () => {
  const guarded = await fixture(language, "if (value > 0) { return 0; }\nreturn 0;");
  const syntax = readFunctionCallReturnSyntax(guarded.callee, guarded.source)!;
  assert.deepEqual(syntax.sites.map(site => site.expression), ["0", "0"]);
  assert.deepEqual(syntax.sites[0].regions.map(region => region.kind), ["then"]);
  assert.equal(syntax.sites[0].regions[0].expression, "value > 0");
  assert.deepEqual(syntax.sites[1].regions, []);
  const overridden = await fixture(language, "try { return value; } finally { return 0; }");
  const returns = readFunctionCallReturnSyntax(overridden.callee, overridden.source)!;
  assert.deepEqual(returns.sites.map(site => site.regions.map(region => region.kind)), [["try"], ["finally"]]);
  assert.deepEqual(returns.sites.map(site => site.expression), ["value", "0"]);
});

test("nested TS returns cannot lend their syntax to the enclosing function; owner and site bounds fail closed", async () => {
  const f = await fixture("typescript", "function inner() { return 99; } return value;");
  assert.deepEqual(readFunctionCallReturnSyntax(f.callee, f.source)?.sites.map(site => site.expression), ["value"]);
  const foreign = { ...f.callee, selectionRange: { ...f.callee.selectionRange, startCharacter: f.callee.selectionRange.startCharacter + 1 } };
  assert.equal(readFunctionCallReturnSyntax(foreign, f.source), undefined);
  const otherOwner = f.source + " function checkout() { return addFee(1); }";
  const occurrence = otherOwner.lastIndexOf("addFee"), line = otherOwner.slice(0, occurrence).split("\n").length - 1;
  const character = occurrence - otherOwner.lastIndexOf("\n", occurrence - 1) - 1;
  assert.equal(readFunctionCallReturnSyntax({ ...f.callee, selectionRange: { startLine: line, startCharacter: character,
    endLine: line, endCharacter: character + "addFee".length } }, otherOwner), undefined, "a call identifier cannot trigger name-based declaration recovery");
  const many = await fixture("typescript", "if (value > 0) return value; return 0;");
  const limited = readFunctionCallReturnSyntax(many.callee, many.source, { maxSites: 1 });
  assert.equal(limited?.sites.length, 1); assert.equal(limited?.limited, true);
});

test("deep controls and overlong return expressions never become silently complete evidence", async () => {
  const f = await fixture("typescript", "if (value > 0) { if (value < 10) { return value; } } return 0;");
  assert.equal(readFunctionCallReturnSyntax(f.callee, f.source, { maxDepth: 1 })?.limited, true);
  const large = await fixture("typescript", 'return "' + "x".repeat(200) + '";');
  const syntax = readFunctionCallReturnSyntax(large.callee, large.source);
  assert.equal(syntax?.limited, true); assert.equal(syntax?.sites.length, 0);
});

test("Python except/finally syntax retains exception regions; lowered try-else stays explicitly limited", () => {
  const range = { startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 11 };
  const node: SymbolNode = { id: "function:add_fee", kind: "function", name: "add_fee", qualifiedName: "add_fee",
    filePath: "/workspace/returns.py", language: "python", range, selectionRange: range };
  const source = "def add_fee(value):\n    try:\n        return value + 5\n    except Exception:\n        return 0\n    finally:\n        return 9\n";
  const syntax = readFunctionCallReturnSyntax(node, source)!;
  assert.equal(syntax.limited, false);
  assert.deepEqual(syntax.sites.map(site => site.regions.map(region => region.kind)), [["try"], ["catch"], ["finally"]]);
  assert.deepEqual(syntax.sites.map(site => site.expression), ["value + 5", "0", "9"]);
  const lowered = "def add_fee(value):\n    try:\n        audit(value)\n    except Exception:\n        return 0\n    else:\n        return value\n";
  assert.equal(readFunctionCallReturnSyntax(node, lowered)?.limited, true);
});

test("independent caller-use syntax rejects mismatched ranges, forged expressions and larger computations", async () => {
  for (const language of ["typescript", "kotlin"] as const) {
    const f = await fixture(language, "return value;");
    const logic = analyzeFunctionLogic({ functionNode: f.root, sourceText: f.parent }), call = logic.callsites[0];
    const reader = createFunctionCallSourceReader(f.root, f.parent);
    assert.deepEqual(reader.readUse(call.range, "addFee(amount)"), { kind: "return" });
    assert.equal(reader.readUse({ ...call.range, startCharacter: call.range.startCharacter + 1 }, "addFee(amount)"), undefined);
    assert.equal(reader.readUse(call.range, "addFee(other)"), undefined);
    const bigger = f.parent.replace("return addFee(amount)", "return 1 + addFee(amount)");
    const nested = analyzeFunctionLogic({ functionNode: f.root, sourceText: bigger }).callsites[0];
    assert.equal(createFunctionCallSourceReader(f.root, bigger).readUse(nested.range, "addFee(amount)"), undefined);
  }
});
