/** Public counterexamples protect full-model timing from source-only and incomplete-work false positives. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPublicFunctionPurpose, isFreshCompleteFunctionReading } from './benchmark-function-reading.mjs';

test('a source function without loops or branches cannot justify invented repeated multiplication or adjustment', () => {
  const shape = { hasLoop: false, hasBranch: false };
  assert.deepEqual(checkPublicFunctionPurpose('함수는 금액을 5를 더한 후 반복적으로 곱하고, 조건에 따라 결과를 조정한 후 반환한다.', shape),
    ['invented-purpose-loop', 'invented-purpose-branch']);
  assert.deepEqual(checkPublicFunctionPurpose('It repeatedly multiplies the input and adjusts the result depending on conditions.', shape),
    ['invented-purpose-loop', 'invented-purpose-branch']);
  assert.deepEqual(checkPublicFunctionPurpose('It adds 5, doubles the result, calls the supplied function and returns normally.', shape), []);
});
test('real loops, source branches and normal-call prerequisites are retained', () => {
  assert.deepEqual(checkPublicFunctionPurpose('It repeatedly calculates a value and adjusts the result depending on conditions.',
    { hasLoop: true, hasBranch: true }), []);
  assert.deepEqual(checkPublicFunctionPurpose('호출의 정상 복귀 조건에서 입력을 두 배로 계산해 반환합니다.',
    { hasLoop: false, hasBranch: false }), []);
});
test('an absent audit body cannot supply a purpose even when the exact call and result are correct', () => {
  const shape = { hasUnknownAudit: true };
  assert.deepEqual(checkPublicFunctionPurpose('It adds 5, auditing that result, then doubles it before returning.', shape),
    ['unproved-purpose-call-behavior']);
  assert.deepEqual(checkPublicFunctionPurpose('It increases the amount and auditing the result produces an adjusted value.', shape),
    ['unproved-purpose-call-behavior']);
  assert.deepEqual(checkPublicFunctionPurpose('입력을 더해 감사 기록을 남긴 뒤 반환합니다.', shape), ['unproved-purpose-call-behavior']);
  assert.deepEqual(checkPublicFunctionPurpose('It adds 5, calls audit with the result, doubles it and returns.', shape), []);
  assert.deepEqual(checkPublicFunctionPurpose('It audits the result.', { hasUnknownAudit: false }), []);
});
const complete = { complete: true, coverage: { complete: true }, metrics: [{}], fullExplanationMs: 1250,
  score: { scenarios: 1, failures: [], completeNodes: 6, totalNodes: 6 } };
test('a fully completed new model reading may satisfy the three-second boundary', () => {
  assert.equal(isFreshCompleteFunctionReading(complete), true);
  assert.equal(isFreshCompleteFunctionReading({ ...complete, fullExplanationMs: 3000 }), true);
});
test('very fast source-only results and failed or incomplete work cannot count as new model readings', () => {
  for (const record of [
    { ...complete, metrics: [], fullExplanationMs: 8 },
    { ...complete, metrics: undefined },
    { ...complete, error: { code: 'failed' } },
    { ...complete, complete: false },
    { ...complete, coverage: { complete: false } },
    { ...complete, score: { ...complete.score, completeNodes: 5 } },
    { ...complete, score: { ...complete.score, completeNodes: 0, totalNodes: 0 } },
    { ...complete, score: { ...complete.score, scenarios: 0 } },
    { ...complete, score: { ...complete.score, failures: ['invented-purpose-loop'] } }
  ]) assert.equal(isFreshCompleteFunctionReading(record), false);
});
test('missing, non-finite, negative and over-budget full times cannot pass', () => {
  for (const fullExplanationMs of [undefined, NaN, Infinity, -1, 3000.001]) {
    assert.equal(isFreshCompleteFunctionReading({ ...complete, fullExplanationMs }), false);
  }
});
