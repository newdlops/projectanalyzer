/** Event-bound flow transport for offline experiments, independent of labels.
 * This preserves the earlier private pilot's schema and guidance exactly.
 * Decoding validates operation ownership then forwards the original raw text.
 */
import assert from 'node:assert/strict';
import { createNativeOperationFlowPlan } from './plan.mjs';

/** Refine only the flow representation; retain every other generated field and bound.
 * Aggregate prose validation belongs to the supplied base decoder. No generated
 * character, missing field or inaccurate sentence is fixed by this adapter.
 */
export function createNativeOperationFlowContract(context, base, locale) {
  assert.ok(['ko', 'en'].includes(locale));
  const { nativeEvidence, operationSlots } = createNativeOperationFlowPlan(context);
  if (!operationSlots.length) return { ...base, nativeEvidence, operationSlots };
  const schema = structuredClone(base.schema), step = schema.properties.flow.items;
  assert.equal(schema.properties.flow.minItems, 3); assert.equal(schema.properties.flow.maxItems, 5);
  assert.equal(step.properties.text.maxLength, 600);
  schema.properties.flow = { ...schema.properties.flow, minItems: 5, maxItems: 5,
    items: operationSlots.map(slot => ({ ...structuredClone(step), properties: {
      sourceId: { type: 'string', const: slot.sourceId },
      text: { ...structuredClone(step.properties.text), description: JSON.stringify({
        nativeOperation: { sourceId: slot.sourceId, callable: slot.callable, kind: slot.kind,
          event: slot.event, ...(slot.confidence ? { confidence: slot.confidence } : {}), syntaxOnly: true },
      }) },
    } })) };
  const guidance = base.guidance + '\n' + (locale === 'ko'
    ? '이 요청의 flow 다섯 칸은 schema의 nativeOperation 순서에 대응합니다. 각 text는 해당 원문 동작을 주체와 함께 완전한 한 문장으로 설명합니다. 초기화·갱신 또는 반복·반환을 각자의 칸에서 설명하고, 마지막 부모 결과 사용은 정상 복귀 조건을 보존합니다. 모든 모델 작성 필드와 연결된 전체 flow의 원래 한도를 유지합니다.'
    : 'The five flow slots correspond to the schema nativeOperation order. Each text describes its own source operation and actor in one complete sentence. Describe initialization, update or repetition, and return in their respective slots; preserve normal-return conditions for final caller result use. Keep every authored field and the original bound on the complete joined flow.');
  const decode = raw => {
    const parsed = JSON.parse(raw);
    assert.ok(Array.isArray(parsed.flow) && parsed.flow.length === operationSlots.length);
    for (const [index, item] of parsed.flow.entries()) assert.equal(item.sourceId, operationSlots[index].sourceId);
    return base.decode(raw);
  };
  return { schema, owners: base.owners, guidance, decode, nativeEvidence, operationSlots };
}
