/** Native control projection regression tests: ownership, nesting, partial source and false absence claims. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createModelReadingSourceControlEvidence } from './model-reading-source-control-evidence.mjs';
import { disposeModelReadingSourceOwnershipEvidence } from './model-reading-source-ownership-evidence.mjs';
after(disposeModelReadingSourceOwnershipEvidence);

/** Independent tiny sources provide explicit actor/argument and complete-or-truncated boundaries. */
function context(language, body, options = {}) {
  const kotlin = language === 'kotlin';
  const parent = kotlin ? 'fun relay(seed: Int): Int { return calculate(seed) }'
    : 'function relay(seed: number): number { return calculate(seed); }';
  const helper = body === undefined ? undefined : (kotlin ? 'fun calculate(value: Int): Int { '
    : 'function calculate(value: number): number { ') + body + (options.partial ? '' : ' }');
  const snippets = [{ id: 'root', role: 'function', text: parent, truncated: false },
    { id: 'site', role: 'caller', text: 'calculate(seed)', truncated: false }];
  if (helper) snippets.push({ id: 'body', role: 'helper', text: helper, truncated: Boolean(options.partial) });
  return { functionName: 'relay', language, snippets, callTask: { includeSummary: true,
    sequence: [{ callId: 'one' }], targets: [{ callId: 'one', caller: 'relay', callee: 'calculate',
      relation: 'call', deferred: false, guards: [], loops: [], expression: 'calculate(seed)', arguments: ['seed'],
      confidence: helper ? options.inferred ? 'inferred' : 'exact' : 'unresolved',
      sourceLimited: !helper || Boolean(options.partial), ...(helper ? { calleeSnippet: 'body', parameters: [{ name: 'value' }] } : {}) }] } };
}

test('local initialization, update and return belong to the actual callee, without invented invocations', () => {
  for (const language of ['typescript', 'kotlin']) {
    const input = context(language, (language === 'kotlin' ? 'var' : 'let') + ' balance = value * 7; balance -= 2; return balance' + (language === 'typescript' ? ';' : ''));
    const snapshot = JSON.stringify(input), evidence = createModelReadingSourceControlEvidence(input);
    assert.equal(JSON.stringify(input), snapshot);
    const [parent, callee] = evidence.owners;
    assert.equal(parent.events[0].kind, 'return-call-result');
    assert.deepEqual(parent.events[0].invocation, { callee: 'calculate', argument: 'seed',
      suppliedBodyState: 'complete', relationshipConfidence: 'exact' });
    assert.deepEqual(callee.events, [
      { kind: 'initialize-local', binding: 'balance', expression: 'value * 7' },
      { kind: 'update-local', binding: 'balance', operator: '-=', expression: '2' },
      { kind: 'return-value', expression: 'balance' },
    ]);
    assert.deepEqual(callee.explicitInvocations, { completeInventory: true, sites: [] });
    assert.deepEqual(callee.localBindings, ['balance']);
    for (const entry of evidence.ledger) {
      const snippet = input.snippets.find(item => item.id === entry.sourceId);
      assert.equal(snippet.text.slice(entry.from, entry.to), entry.code);
    }
  }
});

test('while retains the update inside its body and the subsequent return outside it', () => {
  for (const language of ['typescript', 'kotlin']) {
    const input = context(language, (language === 'kotlin' ? 'var' : 'let')
      + ' remaining = value; while (remaining > 19) { remaining -= 6' + (language === 'typescript' ? ';' : '')
      + ' }\nreturn remaining' + (language === 'typescript' ? ';' : ''));
    const evidence = createModelReadingSourceControlEvidence(input), callee = evidence.owners[1];
    assert.equal(callee.events.length, 3);
    assert.deepEqual(callee.events[1], { kind: 'while', predicate: 'remaining > 19',
      body: [{ kind: 'update-local', binding: 'remaining', operator: '-=', expression: '6' }] });
    assert.deepEqual(callee.events[2], { kind: 'return-value', expression: 'remaining' });
    assert.deepEqual(evidence.ledger.find(item => item.kind === 'update-local').path, [1, 'body', 0]);
  }
});

