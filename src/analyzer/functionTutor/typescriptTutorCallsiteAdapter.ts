/**
 * TypeScript/JavaScript callsite adapter for Function Guide input cases. It verifies a
 * graph-selected call expression and reads bounded literal inputs only.
 */

import * as ts from "typescript";
import { createContentHash } from "../../shared/hash";
import type { SourceRange, SymbolNode } from "../../shared/types";
import { getScriptKind, getSupportedLanguage, toSourceRange } from "../functionLogic/typescriptFunctionLogicSyntax";
import { boundFunctionTutorStaticValue, createFunctionTutorUnknown, isFunctionTutorSafeObjectKey } from "./staticValue";
import type { FunctionTutorCallsiteInput, FunctionTutorCallsiteTuple, FunctionTutorEvidence, FunctionTutorStaticValue } from "./types";

/** Produces one tuple only if the graph range and static callee both match. */
export function analyzeTypeScriptTutorCallsite(input: FunctionTutorCallsiteInput): FunctionTutorCallsiteTuple | undefined {
  if (getSupportedLanguage(input.targetFunction) === "unsupported") return undefined;
  const sourceFile = ts.createSourceFile(input.callerFilePath, input.callerSourceText, ts.ScriptTarget.Latest, true, getScriptKind(input.callerFilePath));
  const calls: ts.CallExpression[] = [];
  const pending: ts.Node[] = [sourceFile];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (ts.isCallExpression(node) && rangesOverlap(toSourceRange(sourceFile, node), input.callEdge.range)) calls.push(node);
    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => { children.push(child); return undefined; });
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
  const call = calls.find((candidate) => matchesTargetCallee(candidate.expression, input.targetFunction));
  if (!call) return undefined;
  const argumentsForParameters: FunctionTutorCallsiteTuple["arguments"] = input.parameters.map((parameter, index) => {
    const argument = call.arguments[index];
    const value = argument ? readCallsiteLiteral(argument, sourceFile) : parameter.defaultValue ?? createFunctionTutorUnknown("not-inferred", "No argument or declaration default is available.");
    const evidence: FunctionTutorEvidence = {
      kind: "callsite-argument", certainty: value.kind === "unknown" ? "unknown" : "exact", filePath: input.callerFilePath,
      range: argument ? toSourceRange(sourceFile, argument) : toSourceRange(sourceFile, call.expression),
      summary: argument ? `Literal argument ${index + 1} at this callsite.` : `Argument ${index + 1} is omitted at this callsite.`
    };
    return { parameterId: parameter.id, value, omitted: !argument, certainty: evidence.certainty, evidence: [evidence] };
  });
  const evidence: FunctionTutorEvidence = {
    kind: "callsite-argument", certainty: argumentsForParameters.some((argument) => argument.certainty === "unknown") ? "unknown" : "exact",
    filePath: input.callerFilePath, range: toSourceRange(sourceFile, call), summary: "Static argument tuple from a caller in the current graph."
  };
  return { id: `tutor-callsite:${createContentHash(`${input.callEdge.id}\0${call.getStart(sourceFile)}`).slice(0, 24)}`, arguments: argumentsForParameters, certainty: evidence.certainty, evidence: [evidence] };
}

/** Reads literals, arrays, and objects; arbitrary expressions are deliberately unknown. */
function readCallsiteLiteral(node: ts.Expression, sourceFile: ts.SourceFile): FunctionTutorStaticValue {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { kind: "boolean", value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { kind: "boolean", value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: "null" };
  if (ts.isIdentifier(node) && node.text === "undefined") return { kind: "undefined" };
  if (ts.isNumericLiteral(node)) return boundFunctionTutorStaticValue({ kind: "number", value: Number(node.text) });
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { kind: "string", value: node.text };
  if (ts.isParenthesizedExpression(node)) return readCallsiteLiteral(node.expression, sourceFile);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return boundFunctionTutorStaticValue({ kind: "number", value: -Number(node.operand.text) });
  if (ts.isArrayLiteralExpression(node)) return boundFunctionTutorStaticValue({ kind: "array", items: node.elements.map((item) => ts.isExpression(item) ? readCallsiteLiteral(item, sourceFile) : createFunctionTutorUnknown("unsupported-expression")), truncated: false });
  if (ts.isObjectLiteralExpression(node)) {
    const entries: Array<{ key: string; value: FunctionTutorStaticValue }> = [];
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name) ? property.name.text : undefined;
      if (key && isFunctionTutorSafeObjectKey(key)) entries.push({ key, value: readCallsiteLiteral(property.initializer, sourceFile) });
    }
    return boundFunctionTutorStaticValue({ kind: "object", entries, truncated: entries.length !== node.properties.length });
  }
  return createFunctionTutorUnknown("unsupported-expression", `Callsite argument is not a bounded literal: ${node.getText(sourceFile).slice(0, 80)}`);
}

function matchesTargetCallee(expression: ts.LeftHandSideExpression, target: SymbolNode): boolean {
  let current: ts.Expression = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  const name = ts.isIdentifier(current) ? current.text : ts.isPropertyAccessExpression(current) ? current.name.text : undefined;
  return name === target.name || name === target.qualifiedName.split(".").at(-1);
}

function rangesOverlap(left: SourceRange, right: SourceRange | undefined): boolean {
  if (!right) return true;
  const leftStart = left.startLine * 1_000_000 + left.startCharacter;
  const leftEnd = left.endLine * 1_000_000 + left.endCharacter;
  const rightStart = right.startLine * 1_000_000 + right.startCharacter;
  const rightEnd = right.endLine * 1_000_000 + right.endCharacter;
  return leftStart <= rightEnd && rightStart <= leftEnd;
}
