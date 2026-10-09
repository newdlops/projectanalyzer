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
    ['summary', 'Parent0 returns the result.', 'unrestored-callable-alias']
  ]) {
    const valueReading = field === 'role' ? { ...reading, calls: [{ ...reading.calls[0], role: value }] } : { ...reading, [field]: value };
    assert.ok(checkPublicModelReading(valueReading, names).includes(reason), reason);
  }
});
