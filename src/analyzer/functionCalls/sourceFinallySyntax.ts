/** Parser-owned plain try-return/finally-call regions; CFG cleanup edges alone do not prove abrupt-return ordering. */
import ts from "typescript";
import type { SourceRange, SymbolNode } from "../../shared/types";
import { collectKotlinCallables, findKotlinDescendants, getKotlinBodyStatements, getKotlinChildNamed,
  kotlinNodeRange, kotlinOffsetsRange, parseKotlinSource } from "../languages/kotlin";

/** Every executable statement must be accounted for by these exact source regions. */
export type FunctionCallFinallySyntax = { tryRange: SourceRange; returnRange: SourceRange; cleanupRanges: SourceRange[] };

/** Accepts one direct try statement, one value return and one/two cleanup statements, without catch or surrounding work. */
export function readFunctionCallFinallySyntax(callee: SymbolNode, source: string): FunctionCallFinallySyntax | undefined {
  if (callee.kind !== "function") return;
  if (callee.language === "kotlin") {
    const parsed = parseKotlinSource(source, callee.filePath);
    if (parsed.diagnostics.length) return;
    const matches = collectKotlinCallables(parsed).filter(callable => callable.kind === "function" && callable.name === callee.name
      && !callable.expressionBody && !callable.suspend && !callable.receiverType
      && sameStart(kotlinOffsetsRange(parsed, callable.selectionFrom, callable.selectionTo), callee.selectionRange));
    if (matches.length !== 1) return;
    const statements = getKotlinBodyStatements(matches[0].body);
    if (statements.length !== 1) return;
    const attempts = findKotlinDescendants(statements[0], node => node.name === "tryExpression", undefined, 64);
    const attempt = attempts[0];
    // Equal spans reject a try nested inside a return, expression or annotation.
    if (attempts.length !== 1 || attempt.from !== statements[0].from || attempt.to !== statements[0].to
      || attempt.children.some(child => child.name === "catchBlock")) return;
    const body = getKotlinChildNamed(attempt, "block"), cleanup = getKotlinChildNamed(attempt, "finallyBlock");
    const finalBody = cleanup && getKotlinChildNamed(cleanup, "block");
    if (!body || !finalBody) return;
    const returns = getKotlinBodyStatements(body), calls = getKotlinBodyStatements(finalBody);
    if (returns.length !== 1 || ![1, 2].includes(calls.length)) return;
    return { tryRange: kotlinNodeRange(parsed, attempt), returnRange: kotlinNodeRange(parsed, returns[0]),
      cleanupRanges: calls.map(call => kotlinNodeRange(parsed, call)) };
  }
  if (!["typescript", "javascript"].includes(callee.language)) return;
  const parsed = ts.createSourceFile(callee.filePath, source, ts.ScriptTarget.Latest, true,
    callee.language === "javascript" ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  if ((parsed as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) return;
  const range = (node: ts.Node): SourceRange => {
    const start = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)), end = parsed.getLineAndCharacterOfPosition(node.end);
    return { startLine: start.line, startCharacter: start.character, endLine: end.line, endCharacter: end.character };
  };
  // Only a top-level named function can own this recipe. Nested functions,
  // methods, generator/async contracts and lexical defaults retain their readers.
  const matches = parsed.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node)
    && Boolean(node.name && node.name.text === callee.name && sameStart(range(node.name), callee.selectionRange)));
  const declaration = matches[0];
  if (matches.length !== 1 || !declaration.body || declaration.asteriskToken
    || declaration.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    || declaration.body.statements.length !== 1) return;
  const attempt = declaration.body.statements[0];
  if (!ts.isTryStatement(attempt) || attempt.catchClause || !attempt.finallyBlock || attempt.tryBlock.statements.length !== 1
    || !ts.isReturnStatement(attempt.tryBlock.statements[0]) || !attempt.tryBlock.statements[0].expression
    || ![1, 2].includes(attempt.finallyBlock.statements.length)
    || attempt.finallyBlock.statements.some(statement => !ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression))) return;
  return { tryRange: range(attempt), returnRange: range(attempt.tryBlock.statements[0]), cleanupRanges: attempt.finallyBlock.statements.map(range) };
}

/** Name-token ownership prevents a same-named declaration from supplying another function's source proof. */
function sameStart(left: SourceRange, right: SourceRange): boolean {
  return left.startLine === right.startLine && left.startCharacter === right.startCharacter;
}
