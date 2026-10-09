/** Symbolic callee paths and exact caller use; syntax ownership never implies runtime execution or business intent. */
import type { SourceRange, SymbolNode } from "../../shared/types";
import type { FunctionCallResultUse } from "../../shared/functionCallNarratives";
import { analyzeFunctionLogic, type FunctionLogicBlock } from "../functionLogic";
import { analyzeFunctionTutorDeclaration } from "../functionTutor";
import { readFunctionCallSourceBody, type FunctionCallSourceBodyFacts } from "./sourceBody";
import { readFunctionCallSourceRange, readFunctionCallSourceObjectExpression } from "./sourceSyntax";
import { readFunctionCallSourceDeclaredParameters } from "./sourceParameters";
import { readFunctionCallArguments } from "./arguments";
import { readFunctionCallSourceExecution, type FunctionCallSourceExecution } from "./sourceExecution";
export { readFunctionCallSourceExpression, readFunctionCallSourceRange } from "./sourceSyntax";
export type { FunctionCallSourceBodyStep } from "./sourceBody";

/** Source syntax only. A return expression is not a calculated runtime result. */
export type FunctionCallSourceFacts = FunctionCallSourceBodyFacts & {
  callerSource: string; use: FunctionCallResultUse;
  /** The caller's own Promise/suspend return contract is separate from its callee. */
  callerExecution?: Exclude<FunctionCallSourceExecution, "sync">;
  /** Caller receiver/argument reads precede the callee; their values/getters/state/effects are never proved by its body. */
  callerReads?: { expressions: string[]; accesses: string[]; externalReads: string[] };
};
export type FunctionCallSourceReader = {
  read(callee: SymbolNode, calleeSource: string, callerRange: SourceRange, expression: string): FunctionCallSourceFacts | undefined;
  /** Independent exact callsite syntax survives an unsupported callee CFG; it never evaluates source. */
  readUse(callerRange: SourceRange, expression: string): FunctionCallResultUse | undefined;
};
const identifier = "[\\p{L}_$][\\p{L}\\p{N}_$]*";

