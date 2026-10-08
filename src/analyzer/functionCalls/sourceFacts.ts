/** Bounded symbolic call facts: parser-owned simple return bodies and exact caller use, never execution or business inference. */
import type { SourceRange, SymbolNode } from "../../shared/types";
import { analyzeFunctionLogic, type FunctionLogicBlock } from "../functionLogic";
import { analyzeFunctionTutorDeclaration } from "../functionTutor";

/** Source syntax only. A return expression is not a calculated runtime result. */
export type FunctionCallSourceFacts = {
  parameters: string[]; parameterTypes: string[]; returnExpression: string; returnSource: string;
  callerSource: string; use: { kind: "return" | "binding" | "discard"; name?: string };
};
export type FunctionCallSourceReader = {
  read(callee: SymbolNode, calleeSource: string, callerRange: SourceRange, expression: string): FunctionCallSourceFacts | undefined;
};
const identifier = "[\\p{L}_$][\\p{L}\\p{N}_$]*";

/** Parse the parent once per context; only matching exact statements can describe a call's use. */
export function createFunctionCallSourceReader(parent: SymbolNode, source: string): FunctionCallSourceReader {
  const language = parent.language.toLowerCase();
  const parentLogic = ["typescript", "javascript", "kotlin"].includes(language)
    ? analyzeFunctionLogic({ functionNode: parent, sourceText: source, maxBlocks: 128 }) : undefined;
  const parentTutor = parentLogic && analyzeFunctionTutorDeclaration({ functionNode: parent, sourceText: source, functionLogic: parentLogic });
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
    const logic = analyzeFunctionLogic({ functionNode: callee, sourceText: calleeSource, maxBlocks: 8 });
    const body = logic.blocks.filter(block => !["entry", "exit"].includes(block.kind));
    if (body.length !== 1 || body[0].kind !== "return" || body[0].confidence !== "exact"
      || logic.callsites.length || logic.edges.some(edge => edge.confidence !== "exact")
      || logic.gaps.some(gap => ["sourceUnavailable", "functionNotFound", "languageUnsupported"].includes(gap.code))) return;
    const tutor = analyzeFunctionTutorDeclaration({ functionNode: callee, sourceText: calleeSource, functionLogic: logic });
    if (tutor.executionKind !== "sync" || tutor.inputSummarySafe === false || tutor.parameters.length > 8
      || tutor.parameters.some(p => p.rest || p.optional || p.defaultValue !== undefined || p.callingMode !== "positional"
        || !/^(?:number|boolean|string|Int|Double|Boolean|String)$/u.test(p.typeText ?? ""))
      || tutor.gaps.some(gap => gap.kind !== "language-support")
      || tutor.program.blocks.some(block => block.operations.length > 0)) return;
    const declaration = readFunctionCallSourceRange(calleeSource, logic.sourceRange ?? callee.range);
    if (!declaration || declaration.length > 1800 || /\b(?:suspend|inline|operator|external|expect)\b/u.test(declaration)) return;
    const returnSource = readFunctionCallSourceRange(calleeSource, body[0].range)?.trim();
    if (!returnSource) return;
    // Kotlin string templates can hide expressions/writes inside a quoted
    // token. They are not literal leaves in this closed syntax reader.
    if (language === "kotlin" && /\$/u.test(returnSource)) return;
    const expressionSource = returnSource.replace(/^return\s+/u, "").replace(/;\s*$/u, "").trim();
    const parameters = tutor.parameters.map(p => p.name);
    const returnExpression = readFunctionCallSourceExpression(expressionSource, new Set(parameters));
    if (returnExpression === undefined) return;
    return { parameters, parameterTypes: tutor.parameters.map(parameter => parameter.typeText!), returnExpression,
      returnSource, callerSource: callerSource!, use };
  } };
}

/** Full declaration text must contain exactly one supported return expression, including no calls or external bindings. */
export function readFunctionCallSourceExpression(source: string, parameters: Set<string>): string | undefined {
  if (!source || source.length > 120) return;
  const tokens: string[] = []; let cursor = 0, depth = 0, needsValue = true;
  const token = /(?:"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'|(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?|[\p{L}_$][\p{L}\p{N}_$]*|===|!==|==|!=|<=|>=|&&|\|\||[()+*/%<>!+-])/uy;
  while (cursor < source.length) {
    if (/\s/u.test(source[cursor])) { cursor++; continue; }
    // Adjacent ++/-- mutate bindings; they must not become two unary operators.
    if (["++", "--"].includes(source.slice(cursor, cursor + 2))) return;
    token.lastIndex = cursor; const match = token.exec(source); if (!match) return;
    const text = match[0]; cursor = token.lastIndex;
    if (tokens.length >= 64) return;
    if (text === "(") { if (!needsValue || ++depth > 16) return; }
    else if (text === ")") { if (needsValue || depth-- <= 0) return; }
    else if (["!", "+", "-"].includes(text) && needsValue) { /* Bounded unary operators consume no value yet. */ }
    else if (["+", "-", "*", "/", "%", "<", ">", "<=", ">=", "===", "!==", "==", "!=", "&&", "||"].includes(text)) {
      if (needsValue) return; needsValue = true;
    } else {
      if (!needsValue || /[\p{L}_$]/u.test(text[0]) && !parameters.has(text) && !["true", "false"].includes(text)) return;
      needsValue = false;
    }
    tokens.push(text);
  }
  return !needsValue && depth === 0 ? tokens.join(" ") : undefined;
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

/** Read only requested lines; no whole-file split is needed for each return/callsite. */
export function readFunctionCallSourceRange(source: string, range: SourceRange): string | undefined {
  let cursor = 0;
  for (let line = 0; line < range.startLine; line++) { const next = source.indexOf("\n", cursor); if (next < 0) return; cursor = next + 1; }
  const start = cursor + range.startCharacter;
  for (let line = range.startLine; line < range.endLine; line++) { const next = source.indexOf("\n", cursor); if (next < 0) return; cursor = next + 1; }
  const end = cursor + range.endCharacter;
  return start <= end && end <= source.length ? source.slice(start, end) : undefined;
}
function contains(owner: SourceRange, site: SourceRange): boolean {
  return (owner.startLine < site.startLine || owner.startLine === site.startLine && owner.startCharacter <= site.startCharacter)
    && (owner.endLine > site.endLine || owner.endLine === site.endLine && owner.endCharacter >= site.endCharacter);
}
function span(range: SourceRange): number { return (range.endLine - range.startLine) * 100000 + range.endCharacter - range.startCharacter; }
