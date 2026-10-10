/** Offline native-parser boundary for source-owned training labels; never imported by inference.
 * Only the existing small synthetic declaration vocabulary is accepted. An
 * unsupported statement is refused rather than assigned a guessed owner.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const kotlin = require('../out/analyzer/languages/kotlin');
const identifier = '[A-Za-z_$][A-Za-z0-9_$]*';
const scalar = `(?:${identifier}|-?\\d+)`;
const pureExpression = new RegExp(`^${scalar}(?:\\s*(?:[+*/-]|<=|>=|<|>)\\s*${scalar})?$`, 'u');

/** Preserve source expressions verbatim; this bounded label vocabulary never evaluates them. */
function pure(text) {
  assert.ok(typeof text === 'string' && pureExpression.test(text), `Unsupported source expression: ${text}`);
  return text;
}

/** Parse one complete declaration, or validate the visible fragment with one explicitly recorded closing brace.
 * The original truncated source is retained byte for byte. The validation-only
 * brace is never included in prompts, evidence spans, or claims about the tail.
 */
export function readModelReadingDeclaration(snippet, language) {
  assert.ok(['typescript', 'kotlin'].includes(language));
  assert.ok(typeof snippet?.text === 'string' && snippet.text.trim());
  const original = snippet.text, truncated = snippet.truncated === true;
  if (truncated) assert.match(original,
    /^(?:function|fun)\s+[A-Za-z_$][A-Za-z0-9_$]*\([^{}]*\)[^{]*\{\s*if\s*\([^{};\r\n]+\)\s*(?:\{\s*return\s+[^{};\r\n]+;?\s*\}|return\s+[^{};\r\n]+;?)\s*$/u,
    'Only the owned unfinished single-if fragment is supported');
  const text = original + (truncated ? ' }' : '');
  let name, parameters, body, dialect;
  if (language === 'typescript') {
    const source = ts.createSourceFile('ownership.ts', text, ts.ScriptTarget.Latest, true);
    assert.equal(source.parseDiagnostics.length, 0, 'Recovered TypeScript is not complete evidence');
    assert.equal(source.statements.length, 1);
    const declaration = source.statements[0];
    assert.ok(ts.isFunctionDeclaration(declaration) && declaration.body && !declaration.asteriskToken && !declaration.modifiers?.length);
    name = declaration.name?.text;
    parameters = declaration.parameters.map(parameter => {
      assert.ok(ts.isIdentifier(parameter.name) && !parameter.initializer && !parameter.dotDotDotToken && !parameter.questionToken);
      assert.equal(parameter.type?.getText(source), 'number');
      return parameter.name.text;
    });
    dialect = typescriptDialect(source); body = declaration.body;
  } else {
    const source = kotlin.parseKotlinSource(text, '/workspace/source-ownership.kt');
    assert.deepEqual(source.diagnostics, [], 'Recovered Kotlin is not complete evidence');
    const declarations = kotlin.collectKotlinFunctionDeclarations(source);
    assert.equal(declarations.length, 1);
    const declaration = declarations[0];
    assert.ok(declaration.body && !declaration.expressionBody && !declaration.suspend && !declaration.receiverType);
    assert.equal(declaration.kind, 'function');
    // Refuse a second top-level declaration even if it is not a function.
    assert.match(text.slice(0, declaration.node.from), /^\s*$/u);
    assert.match(text.slice(declaration.node.to), /^\s*$/u);
    name = declaration.name;
    parameters = declaration.parameters.map(parameter => {
      assert.equal(parameter.typeText, 'Int'); assert.ok(!parameter.defaultText && !parameter.vararg);
      return parameter.name;
    });
    dialect = kotlinDialect(source); body = declaration.body;
  }
  assert.equal(parameters.length, 1);
  const statements = [], pending = [{ body, output: statements, depth: 0 }], visited = new Set();
  let visitedCount = 0;
  // Explicit work queue: no recursive AST or graph traversal, including nested
  // control bodies. Native parser resource guards remain in force separately.
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const job = pending[cursor];
    assert.ok(job.depth <= 16 && ++visitedCount <= 128 && !visited.has(job.body), 'Ownership traversal bound/cycle');
    visited.add(job.body);
    for (const node of dialect.statements(job.body)) {
      const { value, children = [] } = dialect.read(node);
      if (!value) continue; // A TypeScript empty statement has no authored work.
      assert.ok(value.from >= 0 && value.to <= original.length, 'Validation suffix cannot own source work');
      job.output.push(value);
      for (const child of children) pending.push({ ...child, depth: job.depth + 1 });
    }
  }
  return { sourceId: snippet.id, sourceText: original, language, name, parameters, statements, truncated,
    validationOnlySuffix: truncated ? ' }' : '', nativeParseComplete: !truncated };
}

/** Translate supported TypeScript statements without walking deferred/nested declarations. */
function typescriptDialect(source) {
  const text = node => node.getText(source), range = node => ({ from: node.getStart(source), to: node.end });
  const child = (body, output) => ({ body, output });
  return {
    statements: body => ts.isBlock(body) ? [...body.statements] : [body],
    read(node) {
      if (ts.isEmptyStatement(node)) return {};
      const value = { ...range(node), code: text(node) }, children = [];
      if (ts.isReturnStatement(node)) Object.assign(value, readReturn(node.expression && text(node.expression)));
      else if (ts.isIfStatement(node)) {
        assert.ok(!node.elseStatement); Object.assign(value, { kind: 'if', predicate: pure(text(node.expression)), body: [] });
        children.push(child(node.thenStatement, value.body));
      } else if (ts.isWhileStatement(node)) {
        Object.assign(value, { kind: 'while', predicate: pure(text(node.expression)), body: [] }); children.push(child(node.statement, value.body));
      } else if (ts.isTryStatement(node)) {
        Object.assign(value, { kind: 'try', body: [], caught: [], cleanup: [] }); children.push(child(node.tryBlock, value.body));
        if (node.catchClause) children.push(child(node.catchClause.block, value.caught));
        if (node.finallyBlock) children.push(child(node.finallyBlock, value.cleanup));
      } else if (ts.isVariableStatement(node)) {
        assert.equal(node.declarationList.declarations.length, 1);
        assert.equal(node.declarationList.flags & ts.NodeFlags.Let, ts.NodeFlags.Let);
        const declaration = node.declarationList.declarations[0]; assert.ok(ts.isIdentifier(declaration.name));
        assert.ok(!declaration.type || text(declaration.type) === 'number');
        Object.assign(value, { kind: 'declare', name: declaration.name.text, expression: pure(text(declaration.initializer)) });
      } else if (ts.isExpressionStatement(node)) {
        const expression = text(node.expression);
        Object.assign(value, readLeaf(expression));
      } else throw new Error(`Unsupported TypeScript statement: ${ts.SyntaxKind[node.kind]}`);
      return { value, children };
    },
  };
}

/** Unwrap grammar-only single-child chains, stopping at a real supported Kotlin statement. */
function kotlinDialect(source) {
  const text = node => kotlin.kotlinNodeText(source, node), named = kotlin.getKotlinChildNamed;
  const supported = new Set(['jumpExpression', 'ifExpression', 'whileStatement', 'tryExpression', 'propertyDeclaration', 'assignment']);
  const child = (body, output) => ({ body, output });
  return {
    statements: kotlin.getKotlinBodyStatements,
    read(statement) {
      // This grammar can place the return operand's call/binary suffix outside
      // jumpExpression. The native RETURN token must start the whole statement;
      // the full bounded operand is validated instead of dropping that suffix.
      const returns = kotlin.findKotlinDescendants(statement, entry => entry.name === 'RETURN');
      if (returns.length === 1 && returns[0].from === statement.from) {
        return { value: { from: statement.from, to: statement.to, code: text(statement),
          ...readReturn(source.text.slice(returns[0].to, statement.to).trim()) } };
      }
      let node = statement;
      const seen = new Set();
      while (!supported.has(node.name)) {
        if (node.name === 'postfixUnaryExpression' && node.children.some(entry => entry.name === 'postfixUnarySuffix'
          && named(entry, 'callSuffix'))) break;
        assert.ok(!seen.has(node) && seen.size < 64); seen.add(node);
        const structural = node.children.filter(entry => entry.children.length);
        assert.equal(structural.length, 1, `Unsupported Kotlin statement: ${node.name}`);
        node = structural[0];
      }
      const value = { from: node.from, to: node.to, code: text(node) }, children = [];
      if (node.name === 'jumpExpression') {
        assert.ok(named(node, 'RETURN')); Object.assign(value, readReturn(text(named(node, 'expression'))));
      } else if (node.name === 'ifExpression' || node.name === 'whileStatement') {
        const bodies = node.children.filter(entry => entry.name === 'controlStructureBody'); assert.equal(bodies.length, 1);
        Object.assign(value, { kind: node.name === 'ifExpression' ? 'if' : 'while', predicate: pure(text(named(node, 'expression'))), body: [] });
        children.push(child(bodies[0], value.body));
      } else if (node.name === 'tryExpression') {
        Object.assign(value, { kind: 'try', body: [], caught: [], cleanup: [] }); children.push(child(named(node, 'block'), value.body));
        const catches = node.children.filter(entry => entry.name === 'catchBlock'); assert.ok(catches.length <= 1);
        if (catches.length) children.push(child(named(catches[0], 'block'), value.caught));
        const cleanup = named(node, 'finallyBlock'); if (cleanup) children.push(child(named(cleanup, 'block'), value.cleanup));
      } else if (node.name === 'propertyDeclaration') {
        assert.ok(named(node, 'VAR'));
        const declaration = named(node, 'variableDeclaration');
        assert.match(text(declaration), new RegExp(`^${identifier}$`, 'u'));
        Object.assign(value, { kind: 'declare', name: text(declaration), expression: pure(text(named(node, 'expression'))) });
      } else Object.assign(value, readLeaf(text(node)));
      return { value, children };
    },
  };
}

/** Only simple local updates or direct one-argument invocations occur in this offline corpus. */
function readLeaf(text) {
  const assignment = new RegExp(`^(${identifier})\\s*([+*/-]?=)\\s*(.+)$`, 'u').exec(text);
  if (assignment) return { kind: 'assign', name: assignment[1], operator: assignment[2], expression: pure(assignment[3]) };
  const call = new RegExp(`^(${identifier})\\(([^()]*)\\)$`, 'u').exec(text);
  assert.ok(call, `Unsupported leaf: ${text}`);
  return { kind: 'call', callee: call[1], argument: pure(call[2]) };
}

/** A parent returning an invocation has its own return-use owner, separate from the callee body. */
function readReturn(expression) {
  if (typeof expression === 'string' && /\(/u.test(expression)) {
    const invocation = readLeaf(expression); assert.equal(invocation.kind, 'call');
    return { kind: 'return', expression, invocation };
  }
  return { kind: 'return', expression: pure(expression) };
}

/** Clear the shared parser's bounded source snapshots when the offline job finishes. */
export function disposeModelReadingSourceOwnershipEvidence() { kotlin.disposeKotlinSyntaxCache(); }
