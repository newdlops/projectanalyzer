/** Symbolic callee paths and exact caller use; syntax ownership never implies runtime execution or business intent. */
import type { SourceRange, SymbolNode } from "../../shared/types";
import { analyzeFunctionLogic, type FunctionLogicBlock } from "../functionLogic";
import { analyzeFunctionTutorDeclaration } from "../functionTutor";
import { readFunctionCallSourceBody, type FunctionCallSourceBodyFacts } from "./sourceBody";
import { readFunctionCallSourceRange, readFunctionCallSourceObjectExpression } from "./sourceSyntax";
import { readFunctionCallSourceDeclaredParameters } from "./sourceParameters";
import { readFunctionCallArguments } from "./arguments";
export { readFunctionCallSourceExpression, readFunctionCallSourceRange } from "./sourceSyntax";
export type { FunctionCallSourceBodyStep } from "./sourceBody";

/** Source syntax only. A return expression is not a calculated runtime result. */
export type FunctionCallSourceFacts = FunctionCallSourceBodyFacts & {
  callerSource: string; use: { kind: "return" | "binding" | "discard"; name?: string };
  /** Caller receiver/argument reads precede the callee; their values/getters/state/effects are never proved by its body. */
  callerReads?: { expressions: string[]; accesses: string[]; externalReads: string[] };
};
export type FunctionCallSourceReader = {
  read(callee: SymbolNode, calleeSource: string, callerRange: SourceRange, expression: string): FunctionCallSourceFacts | undefined;
};
const identifier = "[\\p{L}_$][\\p{L}\\p{N}_$]*";

/** Formal positional declarations remain source facts even when their runtime values/types and effects are unknown. */
export function readFunctionCallSourceParameters(callee: SymbolNode, source: string): Array<{ name: string; type: string }> | undefined {
  if (callee.kind !== "function" || !["typescript", "javascript", "kotlin"].includes(callee.language)) return;
  const logic = analyzeFunctionLogic({ functionNode: callee, sourceText: source, maxBlocks: 8 });
  const declaration = readFunctionCallSourceRange(source, logic.sourceRange ?? callee.range);
  if (!declaration || declaration.length > 1800 || logic.gaps.some(gap => ["sourceUnavailable", "functionNotFound", "languageUnsupported"].includes(gap.code))) return;
  const tutor = analyzeFunctionTutorDeclaration({ functionNode: callee, sourceText: source, functionLogic: logic });
  return readFunctionCallSourceDeclaredParameters(tutor, { allowBodyGaps: true })?.parameters;
}

/** Parse the parent once per context; only matching exact statements can describe a call's use. */
export function createFunctionCallSourceReader(parent: SymbolNode, source: string,
  options?: { maxCalleeDepth?: number }): FunctionCallSourceReader {
  const language = parent.language.toLowerCase();
  const parentLogic = ["typescript", "javascript", "kotlin"].includes(language)
    ? analyzeFunctionLogic({ functionNode: parent, sourceText: source, maxBlocks: 128 }) : undefined;
  const parentTutor = parentLogic && analyzeFunctionTutorDeclaration({ functionNode: parent, sourceText: source, functionLogic: parentLogic });
  const names = new Set([...(parentTutor?.parameters.map(parameter => parameter.name) ?? []),
    ...(parentLogic?.valueBindings?.map(binding => binding.name) ?? [])]);
  // Async/generator/constructor returns have a different parent return contract;
  // a plain source call result cannot stand in for their whole return value.
  const blocks = parent.kind !== "constructor" && parentTutor?.executionKind === "sync"
    && !/\b(?:suspend|inline)\b/u.test(parentLogic!.signature) ? parentLogic!.blocks : [];
  return { read(callee, calleeSource, callerRange, expression) {
    if (callee.kind !== "function" || callee.language !== parent.language || expression.length > 240
      || /^new\b|\.(?:call|apply|bind)\s*\(/u.test(expression)) return;
    const block = blocks.filter(block => block.confidence === "exact" && ["return", "mutation", "call"].includes(block.kind)
      && contains(block.range, callerRange)).sort((a, b) => span(a.range) - span(b.range))[0];
    if (!block) return;
    const callerSource = readFunctionCallSourceRange(source, block.range)?.trim();
    const use = callerSource && readUse(block, callerSource, expression.trim());
    if (!use) return;
    const site = parentLogic!.callsites.find(site => contains(block.range, site.range)
      && readFunctionCallSourceRange(source, site.range)?.trim() === expression.trim());
    const arguments_ = site && readFunctionCallArguments(language, source, parent.filePath, site.range);
    if (!site || !arguments_) return;
    const expressions: string[] = [], accesses: string[] = [], externalReads: string[] = [];
    // Validate authored operands only. Imported/captured names are recorded as
    // unknown references; no binding, receiver or property is looked up.
    const operands = [...arguments_];
    if (site.calleeText !== site.calleeName) operands.unshift(site.calleeText);
    for (const operand of operands) {
      if (language === "kotlin" && operand.includes("$")) return;
      const value = readFunctionCallSourceObjectExpression(operand, names, { externalReads: true });
      if (!value) return;
      if (value.accesses.length || value.externalReads?.length) expressions.push(value.expression);
      accesses.push(...value.accesses); externalReads.push(...(value.externalReads ?? []));
    }
    const body = readFunctionCallSourceBody(callee, calleeSource, options?.maxCalleeDepth);
    return body && { ...body, callerSource: callerSource!, use,
      ...(accesses.length || externalReads.length ? { callerReads: { expressions, accesses, externalReads } } : {}) };
  } };
}

/** The enclosing statement must use the entire call directly, rather than hiding a larger computation or a write to external state. */
function readUse(block: FunctionLogicBlock, source: string, expression: string): FunctionCallSourceFacts["use"] | undefined {
  if (block.kind === "return" && /^return\s+/u.test(source)
    && source.replace(/^return\s+/u, "").replace(/;\s*$/u, "").trim() === expression) return { kind: "return" };
  if (block.kind === "call" && source.replace(/;\s*$/u, "").trim() === expression) return { kind: "discard" };
  const declaration = new RegExp("^(?:const|let|val|var)\\s+(" + identifier + ")(?:\\s*:\\s*[A-Za-z]+)?\\s*=\\s*([\\s\\S]+?)\\s*;?$", "u").exec(source);
  if (block.kind === "mutation" && declaration?.[2] === expression) return { kind: "binding", name: declaration[1] };
  return;
}

function contains(owner: SourceRange, site: SourceRange): boolean {
  return (owner.startLine < site.startLine || owner.startLine === site.startLine && owner.startCharacter <= site.startCharacter)
    && (owner.endLine > site.endLine || owner.endLine === site.endLine && owner.endCharacter >= site.endCharacter);
}
function span(range: SourceRange): number { return (range.endLine - range.startLine) * 100000 + range.endCharacter - range.startCharacter; }
