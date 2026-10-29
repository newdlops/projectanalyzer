/** Bounded TypeScript/JavaScript source facts for prose roles, literal outcomes and identity helpers. */
import ts from "typescript";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import type { NarrativeQualityFacts } from "./types";

/** Unknown syntax, missing bodies, ambiguous names and captured state never establish a closed scope. */
export function readNarrativeQualityFacts(context: FunctionNarrativeContext): NarrativeQualityFacts {
  const facts: NarrativeQualityFacts = { closed: false, identityCalls: [], identityInvocations: [], returns: [] };
  if (!["typescript", "javascript"].includes(context.language)) return facts;
  const declarations: Array<{ snippetId: string; fn: ts.FunctionDeclaration }> = [];
  let parsed = true;
  for (const snippet of context.snippets) {
    const file = ts.createSourceFile("reading.ts", snippet.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if ((file as ts.SourceFile & { parseDiagnostics: readonly unknown[] }).parseDiagnostics.length) parsed = false;
    for (const statement of file.statements) if (ts.isFunctionDeclaration(statement)) declarations.push({ snippetId: snippet.id, fn: statement });
  }
  const roots = declarations.filter(item => item.fn.name?.text === context.functionName
    && context.snippets.some(snippet => snippet.id === item.snippetId && snippet.role === "function"));
  if (!parsed || roots.length !== 1 || !roots[0].fn.body) return facts;
  const root = roots[0];
  const body = root.fn.body!;
  const byName = new Map<string, typeof declarations>();
  for (const item of declarations) {
    if (!item.fn.name) continue;
    const items = byName.get(item.fn.name.text) ?? []; items.push(item); byName.set(item.fn.name.text, items);
  }
  for (const [name, items] of byName) {
    if (items.length !== 1 || items[0] === root) continue;
    const { fn, snippetId } = items[0];
    const statement = fn.body?.statements.length === 1 ? fn.body.statements[0] : undefined;
    if (!simpleParameters(fn) || fn.asteriskToken || fn.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      || !statement || !ts.isReturnStatement(statement) || !statement.expression || !ts.isIdentifier(statement.expression)) continue;
    const index = fn.parameters.findIndex(parameter => parameter.name.getText() === statement.expression!.getText());
    const exact = context.sourceEvidence?.relations.some(relation => relation.from === root.snippetId && relation.to === snippetId
      && relation.kind === "calls" && ["exact", "resolved"].includes(relation.confidence));
    if (index >= 0 && exact) facts.identityCalls.push({ name, parameter: statement.expression.text, argumentIndex: index });
  }
  for (const [index, statement] of body.statements.entries()) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (!ts.isIdentifier(declaration.name) || !call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
      const helper = facts.identityCalls.find(item => item.name === call.expression.getText());
      const argument = helper && call.arguments[helper.argumentIndex];
      if (!helper || !argument || ts.isSpreadElement(argument)) continue;
      const next = body.statements[index + 1];
      facts.identityInvocations.push({ statement: statement.getText(), helper: helper.name, argument: argument.getText(), binding: declaration.name.text,
        argumentJson: literalJson(argument), ...(next && ts.isIfStatement(next) ? { followingCondition: next.expression.getText() } : {}) });
    }
  }
  // Both arms and fall-through returns retain their actual guards, without
  // enumerating an unbounded graph or borrowing the selected scenario page.
  facts.returns = readReturns(body);
  let hasElse = false;
  const evidence = context.sourceEvidence;
  // Capture may retain the diagram reader's small-block/generic runtime
  // caveats. This independent parser checks the complete declaration instead.
  if (!evidence?.complete || evidence.gaps.length || context.limited
    || context.snippets.some(snippet => snippet.truncated) || !simpleParameters(root.fn)
    || root.fn.asteriskToken || root.fn.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) return facts;
  const names = new Set(root.fn.parameters.map(parameter => parameter.name.getText()));
  const locals = new Set<string>();
  const work: ts.Node[] = [...body.statements]; const visited = new Set<ts.Node>();
  for (let cursor = 0; cursor < work.length; cursor++) {
    if (cursor >= 1024) return facts;
    const node = work[cursor]; if (visited.has(node)) continue; visited.add(node);
    if (ts.isBlock(node)) work.push(...node.statements);
    else if (ts.isIfStatement(node)) {
      if (node.elseStatement) hasElse = true;
      work.push(node.expression, node.thenStatement, ...(node.elseStatement ? [node.elseStatement] : []));
    }
    else if (ts.isReturnStatement(node)) { if (!node.expression) return facts; work.push(node.expression); }
    else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || names.has(declaration.name.text) || locals.has(declaration.name.text) || !declaration.initializer) return facts;
        locals.add(declaration.name.text); work.push(declaration.initializer);
      }
    } else if (ts.isParenthesizedExpression(node)) work.push(node.expression);
    else if (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operator)) work.push(node.operand);
    else if (ts.isBinaryExpression(node) && primitiveOperators.has(node.operatorToken.kind)) work.push(node.left, node.right);
    else if (ts.isCallExpression(node)) {
      if (!ts.isIdentifier(node.expression) || names.has(node.expression.text) || locals.has(node.expression.text)
        || !facts.identityCalls.some(call => call.name === node.expression.getText()) || node.arguments.some(ts.isSpreadElement)) return facts;
      work.push(...node.arguments);
    } else if (ts.isIdentifier(node)) { if (!names.has(node.text) && !locals.has(node.text)) return facts; }
    else if (!ts.isStringLiteral(node) && !ts.isNumericLiteral(node)
      && ![ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return facts;
  }
  facts.closed = true; facts.hasElse = hasElse;
  // No supported statement mutates a binding. Repeated pure predicates and
  // literal Boolean guards therefore cannot make contradictory routes reachable.
  facts.returns = facts.returns.filter(route => {
    const choices = new Map<string, string>();
    for (const guard of route.conditions) {
      const split = guard.lastIndexOf(" = "), predicate = guard.slice(0, split), outcome = guard.slice(split + 3);
      if (["true", "false"].includes(predicate) && predicate !== outcome || choices.has(predicate) && choices.get(predicate) !== outcome) return false;
      choices.set(predicate, outcome);
    }
    return true;
  });
  const choice = body.statements.at(-2), fallback = body.statements.at(-1);
  if (choice && ts.isIfStatement(choice) && ts.isIdentifier(choice.expression) && !choice.elseStatement
    && root.fn.parameters.some(parameter => parameter.name.getText() === choice.expression.getText() && parameter.type?.getText() === "boolean")
    && ts.isReturnStatement(choice.thenStatement) && choice.thenStatement.expression && literalJson(choice.thenStatement.expression) !== undefined
    && fallback && ts.isReturnStatement(fallback) && fallback.expression && literalJson(fallback.expression) !== undefined
    && body.statements.slice(0, -2).every(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1
      && facts.identityInvocations.some(call => call.statement === statement.getText() && call.argumentJson !== undefined))) {
    facts.simpleBooleanReturn = { parameter: choice.expression.text, trueStatement: choice.thenStatement.getText(), falseStatement: fallback.getText() };
  }
  return facts;
}

