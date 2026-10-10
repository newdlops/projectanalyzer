/** Offline native control/ownership evidence for model latency experiments.
 * The public API returns machine facts and a separate span ledger, never prose
 * or replacement responses. Unsupported synthetic vocabulary is refused.
 */
import assert from 'node:assert/strict';
import { readModelReadingDeclaration } from './model-reading-source-ownership-evidence.mjs';

/** Project supplied native declarations into explicit local/control/return relationships.
 * Full original source remains in the caller's context. The projection records
 * direct invocation syntax only, without proving runtime dispatch or effects.
 */
export function createModelReadingSourceControlEvidence(context) {
  const task = context.callTask;
  assert.ok(task?.includeSummary && task.targets.length === 1 && task.sequence.length === 1);
  const target = task.targets[0];
  assert.equal(target.relation, 'call'); assert.equal(target.deferred, false);
  assert.deepEqual(target.guards, []); assert.deepEqual(target.loops, []);
  assert.equal(task.sequence[0].callId, target.callId);
  const snippets = context.snippets.filter(snippet => ['function', 'helper'].includes(snippet.role));
  const roots = snippets.filter(snippet => snippet.role === 'function');
  const helpers = snippets.filter(snippet => snippet.role === 'helper');
  assert.equal(roots.length, 1); assert.ok(helpers.length <= 1);
  assert.equal(roots[0].truncated, false);
  assert.equal(new Set(snippets.map(snippet => snippet.id)).size, snippets.length);
  const declarations = snippets.map(snippet => readModelReadingDeclaration(snippet, context.language));
  const parent = declarations[snippets.indexOf(roots[0])];
  assert.equal(parent.name, context.functionName); assert.equal(parent.name, target.caller);
  assert.notEqual(parent.name, target.callee, 'The bounded two-actor projection cannot prove a recursive target binding');
  assert.equal(new Set(declarations.map(item => item.name)).size, declarations.length, 'Ambiguous same-name body snapshots');
  assert.equal(parent.statements.length, 1);
  const use = parent.statements[0];
  assert.equal(use.kind, 'return'); assert.ok(use.invocation);
  assert.equal(use.expression, target.expression);
  assert.equal(use.invocation.callee, target.callee);
  assert.deepEqual(target.arguments, [use.invocation.argument]);
  if (helpers.length) {
    const callee = declarations[snippets.indexOf(helpers[0])];
    assert.equal(callee.sourceId, target.calleeSnippet); assert.equal(callee.name, target.callee);
    assert.deepEqual(callee.parameters, target.parameters?.map(parameter => parameter.name));
    assert.ok(['exact', 'inferred'].includes(target.confidence));
    assert.equal(callee.truncated, target.sourceLimited);
  } else {
    assert.equal(target.calleeSnippet, undefined); assert.equal(target.confidence, 'unresolved');
    assert.equal(target.sourceLimited, true);
  }
  const suppliedBodies = new Map(declarations.map(item => [item.name, item]));
  const owners = [], ledger = [];
  for (const declaration of declarations) {
    const events = [], localBindings = [], invocations = [];
    const pending = [{ source: declaration.statements, output: events, path: [], depth: 0 }], visited = new Set();
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const job = pending[cursor]; assert.ok(job.depth <= 16);
      for (const [index, node] of job.source.entries()) {
        assert.ok(!visited.has(node) && visited.size < 128, 'Control evidence traversal bound/cycle');
        visited.add(node);
        assert.ok(node.from >= 0 && node.to <= declaration.sourceText.length && node.to > node.from);
        assert.equal(declaration.sourceText.slice(node.from, node.to), node.code);
        const path = [...job.path, index], event = {}, citations = [];
        const cite = expression => {
          assert.ok(declaration.sourceText.slice(node.from, node.to).replace(/\s+/gu, '')
            .includes(expression.replace(/\s+/gu, '')), 'Control evidence expression must belong to its own source');
          citations.push(expression); return expression;
        };
        const invoke = (callee, argument) => {
          const supplied = suppliedBodies.get(callee);
          const invocation = { callee: cite(callee), argument: cite(argument),
            suppliedBodyState: supplied ? supplied.truncated ? 'truncated' : 'complete' : 'missing',
            relationshipConfidence: declaration.sourceId === parent.sourceId && callee === target.callee
              ? target.confidence : 'unresolved' };
          invocations.push({ path, ...invocation }); return invocation;
        };
        if (node.kind === 'declare') {
          Object.assign(event, { kind: 'initialize-local', binding: cite(node.name), expression: cite(node.expression) });
          localBindings.push(node.name);
        } else if (node.kind === 'assign') {
          Object.assign(event, { kind: 'update-local', binding: cite(node.name), operator: cite(node.operator), expression: cite(node.expression) });
        } else if (node.kind === 'return') {
          Object.assign(event, { kind: node.invocation ? 'return-call-result' : 'return-value', expression: cite(node.expression) });
          if (node.invocation) event.invocation = invoke(node.invocation.callee, node.invocation.argument);
        } else if (node.kind === 'call') {
          Object.assign(event, { kind: 'invoke', ...invoke(node.callee, node.argument) });
        } else if (node.kind === 'if' || node.kind === 'while') {
          Object.assign(event, { kind: node.kind, predicate: cite(node.predicate), body: [] });
          pending.push({ source: node.body, output: event.body, path: [...path, 'body'], depth: job.depth + 1 });
        } else if (node.kind === 'try') {
          Object.assign(event, { kind: 'try', body: [], catchBody: [], finallyBody: [] });
          for (const [sourceKey, outputKey] of [['body', 'body'], ['caught', 'catchBody'], ['cleanup', 'finallyBody']]) {
            pending.push({ source: node[sourceKey], output: event[outputKey], path: [...path, outputKey], depth: job.depth + 1 });
          }
        } else throw Error('Unsupported control evidence node: ' + node.kind);
        job.output.push(event);
        ledger.push({ sourceId: declaration.sourceId, callable: declaration.name, path,
          kind: event.kind, from: node.from, to: node.to, code: node.code, expressions: citations });
      }
    }
    owners.push({ sourceId: declaration.sourceId, callable: declaration.name,
      role: declaration.sourceId === parent.sourceId ? 'caller' : 'callee',
      ...(declaration.sourceId !== parent.sourceId ? { confidence: target.confidence } : {}),
      sourceTruncated: declaration.truncated, completeNativeBody: declaration.nativeParseComplete,
      localBindings, explicitInvocations: { completeInventory: !declaration.truncated, sites: invocations }, events });
  }
  return { owners, unavailableTargetBodies: helpers.length ? [] : [{ callee: target.callee, confidence: target.confidence }],
    ledger, syntaxOnly: true };
}
