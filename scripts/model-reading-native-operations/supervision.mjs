/** Offline operation-specific labels from independently parsed native source.
 * No old completion or evaluation reply enters this API. The sentences are
 * training targets only, never static answers for runtime inference.
 */
import assert from 'node:assert/strict';
import { createNativeOperationFlowPlan } from './plan.mjs';
const q = value => '`' + value + '`';

/** Label the five supported operations with separate positive and absence evidence.
 * Full expressions, true loop predicates and normal-return conditions survive.
 * Unsupported shapes yield no labels; overflow is rejected rather than clipped.
 */
export function createNativeOperationFlowSupervision(context, locale) {
  assert.ok(['ko', 'en'].includes(locale));
  const plan = createNativeOperationFlowPlan(context);
  if (!plan.operationSlots.length) return undefined;
  const { nativeEvidence, operationSlots, shape } = plan;
  const [transfer, initial, change, returned, use] = operationSlots;
  const ko = locale === 'ko', candidate = initial.confidence === 'inferred';
  const actor = ko ? `${candidate ? '후보 대상' : '대상'} ${q(initial.callable)}`
    : `${candidate ? 'Candidate callee' : 'Callee'} ${q(initial.callable)}`;
  const update = shape === 'loop' ? change.event.body[0] : change.event;
  const declaration = `${initial.event.binding} = ${initial.event.expression}`;
  const mutation = `${update.binding} ${update.operator} ${update.expression}`;
  const texts = [
    ko ? `부모 ${q(transfer.callable)}는 ${q(transfer.event.expression)}로 인수 ${q(transfer.event.invocation.argument)}를 전달합니다.`
      : `Parent ${q(transfer.callable)} passes ${q(transfer.event.invocation.argument)} through ${q(transfer.event.expression)}.`,
    ko ? `${actor}에서는 지역 ${q(declaration)}를 초기화합니다.`
      : `${actor} initializes local ${q(declaration)}.`,
    shape === 'loop'
      ? ko ? `${actor}에서는 ${q(change.event.predicate)}인 동안 ${q(mutation)}를 반복합니다.`
        : `${actor} repeats ${q(mutation)} while ${q(change.event.predicate)}.`
      : ko ? `${actor}에서는 ${q(mutation)}로 지역 값을 갱신합니다.`
        : `${actor} updates the local value with ${q(mutation)}.`,
    ko ? `${actor}에서는 ${shape === 'loop' ? '반복 종료 경로에서' : '앞선 갱신 후'} ${q(returned.event.expression)}를 반환하며 명시적 내부 호출은 없습니다.`
      : `${actor} ${shape === 'loop' ? 'returns, if the loop exits,' : 'returns, after the preceding update,'} ${q(returned.event.expression)}, with no explicit inner calls.`,
    ko ? `대상이 정상 복귀하면 부모 ${q(use.callable)}가 호출 결과를 반환합니다.`
      : `If the callee returns normally, parent ${q(use.callable)} returns the call result.`,
  ];
  assert.equal(new Set(texts).size, 5);
  for (const text of texts) {
    assert.ok(text.trim() && /[.!?]$/u.test(text));
    if (ko) assert.match(text, /^[가-힣]/u);
  }
  const flowScalars = Array.from(texts.join(' ')).length;
  assert.ok(flowScalars <= 600, `Full native operation flow bound: ${flowScalars}`);
  const steps = operationSlots.map((slot, index) => ({ sourceId: slot.sourceId, text: texts[index] }));
  // Absence is not a positive statement span. It is supported by a complete
  // native declaration and its full explicit-invocation inventory instead.
  const callee = nativeEvidence.owners.find(owner => owner.role === 'callee');
  assert.equal(callee.completeNativeBody, true); assert.equal(callee.sourceTruncated, false);
  assert.deepEqual(callee.explicitInvocations, { completeInventory: true, sites: [] });
  const absenceAssertions = [{ index: 3, sourceId: callee.sourceId, callable: callee.callable,
    kind: 'no-explicit-inner-invocations', completeNativeBody: true, sourceTruncated: false,
    explicitInvocations: structuredClone(callee.explicitInvocations) }];
  const claims = operationSlots.map((slot, index) => ({ index, sourceId: slot.sourceId, actor: slot.callable,
    kind: slot.kind, ...(slot.confidence ? { confidence: slot.confidence } : {}), syntaxOnly: true,
    ...(index === 3 && shape === 'loop' ? { condition: 'if-loop-exits' } : {}),
    ...(index === 4 ? { condition: 'if-callee-returns-normally' } : {}),
    facts: structuredClone(slot.ledger) }));
  return { steps, claims, absenceAssertions, shape, flowScalars, nativeEvidence, operationSlots };
}
