/** Parser-owned symbolic call values: complete nested invocation syntax, without evaluating results or inspecting implementations. */
import type { FunctionLogicAnalysis, FunctionLogicBlock, FunctionLogicCallsite } from "../functionLogic";
import type { SourceRange, SymbolNode } from "../../shared/types";
import { createTypeScriptCallGuardReader } from "./languages/typescript";
import { createKotlinCallGuardReader } from "./languages/kotlin";
import { readFunctionCallSourceExpression } from "./sourceSyntax";

/** Every original call remains source-backed; internal placeholders are used only to check expression syntax. */
export type FunctionCallSourceValue = { expression: string; calls: string[]; sites: FunctionLogicCallsite[] };
type Invocation = { site: FunctionLogicCallsite; from: number; to: number; source: string };

/** Reuse one parser adapter per callee; bounded interval postorder retains duplicate/nested calls and their statement ownership. */
export function createFunctionCallSourceValueReader(callee: SymbolNode, source: string, logic: FunctionLogicAnalysis) {
  // The common call-free path needs no additional AST, line index or ownership
  // map. Keep its original closed expression cost and result contract.
  if (!logic.callsites.length) return (expression: string, _block: FunctionLogicBlock, names: Set<string>): FunctionCallSourceValue | undefined => {
    if (callee.language === "kotlin" && expression.includes("$")) return;
    const primitive = readFunctionCallSourceExpression(expression, names);
    return primitive === undefined ? undefined : { expression: primitive, calls: [], sites: [] };
  };
  const lineStarts = [0];
  for (let index = source.indexOf("\n"); index >= 0; index = source.indexOf("\n", index + 1)) lineStarts.push(index + 1);
  const bounds = (range: SourceRange) => ({ from: lineStarts[range.startLine] + range.startCharacter, to: lineStarts[range.endLine] + range.endCharacter });
  const contains = (outer: { from: number; to: number }, inner: { from: number; to: number }) => outer.from <= inner.from && inner.to <= outer.to;
  const blocks = logic.blocks.filter(block => ["return", "mutation", "condition", "call"].includes(block.kind))
    .map(block => ({ block, ...bounds(block.range) })).sort((left, right) => left.to - left.from - (right.to - right.from));
  const owners = new Map<string, Invocation[]>();
  let complete = true;
  for (const site of logic.callsites) {
    const range = bounds(site.range), owner = site.blockId ? blocks.find(owner => owner.block.id === site.blockId) : blocks.find(owner => contains(owner, range));
    if (!owner || !contains(owner, range) || !Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to)
      || range.from < 0 || range.to > source.length || range.to <= range.from) { complete = false; break; }
    const invocations = owners.get(owner.block.id) ?? [];
    invocations.push({ site, ...range, source: source.slice(range.from, range.to) }); owners.set(owner.block.id, invocations);
  }
  const guardReader = callee.language === "kotlin"
    ? createKotlinCallGuardReader(source, callee.filePath, 512, new Set(logic.blocks.flatMap(block => block.condition ? [block.condition.groupId] : [])))
    : createTypeScriptCallGuardReader(source, callee.filePath, 512);
  return (expression: string, block: FunctionLogicBlock, names: Set<string>): FunctionCallSourceValue | undefined => {
    if (!complete || !expression || expression.length > 120 || callee.language === "kotlin" && expression.includes("$")) return;
    const invocations = owners.get(block.id) ?? [];
    if (!invocations.length) {
      const primitive = readFunctionCallSourceExpression(expression, names);
      return primitive === undefined ? undefined : { expression: primitive, calls: [], sites: [] };
    }
    if (invocations.length > 16) return;
    const owner = bounds(block.range), statement = source.slice(owner.from, owner.to), start = statement.indexOf(expression);
    if (start < 0 || start !== statement.lastIndexOf(expression)) return;
    const from = owner.from + start, to = from + expression.length;
    if (invocations.some(call => !contains({ from, to }, call))) return;
    const validated: Invocation[] = [];
    // Closing offsets give source argument order followed by their containing
    // invocation. No recursive traversal or call execution is involved.
    for (const call of [...invocations].sort((left, right) => left.to - right.to || right.from - left.from)) {
      const { site } = call, syntax = guardReader(site);
      if (!/^[\p{L}_$][\p{L}\p{N}_$]*\s*\(/u.test(call.source) || !/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(site.calleeText)
        || ["eval", "Function"].includes(site.calleeName) || site.confidence === "inferred" || site.relation && site.relation !== "call"
        || syntax.deferred || syntax.limited || !syntax.argumentsText
        || syntax.guards.some(guard => guard.from >= from && guard.to <= to)) return;
      let cursor = call.source.indexOf("(") + 1;
      for (const [argumentIndex, argument] of syntax.argumentsText.entries()) {
        const index = call.source.indexOf(argument, cursor);
        const separator = argumentIndex === 0 ? /^\s*$/u : /^\s*,\s*$/u;
        // Recovering ASTs may expose arguments even when a comma is missing.
        // Their original separators must still prove a valid call expression.
        if (index < 0 || !separator.test(call.source.slice(cursor, index))) return;
        const value = replaceCalls(source, call.from + index, call.from + index + argument.length, validated);
        if (readFunctionCallSourceExpression(value, names) === undefined) return;
        cursor = index + argument.length;
      }
      if (!/^\s*\)$/u.test(call.source.slice(cursor))) return;
      validated.push(call);
    }
    if (readFunctionCallSourceExpression(replaceCalls(source, from, to, validated), names) === undefined) return;
    // Preserve original syntax, not the checking placeholders or invented values.
    return { expression, calls: validated.map(call => call.source), sites: validated.map(call => call.site) };
  };
}

/** Replace only complete, parser-validated intervals. Zero is a syntax token, never a computed or assumed call result. */
function replaceCalls(source: string, from: number, to: number, calls: Invocation[]): string {
  const enclosed = calls.filter(call => from <= call.from && call.to <= to).sort((left, right) => left.from - right.from || right.to - left.to);
  let cursor = from, result = "";
  for (const call of enclosed) {
    if (call.from < cursor) continue;
    result += source.slice(cursor, call.from) + "(0)"; cursor = call.to;
  }
  return result + source.slice(cursor, to);
}