/** Formal positional declarations remain source facts even when their runtime values/types and effects are unknown. */
export function readFunctionCallSourceParameters(callee: SymbolNode, source: string): Array<{ name: string; type: string }> | undefined {
  if (!["function", "method"].includes(callee.kind) || !["typescript", "javascript", "kotlin"].includes(callee.language)) return;
  const logic = analyzeFunctionLogic({ functionNode: callee, sourceText: source, maxBlocks: 8 });
  const declaration = readFunctionCallSourceRange(source, logic.sourceRange ?? callee.range);
  if (!declaration || declaration.length > 1800 || /(?:^|\s)(?:get|set)\s+[\p{L}_$][\p{L}\p{N}_$]*\s*\(/u.test(logic.signature)
    || logic.gaps.some(gap => ["sourceUnavailable", "functionNotFound", "languageUnsupported"].includes(gap.code))) return;
  const tutor = analyzeFunctionTutorDeclaration({ functionNode: callee, sourceText: source, functionLogic: logic });
  return readFunctionCallSourceDeclaredParameters(tutor, { allowBodyGaps: true, sourceOnlyMethod: callee.kind === "method" })?.parameters;
}

/** Parse the parent once per context; only matching exact statements can describe a call's use. */
export function createFunctionCallSourceReader(parent: SymbolNode, source: string,
  options?: { maxCalleeDepth?: number }): FunctionCallSourceReader {
  const language = parent.language.toLowerCase();
  const parentLogic = ["typescript", "javascript", "kotlin"].includes(language)
    ? analyzeFunctionLogic({ functionNode: parent, sourceText: source, maxBlocks: 128 }) : undefined;
  const parentTutor = parentLogic && analyzeFunctionTutorDeclaration({ functionNode: parent, sourceText: source, functionLogic: parentLogic });
  const execution = parentTutor && readFunctionCallSourceExecution(parentTutor, parentLogic!.signature);
  const names = new Set([...(parentTutor?.parameters.map(parameter => parameter.name) ?? []),
    ...(parentLogic?.valueBindings?.map(binding => binding.name) ?? [])]);
  // Retain the caller contract instead of treating an awaited fulfillment as a
  // synchronous call return. Generators/constructors remain outside this proof.
  const blocks = execution ? parentLogic!.blocks : [];
  const callerSyntax = (callerRange: SourceRange, expression: string) => {
    if (expression.length > 240 || /^new\b|\.(?:call|apply|bind)\s*\(/u.test(expression)) return;
    const block = blocks.filter(block => block.confidence === "exact" && ["return", "mutation", "call"].includes(block.kind)
      && contains(block.range, callerRange)).sort((a, b) => span(a.range) - span(b.range))[0];
    if (!block) return;
    const callerSource = readFunctionCallSourceRange(source, block.range)?.trim();
    const use = callerSource && readUse(block, callerSource, expression.trim(), execution === "promise");
    if (!use) return;
    const site = parentLogic!.callsites.find(site => sameRange(site.range, callerRange) && contains(block.range, site.range)
      && readFunctionCallSourceRange(source, site.range)?.trim() === expression.trim());
    if (!site) return;
    return { block, callerSource: callerSource!, use, site };
  };
  return { readUse(callerRange, expression) { return callerSyntax(callerRange, expression)?.use; },
    read(callee, calleeSource, callerRange, expression) {
    if (!["function", "method"].includes(callee.kind) || callee.language !== parent.language) return;
    const caller = callerSyntax(callerRange, expression);
    if (!caller) return;
    const { callerSource, use, site } = caller;
    const arguments_ = readFunctionCallArguments(language, source, parent.filePath, site.range);
    if (!arguments_) return;
    const expressions: string[] = [], accesses: string[] = [], externalReads: string[] = [];
    // Validate authored operands only. Imported/captured names are recorded as
    // unknown references; no binding, receiver or property is looked up.
    const operands = [...arguments_];
    if (site.calleeText !== site.calleeName) operands.unshift(site.calleeText);
    for (const operand of operands) {
      if (language === "kotlin" && operand.includes("$")) return;
      const value = readFunctionCallSourceObjectExpression(operand, names, { externalReads: true, methodReceiver: parent.kind === "method", asyncAwait: execution === "promise" });
      if (!value) return;
      if (value.accesses.length || value.externalReads?.length || value.awaits) expressions.push(value.expression);
      accesses.push(...value.accesses); externalReads.push(...(value.externalReads ?? []));
    }
    const body = readFunctionCallSourceBody(callee, calleeSource, options?.maxCalleeDepth);
    return body && { ...body, callerSource, use,
      ...(execution && execution !== "sync" ? { callerExecution: execution } : {}),
      ...(expressions.length ? { callerReads: { expressions, accesses, externalReads } } : {}) };
  } };
}

/** The enclosing statement must use the entire call directly, rather than hiding a larger computation or a write to external state. */
function readUse(block: FunctionLogicBlock, source: string, expression: string, asyncAwait: boolean): FunctionCallSourceFacts["use"] | undefined {
  const matches = (value: string) => value === expression ? {} : asyncAwait && /^await\s+/u.test(value)
    && value.replace(/^await\s+/u, "").trim() === expression ? { awaited: true as const } : undefined;
  const returned = block.kind === "return" && /^return\s+/u.test(source)
    ? matches(source.replace(/^return\s+/u, "").replace(/;\s*$/u, "").trim()) : undefined;
  if (returned) return { kind: "return", ...returned };
  const discarded = block.kind === "call" ? matches(source.replace(/;\s*$/u, "").trim()) : undefined;
  if (discarded) return { kind: "discard", ...discarded };
  const declaration = new RegExp("^(?:const|let|val|var)\\s+(" + identifier + ")(?:\\s*:\\s*[A-Za-z]+)?\\s*=\\s*([\\s\\S]+?)\\s*;?$", "u").exec(source);
  const bound = block.kind === "mutation" && declaration ? matches(declaration[2]) : undefined;
  if (bound && declaration) return { kind: "binding", name: declaration[1], ...bound };
  return;
}

function contains(owner: SourceRange, site: SourceRange): boolean {
  return (owner.startLine < site.startLine || owner.startLine === site.startLine && owner.startCharacter <= site.startCharacter)
    && (owner.endLine > site.endLine || owner.endLine === site.endLine && owner.endCharacter >= site.endCharacter);
}
/** Equal text elsewhere, or an identifier/argument subrange, cannot lend a call its statement use. */
function sameRange(left: SourceRange, right: SourceRange): boolean {
  return left.startLine === right.startLine && left.startCharacter === right.startCharacter
    && left.endLine === right.endLine && left.endCharacter === right.endCharacter;
}
function span(range: SourceRange): number { return (range.endLine - range.startLine) * 100000 + range.endCharacter - range.startCharacter; }
