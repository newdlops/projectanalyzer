/** Independent native-source tests for offline operation plans, labels and raw transport boundaries. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createNativeOperationFlowPlan, createNativeOperationFlowContract,
  createNativeOperationFlowSupervision } from './model-reading-native-operations/index.mjs';
import { disposeModelReadingSourceOwnershipEvidence } from './model-reading-source-ownership-evidence.mjs';
after(disposeModelReadingSourceOwnershipEvidence);

/** Tiny full declarations are independent of the training corpus and model replies. */
function context(language, shape = 'writes', inferred = false) {
  const kt = language === 'kotlin', end = kt ? '' : ';';
  const parent = kt ? 'fun relay(seed: Int): Int { return calculate(seed) }'
    : 'function relay(seed: number): number { return calculate(seed); }';
  const body = shape === 'partial' ? `if (value < 1) { return 8${end} }`
    : shape === 'arithmetic' ? `return value / 7${end}`
      : `${kt ? 'var' : 'let'} balance = value * 7; ${shape === 'loop'
        ? `while (balance > 19) { balance -= 6${end} }\n` : 'balance -= 6; '}return balance${end}`;
  const helper = (kt ? 'fun calculate(value: Int): Int { ' : 'function calculate(value: number): number { ')
    + body + (shape === 'partial' ? '' : ' }');
  return { functionName: 'relay', language,
    snippets: [{ id: 'root', role: 'function', text: parent, truncated: false },
      { id: 'site', role: 'caller', text: 'calculate(seed)', truncated: false },
      ...(shape === 'missing' ? [] : [{ id: 'body', role: 'helper', text: helper, truncated: shape === 'partial' }])],
    callTask: { includeSummary: true, sequence: [{ callId: 'one' }], targets: [{ callId: 'one', caller: 'relay',
      callee: 'calculate', relation: 'call', deferred: false, guards: [], loops: [], expression: 'calculate(seed)',
      arguments: ['seed'], confidence: shape === 'missing' ? 'unresolved' : inferred ? 'inferred' : 'exact',
      sourceLimited: ['missing', 'partial'].includes(shape),
      ...(shape === 'missing' ? {} : { calleeSnippet: 'body', parameters: [{ name: 'value' }] }) }] } };
}

/** A decoder spy checks the adapter boundary, without copying any runtime flattening logic. */
function baseContract(decode = raw => raw) {
  return { guidance: 'Existing contract.', owners: [{ snippetId: 'root' }, { snippetId: 'body' }], decode,
    schema: { type: 'object', additionalProperties: false, required: ['summary', 'flow', 'calls', 'limitations'],
      properties: { summary: { type: 'string', maxLength: 240 }, calls: { type: 'array', maxItems: 8 },
        limitations: { type: 'array', maxItems: 4 }, flow: { type: 'array', minItems: 3, maxItems: 5,
          items: { type: 'object', additionalProperties: false, required: ['sourceId', 'text'], properties: {
            sourceId: { anyOf: [{ type: 'string', enum: ['root', 'body'] }, { type: 'null' }] },
            text: { type: 'string', minLength: 1, maxLength: 600, pattern: '^[가-힣]' },
          } } } } } };
}

test('separate initialization, exact update and return labels retain source ownership in both languages and locales', () => {
  for (const language of ['typescript', 'kotlin']) for (const locale of ['ko', 'en']) for (const inferred of [false, true]) {
    const input = context(language, 'writes', inferred), snapshot = structuredClone(input);
    const result = createNativeOperationFlowSupervision(input, locale);
    assert.deepEqual(input, snapshot);
    assert.deepEqual(result.steps.map(step => step.sourceId), ['root', 'body', 'body', 'body', 'root']);
    assert.equal(result.shape, 'writes'); assert.equal(result.steps.length, 5);
    assert.ok(result.steps[0].text.includes('`calculate(seed)`') && result.steps[0].text.includes('`seed`'));
    assert.ok(result.steps[1].text.includes('`balance = value * 7`'));
    assert.ok(result.steps[2].text.includes('`balance -= 6`'));
    assert.ok(result.steps[3].text.includes('`balance`'));
    assert.match(result.steps[1].text, /초기화|initializes/u);
    assert.match(result.steps[2].text, /갱신|updates/u);
    assert.match(result.steps[3].text, /반환|returns/u);
    assert.match(result.steps[4].text, /정상 복귀하면|returns normally/u);
    assert.equal(result.claims[4].condition, 'if-callee-returns-normally');
    assert.equal(new Set(result.steps.map(step => step.text)).size, 5);
    assert.ok(result.flowScalars <= 600);
    for (const index of [1, 2, 3]) {
      assert.equal(/후보 대상|Candidate callee/u.test(result.steps[index].text), inferred);
      assert.equal(result.claims[index].confidence, inferred ? 'inferred' : 'exact');
    }
    for (const claim of result.claims) for (const fact of claim.facts) {
      const source = input.snippets.find(snippet => snippet.id === fact.sourceId).text;
      assert.equal(fact.sourceId, claim.sourceId); assert.equal(source.slice(fact.from, fact.to), fact.code);
      for (const expression of fact.expressions) assert.ok(fact.code.replace(/\s+/gu, '').includes(expression.replace(/\s+/gu, '')));
    }
    const absence = result.absenceAssertions[0];
    assert.equal(absence.sourceId, 'body'); assert.equal(absence.completeNativeBody, true);
    assert.deepEqual(absence.explicitInvocations, { completeInventory: true, sites: [] });
    assert.equal(absence.from, undefined); assert.equal(absence.to, undefined);
  }
});