/** Iterative source paths stop at return; unsupported control or admission overflow leaves coverage unknown. */
function readReturns(body: ts.Block): NarrativeQualityFacts["returns"] {
  const returns: NarrativeQualityFacts["returns"] = [];
  const pending = [{ statements: [...body.statements], conditions: [] as string[], visited: new Set<ts.Node>() }];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    if (cursor >= 1024 || pending.length > 1024 || returns.length > 16) return [];
    const { statements, conditions, visited } = pending[cursor];
    if (!statements.length) continue;
    const [node, ...rest] = statements;
    if (visited.has(node) || visited.size >= 128 || conditions.length > 16) return [];
    const nextVisited = new Set(visited); nextVisited.add(node);
    if (ts.isReturnStatement(node) && node.expression) {
      const expression = node.expression;
      const literal = ts.isStringLiteral(expression) || ts.isNumericLiteral(expression) ? expression.text
        : [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(expression.kind) ? expression.getText() : undefined;
      returns.push({ expression: expression.getText(), conditions, ...(literal !== undefined ? { literal, literalJson: literalJson(expression) } : {}) });
      if (returns.length > 16) return [];
    } else if (ts.isBlock(node)) pending.push({ statements: [...node.statements, ...rest], conditions, visited: nextVisited });
    else if (ts.isIfStatement(node)) {
      pending.push({ statements: [node.thenStatement, ...rest], conditions: [...conditions, node.expression.getText() + " = true"], visited: nextVisited });
      pending.push({ statements: [...(node.elseStatement ? [node.elseStatement] : []), ...rest],
        conditions: [...conditions, node.expression.getText() + " = false"], visited: nextVisited });
    } else if (ts.isVariableStatement(node) || ts.isExpressionStatement(node) || ts.isEmptyStatement(node)) {
      pending.push({ statements: rest, conditions, visited: nextVisited });
    } else return [];
  }
  return returns;
}

/** Closed primitive literals alone supply JSON values; expressions and oversized display values stay unproved. */
function literalJson(expression: ts.Expression): string | undefined {
  const value = ts.isStringLiteral(expression) ? JSON.stringify(expression.text)
    : ts.isNumericLiteral(expression) && Number.isFinite(Number(expression.text)) ? JSON.stringify(Number(expression.text))
      : [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(expression.kind) ? expression.getText() : undefined;
  return value !== undefined && value.length <= 240 ? value : undefined;
}

/** Primitive formal parameters cannot hide defaults, rest evaluation, destructuring or object/getter behavior. */
function simpleParameters(fn: ts.FunctionDeclaration): boolean {
  return fn.parameters.every(parameter => ts.isIdentifier(parameter.name) && !parameter.initializer && !parameter.dotDotDotToken
    && parameter.type !== undefined && ["string", "number", "boolean"].includes(parameter.type.getText()));
}
const primitiveOperators = new Set<ts.SyntaxKind>([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken]);
