/** Counterexamples keep immutable syntax fields from masking unsupported model claims. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPublicModelReading } from './benchmark-model-reading.mjs';
const names = { parent: 'checkout', callee: 'addFee', effect: 'audit' };
const reading = { summary: 'checkout forwards amount to addFee and returns the result.',
  flow: 'The source calls addFee(amount). It calculates value + 5 or a catch return of 0; audit(value) is unimplemented.',
  calls: [{ role: 'The callee calculates an adjusted result and provides a catch fallback.',
    inputs: 'Owned inputs.', output: 'Owned returns.', effects: 'Owned unknown effects.', reason: 'Owned guards.' }] };
test('valid source descriptions and identifiers are retained without inventing a business meaning', () => {
  assert.deepEqual(checkPublicModelReading(reading, names), []);
});
test('all owned fields can remain correct while the authored role, I/O or parent guard fails', () => {
  for (const [field, value, reason] of [
    ['role', 'role', 'generic-or-unsupported-call-role'],
    ['summary', 'The source adds a fee to the amount.', 'invented-business-purpose'],
    ['flow', 'The finally block audits the value.', 'unproved-inner-call-behavior'],
    ['flow', '조건에 따라 대상 함수가 호출됩니다.', 'invented-parent-call-guard'],
    ['role', '값이 없으면 0을 반환합니다.', 'invented-missing-input-branch'],
    ['summary', 'Parent0 returns the result.', 'unrestored-callable-alias'],
    ['summary', '추가 요금을 계산합니다.', 'invented-business-purpose'],
    ['summary', '정해진 금액에 추가 비용 적용 후 총액 반환', 'invented-business-purpose'],
    ['summary', '구매 금액을 반환합니다.', 'invented-business-purpose'],
    ['role', '구매 금액에 5 원을 추가합니다.', 'invented-business-purpose'],
    ['role', '예외 발생 시 0 반환, 최종 금액 기록', 'unproved-inner-call-behavior'],
    ['flow', 'finally에서 감사 기록을 남깁니다.', 'unproved-inner-call-behavior'],
    ['flow', 'The audit call runs after the function returns.', 'incorrect-finally-completion-order'],
    ['flow', '감사 호출은 완료 후 수행됩니다.', 'incorrect-finally-completion-order'],
    ['role', 'It updates the input value.', 'invented-input-write'],
    ['role', 'It triggers an observation side effect.', 'unproved-inner-call-behavior'],
    ['flow', 'It returns value + 5; audit(value) is unimplemented.', 'missing-authored-catch-return']
  ]) {
    const valueReading = field === 'role' ? { ...reading, calls: [{ ...reading.calls[0], role: value }] } : { ...reading, [field]: value };
    assert.ok(checkPublicModelReading(valueReading, names).includes(reason), reason);
  }
});
test('unsupported assumptions fail even when summary, flow and fixed fields remain accurate', () => {
  const result = checkPublicModelReading({ ...reading, limitations: ['주문 금액이 0인 경우 수수료를 추가하지 않음'] }, names);
  assert.ok(result.includes('invented-business-purpose'));
});
test('finally-before-return wording and exact source expressions are not input writes', () => {
  const result = checkPublicModelReading({ ...reading,
    flow: 'The return expression is value + 5, with a catch return of 0. Finally calls audit(value) before return completion; its behavior is unknown.',
    limitations: ['Actual completion of audit(value) is unknown.'] }, names);
  assert.deepEqual(result, []);
});
test('a function name alone is not a role and a named callee cannot complete before finally', () => {
  for (const role of ['addFee', '`addFee`', 'checkout']) {
    assert.ok(checkPublicModelReading({ ...reading, calls: [{ ...reading.calls[0], role }] }, names)
      .includes('generic-or-unsupported-call-role'));
  }
  for (const summary of [
    'The audit function is called in a finally block after addFee completes.',
    'Finally calls audit(value) after `addFee` returns.',
    'audit(value) runs after addFee(value) completes.'
  ]) {
    assert.ok(checkPublicModelReading({ ...reading, summary }, names).includes('incorrect-finally-completion-order'));
  }
  assert.deepEqual(checkPublicModelReading({ ...reading,
    summary: 'After the try expression is evaluated, finally calls audit(value) before addFee completes.' }, names), []);
});
test('correct immutable returns cannot conceal copied numeric alternatives, clipped citations or missing cleanup arguments', () => {
  const source = 'function checkout(amount) { return addFee(amount); } function addFee(value) { try { return value + 5; } catch (error) { return 0; } finally { audit(value); } }';
  const options = { ...names, source, locale: 'en' };
  assert.deepEqual(checkPublicModelReading(reading, options), []);
  for (const [field, value, expected] of [
    ['role', 'Calculate `value + 5` or `-1`.', 'invented-authored-numeric-literal'],
    ['role', 'Choose `value + 5` or `0` in catch`.', 'unclosed-authored-source-expression'],
    ['role', 'Return the result; 倘', 'non-english-authored-prose'],
    ['role', '콜러', 'generic-or-unsupported-call-role'],
    ['flow', 'Try computes the result and catch returns 0. Finally calls audit(value).', 'missing-authored-return-calculation'],
    ['flow', 'Try returns value + 5 and catch returns 0. Finally calls audit.', 'missing-authored-cleanup-argument'],
    ['flow', reading.flow + ' ' + reading.flow, 'repeated-authored-flow-sentence']
  ]) {
    const candidate = field === 'role' ? { ...reading, calls: [{ ...reading.calls[0], role: value }] } : { ...reading, [field]: value };
    assert.ok(checkPublicModelReading(candidate, options).includes(expected), expected);
  }
  assert.deepEqual(checkPublicModelReading({ ...reading, calls: [{ ...reading.calls[0], role: 'Return `0` or `5`; identifiers such as `中文` stay quoted.' }] }, options), []);
  assert.deepEqual(checkPublicModelReading({ ...reading, calls: [{ ...reading.calls[0], role: 'Return `0` or `5`.' }] },
    { ...options, source: source.replace('value + 5', 'value +5') }), []);
});
test('punctuation cannot turn a role placeholder into a description or source metadata into source behavior', () => {
  for (const role of ['역할”, ', '“role”,', '`addFee`,', '역할/목적,', 'role/purpose']) {
    assert.ok(checkPublicModelReading({ ...reading, calls: [{ ...reading.calls[0], role }] }, names)
      .includes('generic-or-unsupported-call-role'));
  }
  for (const summary of ['call-1-caller가 value를 전달합니다.', 'callId를 따라 설명합니다.', 'endResult은 0이 됩니다.']) {
    assert.ok(checkPublicModelReading({ ...reading, summary }, names).includes('leaked-internal-call-metadata'));
  }
});
test('a conditional catch fallback cannot be presented as the unconditional final result', () => {
  for (const summary of [
    '반환값 0이 기본값으로 결정됩니다.', '최종 결과는 0이 됩니다.', '항상 0을 반환합니다.',
    'The result is 0.', 'The returned value defaults to 0.', 'It always returns 0.'
  ]) {
    assert.ok(checkPublicModelReading({ ...reading, summary }, names).includes('unconditional-catch-result'), summary);
  }
  for (const summary of [
    '예외가 발생한 경우 반환값은 0이 됩니다.', 'When catch is reached, the result is 0.',
    'The returned value is 0 if an error is caught.', 'It returns value + 5 or a catch fallback of 0.'
  ]) {
    assert.deepEqual(checkPublicModelReading({ ...reading, summary }, names), [], summary);
  }
});