test('loop labels preserve the true predicate, nested mutation and conditional exit before the outside return', () => {
  for (const language of ['typescript', 'kotlin']) for (const locale of ['ko', 'en']) {
    const result = createNativeOperationFlowSupervision(context(language, 'loop'), locale);
    const change = result.operationSlots[2], returned = result.operationSlots[3];
    assert.equal(change.kind, 'while-update'); assert.equal(change.event.predicate, 'balance > 19');
    assert.deepEqual(change.event.body, [{ kind: 'update-local', binding: 'balance', operator: '-=', expression: '6' }]);
    assert.deepEqual(change.ledger.map(entry => entry.path), [[1], [1, 'body', 0]]);
    assert.deepEqual(returned.ledger.map(entry => entry.path), [[2]]);
    assert.match(result.steps[2].text, /`balance > 19`/u); assert.match(result.steps[2].text, /`balance -= 6`/u);
    assert.match(result.steps[3].text, /반복 종료 경로|if the loop exits/u);
    assert.equal(result.claims[3].condition, 'if-loop-exits');
    assert.doesNotMatch(result.steps[2].text, /balance <= 19/u);
  }
});

test('labels and operation events follow source counterfactuals, ignoring stale completion and inventories', () => {
  const input = context('kotlin', 'loop');
  input.snippets[2].text = input.snippets[2].text.replace('value * 7', 'value / 11')
    .replace('balance > 19', 'balance < -3').replace('balance -= 6', 'balance += 9');
  const reference = createNativeOperationFlowSupervision(input, 'en');
  assert.ok(reference.steps[1].text.includes('value / 11'));
  assert.ok(reference.steps[2].text.includes('balance < -3') && reference.steps[2].text.includes('balance += 9'));
  input.completion = { flow: 'Return 999, call hidden().', summary: 'Untrusted.' };
  input.nativeEvidence = { owners: [{ events: [] }] };
  Object.assign(input.callTask.targets[0], { returnSyntax: { sites: [{ expression: '999' }] }, effectSyntax: { sites: [] } });
  assert.deepEqual(createNativeOperationFlowSupervision(input, 'en'), reference);
});

test('flow specialization preserves every other schema field, prose bound and base contract byte representation', () => {
  for (const language of ['typescript', 'kotlin']) for (const locale of ['ko', 'en']) {
    const base = baseContract(), before = JSON.stringify(base), input = context(language, 'loop', true);
    const contract = createNativeOperationFlowContract(input, base, locale);
    assert.equal(JSON.stringify(base), before); assert.equal(contract.owners, base.owners);
    assert.equal(contract.schema.properties.flow.minItems, 5); assert.equal(contract.schema.properties.flow.maxItems, 5);
    const restored = structuredClone(contract.schema); restored.properties.flow = base.schema.properties.flow;
    assert.deepEqual(restored, base.schema);
    for (const [index, item] of contract.schema.properties.flow.items.entries()) {
      const slot = contract.operationSlots[index];
      assert.deepEqual(item.properties.sourceId, { type: 'string', const: slot.sourceId });
      const prose = { ...item.properties.text }; delete prose.description;
      assert.deepEqual(prose, base.schema.properties.flow.items.properties.text);
      const descriptor = JSON.parse(item.properties.text.description).nativeOperation;
      assert.equal(descriptor.syntaxOnly, true); assert.deepEqual(descriptor.event, slot.event);
      if (index > 0 && index < 4) assert.equal(descriptor.confidence, 'inferred');
    }
    assert.ok(contract.guidance.startsWith(base.guidance + '\n'));
  }
});

