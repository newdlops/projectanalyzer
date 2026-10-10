/** Missing-body counterexamples keep correct role/unknown fields from concealing unsupported work in an authored flow. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { findUnavailableCalleeBodyClaims } from './benchmark-model-reading.mjs';

const context = { snippets: [{ id: 'caller', role: 'caller', text: 'unknownTask(sent)' }],
  callTask: { targets: [{ callId: 'owned-call', callerSnippet: 'caller', sourceLimited: true }] } };
const wire = { properties: { summary: { type: 'string' }, flow: { type: 'string' },
  calls: { items: [{ properties: { role: { type: 'string' } } }] } } };
const reading = { summary: 'The caller passes its argument.', flow: 'The missing callee implementation leaves its work unknown.',
  calls: [{ role: 'The callee implementation is unknown.', effects: 'Source-restored unknown effects.' }] };

test('an unrelated unknown statement and correct role cannot excuse a positive Korean claim about an absent body', () => {
  const candidate = { ...reading, flow: '대상의 반환값은 미확인입니다. 대상 본문에서 입력 `sent`를 전달하며 정상 복귀하면 부모가 그 값을 그대로 반환합니다.' };
  const before = structuredClone({ candidate, context, wire });
  assert.deepEqual(findUnavailableCalleeBodyClaims(candidate, context, wire), [{ callId: 'owned-call',
    reason: 'unsupported-missing-callee-body-work', text: '대상 본문에서 입력 `sent`를 전달하며 정상 복귀하면 부모가 그 값을 그대로 반환합니다.' }]);
  assert.deepEqual({ candidate, context, wire }, before);
});

test('English body work is unsupported while caller transfer and explicitly unknown or modal callee work remain valid', () => {
  const candidate = { ...reading, flow: 'The result is unknown. In the callee body, it forwards `sent` to a helper.' };
  assert.equal(findUnavailableCalleeBodyClaims(candidate, context, wire).length, 1);
  for (const flow of [
    'The caller passes `sent`; if the callee returns normally, the caller returns that result.',
    'Whether the callee forwards a value is unknown.',
    'In the callee body, whether it forwards a value is unknown.',
    'In the callee body, it might forward a value; its work is unknown.',
    '대상 본문에서 입력을 전달하는지는 미확인입니다.'
  ]) assert.deepEqual(findUnavailableCalleeBodyClaims({ ...reading, flow }, context, wire), [], flow);
});

test('provided and visibly truncated owned helper bodies are outside this missing-body check', () => {
  const candidate = { ...reading, flow: 'In the callee body, it forwards `sent` to a helper.' };
  for (const truncated of [false, true]) {
    const provided = { snippets: [...context.snippets, { id: 'callee', role: 'helper', text: 'function unknownTask(sent) { return child(sent);', truncated }],
      callTask: { targets: [{ ...context.callTask.targets[0], calleeSnippet: 'callee' }] } };
    assert.deepEqual(findUnavailableCalleeBodyClaims(candidate, provided, wire), []);
  }
  const callerAlias = { ...context, callTask: { targets: [{ ...context.callTask.targets[0], calleeSnippet: 'caller' }] } };
  assert.equal(findUnavailableCalleeBodyClaims(candidate, callerAlias, wire).length, 1);
});

test('only actual generated fields count and multi-call flows are not ambiguously attributed to one missing target', () => {
  const candidate = { ...reading, flow: 'In the callee body, it forwards `sent` to a helper.',
    calls: [{ ...reading.calls[0], effects: 'In the callee body, it updates a variable.' }] };
  const fixedFlow = structuredClone(wire); fixedFlow.properties.flow = { const: candidate.flow };
  assert.deepEqual(findUnavailableCalleeBodyClaims(candidate, context, fixedFlow), []);
  fixedFlow.properties.calls.items[0].properties.effects = { type: 'string' };
  assert.equal(findUnavailableCalleeBodyClaims(candidate, context, fixedFlow).length, 1);
  const multi = { ...context, callTask: { targets: [...context.callTask.targets, { callId: 'second' }] } };
  assert.deepEqual(findUnavailableCalleeBodyClaims({ ...candidate, calls: [...candidate.calls, candidate.calls[0]] }, multi, wire), []);
  assert.throws(() => findUnavailableCalleeBodyClaims(candidate, {}, wire), TypeError);
});
