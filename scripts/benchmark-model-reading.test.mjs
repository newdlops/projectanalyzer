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