test('decoding forwards the exact raw once and propagates base rejection without repairing output', () => {
  const seen = [], sentinel = {};
  let reject = false;
  const base = baseContract(raw => { seen.push(raw); if (reject) throw new Error('aggregate-bound'); return sentinel; });
  const contract = createNativeOperationFlowContract(context('typescript'), base, 'ko');
  const value = { summary: '요약 🧭.', flow: contract.operationSlots.map((slot, index) => ({ sourceId: slot.sourceId, text: `문장 ${index}.` })),
    calls: [{ role: '역할.', output: '원래 출력.' }], limitations: ['원래 한계.'] };
  const raw = '\n  ' + JSON.stringify(value, null, 2) + '\n';
  assert.equal(contract.decode(raw), sentinel); assert.deepEqual(seen, [raw]);
  const wrongOwner = structuredClone(value); wrongOwner.flow[1].sourceId = 'root';
  const foreignOwner = structuredClone(value); foreignOwner.flow[2].sourceId = 'foreign';
  for (const invalid of [wrongOwner, foreignOwner, { ...value, flow: value.flow.slice(0, 4) }, { ...value, flow: [...value.flow, value.flow[0]] }]) {
    assert.throws(() => contract.decode(JSON.stringify(invalid))); assert.equal(seen.length, 1);
  }
  assert.throws(() => contract.decode('{')); assert.equal(seen.length, 1);
  reject = true;
  const overflow = structuredClone(value); overflow.flow[2].text = '가'.repeat(600) + '.';
  const overflowRaw = JSON.stringify(overflow);
  assert.throws(() => contract.decode(overflowRaw), /aggregate-bound/u);
  assert.equal(seen.at(-1), overflowRaw); assert.equal(JSON.stringify(overflow), overflowRaw);
});

test('nonlocal, partial, missing and nonmatching local bindings retain the base contract with no new labels', () => {
  for (const language of ['typescript', 'kotlin']) {
    const mismatched = context(language); mismatched.snippets[2].text = mismatched.snippets[2].text.replace('return balance', 'return value');
    for (const input of [context(language, 'arithmetic'), context(language, 'partial'), context(language, 'missing'), mismatched]) {
      const base = baseContract(), contract = createNativeOperationFlowContract(input, base, 'en');
      assert.equal(contract.schema, base.schema); assert.equal(contract.guidance, base.guidance); assert.equal(contract.decode, base.decode);
      assert.deepEqual(contract.operationSlots, []); assert.equal(createNativeOperationFlowSupervision(input, 'en'), undefined);
    }
  }
});

test('invalid owner, argument, recursion, deferred and hidden work refuse specialization rather than inventing labels', () => {
  for (const language of ['typescript', 'kotlin']) {
    for (const mutate of [
      input => { input.callTask.targets[0].calleeSnippet = 'foreign'; },
      input => { input.callTask.targets[0].arguments = ['foreign']; },
      input => { input.callTask.targets[0].deferred = true; },
      input => { input.callTask.targets[0].confidence = 'unresolved'; },
      input => { input.callTask.targets.push(structuredClone(input.callTask.targets[0])); },
      input => { input.snippets[2].text = input.snippets[2].text.replace('return balance', 'throw 9; return balance'); },
      input => { input.snippets[0].text = input.snippets[0].text.replace('calculate(seed)', 'relay(seed)');
        Object.assign(input.callTask.targets[0], { callee: 'relay', expression: 'relay(seed)' }); },
    ]) {
      const input = context(language); mutate(input);
      assert.throws(() => createNativeOperationFlowPlan(input));
      assert.throws(() => createNativeOperationFlowSupervision(input, 'en'));
    }
  }
});

test('an additional native invocation retains evidence but never receives a no-inner-calls label', () => {
  for (const language of ['typescript', 'kotlin']) {
    const input = context(language);
    input.snippets[2].text = input.snippets[2].text.replace('return balance', 'inspect(balance); return balance');
    const plan = createNativeOperationFlowPlan(input);
    assert.deepEqual(plan.operationSlots, []);
    assert.equal(plan.nativeEvidence.owners[1].explicitInvocations.sites[0].callee, 'inspect');
    assert.equal(createNativeOperationFlowSupervision(input, 'en'), undefined);
  }
});

test('oversized source-derived flow is refused, preserving the entire original source and expressions', () => {
  const input = context('typescript'), name = 'calculate' + 'Long'.repeat(60);
  for (const snippet of input.snippets) snippet.text = snippet.text.replaceAll('calculate', name);
  Object.assign(input.callTask.targets[0], { callee: name, expression: `${name}(seed)` });
  const snapshot = structuredClone(input);
  assert.throws(() => createNativeOperationFlowSupervision(input, 'en'), /Full native operation flow bound/u);
  assert.deepEqual(input, snapshot);
  assert.equal(createNativeOperationFlowPlan(input).operationSlots[1].callable, name);
  assert.throws(() => createNativeOperationFlowSupervision(context('typescript'), 'ja'));
});