test('try/branch/catch/finally remain separate source regions and unavailable inner implementation stays unknown', () => {
  for (const language of ['typescript', 'kotlin']) {
    const end = language === 'typescript' ? ';' : '';
    const input = context(language, 'try { if (value < 1) { return 8' + end + ' }\nreturn value * 7' + end
      + ' } catch (' + (language === 'kotlin' ? 'issue: Exception' : 'issue') + ') { return -2' + end
      + ' } finally { inspect(value)' + end + ' }', { inferred: true });
    const evidence = createModelReadingSourceControlEvidence(input), callee = evidence.owners[1], attempt = callee.events[0];
    assert.equal(callee.confidence, 'inferred');
    assert.equal(evidence.owners[0].events[0].invocation.relationshipConfidence, 'inferred');
    assert.equal(evidence.owners[0].events[0].invocation.suppliedBodyState, 'complete');
    assert.deepEqual(attempt.body[0], { kind: 'if', predicate: 'value < 1', body: [{ kind: 'return-value', expression: '8' }] });
    assert.deepEqual(attempt.body[1], { kind: 'return-value', expression: 'value * 7' });
    assert.deepEqual(attempt.catchBody, [{ kind: 'return-value', expression: '-2' }]);
    assert.deepEqual(attempt.finallyBody, [{ kind: 'invoke', callee: 'inspect', argument: 'value',
      suppliedBodyState: 'missing', relationshipConfidence: 'unresolved' }]);
    assert.deepEqual(callee.explicitInvocations.sites[0].path, [0, 'finallyBody', 0]);
    assert.ok(evidence.ledger.filter(item => item.sourceId === 'root').every(item => item.kind === 'return-call-result'));
  }
});

test('missing body provides no fabricated callee owner and parent invocation has no complete implementation', () => {
  for (const language of ['typescript', 'kotlin']) {
    const evidence = createModelReadingSourceControlEvidence(context(language));
    assert.equal(evidence.owners.length, 1);
    assert.equal(evidence.owners[0].events[0].invocation.suppliedBodyState, 'missing');
    assert.equal(evidence.owners[0].events[0].invocation.relationshipConfidence, 'unresolved');
    assert.deepEqual(evidence.unavailableTargetBodies, [{ callee: 'calculate', confidence: 'unresolved' }]);
  }
});

test('an inner call cannot borrow the parent edge confidence even when a same-name body is supplied', () => {
  for (const language of ['typescript', 'kotlin']) for (const inner of ['calculate', 'relay']) {
    const end = language === 'typescript' ? ';' : '';
    const evidence = createModelReadingSourceControlEvidence(context(language,
      'try { return value' + end + ' } finally { ' + inner + '(value)' + end + ' }'));
    const invocation = evidence.owners[1].explicitInvocations.sites[0];
    assert.equal(invocation.callee, inner);
    assert.equal(invocation.suppliedBodyState, 'complete');
    assert.equal(invocation.relationshipConfidence, 'unresolved');
    assert.equal(evidence.owners[0].events[0].invocation.relationshipConfidence, 'exact');
  }
});

test('partial callee cannot assert a complete body, complete invocation inventory or an absent tail', () => {
  for (const language of ['typescript', 'kotlin']) {
    const input = context(language, 'if (value < 1) { return 8' + (language === 'typescript' ? ';' : '') + ' }', { partial: true });
    const evidence = createModelReadingSourceControlEvidence(input), callee = evidence.owners[1];
    assert.equal(callee.sourceTruncated, true); assert.equal(callee.completeNativeBody, false);
    assert.equal(callee.explicitInvocations.completeInventory, false);
    assert.equal(evidence.owners[0].events[0].invocation.suppliedBodyState, 'truncated');
    assert.equal(callee.events.length, 1);
    for (const entry of evidence.ledger.filter(item => item.sourceId === 'body')) assert.ok(entry.to <= input.snippets[2].text.length);
  }
});

test('mismatched owner, arguments, target name and unsupported extra work are refused', () => {
  const valid = context('typescript', 'return value * 7;');
  for (const mutate of [
    value => { value.callTask.targets[0].calleeSnippet = 'foreign'; },
    value => { value.callTask.targets[0].arguments = ['foreign']; },
    value => { value.callTask.targets[0].callee = 'foreign'; },
    value => { value.callTask.targets[0].callee = 'relay'; value.callTask.targets[0].expression = 'relay(seed)';
      value.snippets[0].text = 'function relay(seed: number): number { return relay(seed); }'; },
    value => { value.snippets[2].text = 'function calculate(value: number): number { return secret.value; }'; },
    value => { value.snippets[2].text = 'function calculate(value: number): number { function hidden() {} return value; }'; },
  ]) {
    const input = structuredClone(valid); mutate(input);
    assert.throws(() => createModelReadingSourceControlEvidence(input));
  }
});
