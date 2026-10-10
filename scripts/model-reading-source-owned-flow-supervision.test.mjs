/** Native-source counterexamples for offline source-owned labels, independent of any model reply. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { coverageKinds, coverageSpec } from './model-reading-coverage-fixtures.mjs';
import { compoundCases, compoundSpec } from './model-reading-compound-fixtures.mjs';
import { createSourceOwnedFlowSupervision } from './model-reading-source-ownership-supervision.mjs';
import { disposeModelReadingSourceOwnershipEvidence, readModelReadingDeclaration } from './model-reading-source-ownership-evidence.mjs';
test.after(disposeModelReadingSourceOwnershipEvidence);

/** Construct source-only tasks; no existing completion, label sentence or heldout answer enters supervision. */
function contextFor(spec, confidence = spec.helper ? 'exact' : 'unresolved') {
  const expression = `${spec.callee}(${spec.arg})`, partial = spec.kind === 'partial';
  return { functionName: spec.parent, language: spec.language, limited: spec.kind === 'missing' || partial,
    snippets: [{ id: 'parent', role: 'function', text: spec.caller, truncated: false },
      { id: 'caller', role: 'caller', text: expression, truncated: false },
      ...(spec.helper ? [{ id: 'callee', role: 'helper', text: spec.helper, truncated: partial }] : [])],
    callTask: { includeSummary: true, sequence: [{ callId: 'call-1' }], targets: [{ callId: 'call-1', caller: spec.parent,
      callee: spec.callee, relation: 'call', confidence, deferred: false, guards: [], loops: [], expression, arguments: [spec.arg],
      sourceLimited: spec.kind === 'missing' || partial,
      ...(spec.helper ? { calleeSnippet: 'callee', parameters: [{ name: spec.parameter }] } : {}) }] } };
}

test('all independent source shapes, locales and confidences retain separate actors and source facts', () => {
  let checked = 0;
  for (const kind of coverageKinds) for (const language of ['typescript', 'kotlin']) for (let variant = 0; variant < 5; variant++) {
    const spec = coverageSpec(kind, language, variant);
    for (const confidence of spec.helper ? ['exact', 'inferred'] : ['unresolved']) for (const locale of ['ko', 'en']) {
      const context = contextFor(spec, confidence), before = structuredClone(context);
      const result = createSourceOwnedFlowSupervision(context, locale);
      assert.deepEqual(context, before);
      assert.equal(result.steps[0].sourceId, 'parent'); assert.equal(result.steps.at(-1).sourceId, 'parent');
      assert.equal(result.claims[0].facts[0].expression, `${spec.callee}(${spec.arg})`);
      assert.equal(result.claims.at(-1).facts[0].kind, 'normal-return-use');
      assert.match(result.steps.at(-1).text, /정상|normally/u);
      const flow = result.steps.map(step => step.text).join(' ');
      assert.ok(Array.from(flow).length <= 600);
      assert.equal(result.steps.length, new Set(result.steps.map(step => step.text)).size);
      if (kind === 'missing') {
        assert.deepEqual(result.steps.map(step => step.sourceId), ['parent', null, 'parent']);
        assert.match(result.steps[1].text, /미확인|unknown/u); assert.equal(result.declarations.callee, undefined);
      } else {
        const evidence = result.declarations.callee;
        assert.equal(evidence.sourceText, spec.helper); assert.equal(evidence.truncated, kind === 'partial');
        assert.equal(evidence.validationOnlySuffix, kind === 'partial' ? ' }' : '');
        for (const claim of result.claims.filter(claim => claim.actor === spec.callee)) {
          assert.ok(claim.facts.every(fact => fact.sourceId === 'callee' && fact.to <= spec.helper.length));
        }
        if (kind === 'combined' || kind === 'catch-cleanup') {
          assert.deepEqual(result.steps.map(step => step.sourceId), ['parent', 'callee', 'callee', null, 'parent']);
          assert.ok(flow.includes(spec.cleanup) && flow.includes(spec.alternative));
          assert.match(result.steps[3].text, /미확인|unknown/u);
          assert.match(result.steps.at(-1).text, /finally/u);
        }
        if (kind === 'partial') {
          assert.deepEqual(result.steps.map(step => step.sourceId), ['parent', 'callee', null, 'parent']);
          assert.ok(flow.includes(spec.predicate) && flow.includes(spec.early));
          assert.doesNotMatch(flow, /otherwise|아니면/u);
        }
        assert.equal(/후보|Candidate/u.test(result.steps[1].text), confidence === 'inferred');
      }
      checked++;
    }
  }
  assert.equal(checked, 300);
});

test('all pairwise compound training/validation recipes are read from native source before labelling', () => {
  let checked = 0;
  for (const split of ['training', 'valid']) for (const kind of ['combined', 'partial', 'missing']) {
    for (const descriptor of compoundCases(split, kind)) for (const language of ['typescript', 'kotlin']) for (const locale of ['ko', 'en']) {
      const spec = compoundSpec(kind, language, descriptor), result = createSourceOwnedFlowSupervision(contextFor(spec), locale);
      if (kind === 'combined') for (const value of [spec.predicate, spec.early, spec.calculation, spec.alternative, spec.cleanup]) {
        assert.ok(result.steps.some(step => step.text.includes(value)), value);
      }
      checked++;
    }
  }
  // 2/1 name families * (2*16 combined + 16 partial + 1 missing)
  // recipes * 2 source languages * 2 explanation locales.
  assert.equal(checked, 588);
});

test('try/finally without catch preserves an opaque inner call and conditional caller result use', () => {
  for (const language of ['typescript', 'kotlin']) {
    const spec = coverageSpec('catch-cleanup', language, 0);
    spec.helper = spec.helper.replace(/catch \([^)]*\) \{ return -19;? \} /u, '');
    const result = createSourceOwnedFlowSupervision(contextFor(spec), 'en');
    assert.equal(result.shape, 'try-finally'); assert.doesNotMatch(result.steps[1].text, /catch/u);
    assert.ok(result.steps[2].text.includes(spec.cleanup)); assert.equal(result.steps[3].sourceId, null);
  }
});

test('an old completion and stale inventories cannot change native source-derived ownership', () => {
  const context = contextFor(coverageSpec('negative-guard', 'kotlin', 0));
  const before = createSourceOwnedFlowSupervision(context, 'ko');
  context.completion = { flow: 'Invent an unrelated callee operation.' };
  Object.assign(context.callTask.targets[0], { returnSyntax: { sites: [{ expression: '999' }] }, effectSyntax: { sites: [] } });
  assert.deepEqual(createSourceOwnedFlowSupervision(context, 'ko'), before);
});

test('source counterfactuals move the guarded and later returns independently without evaluating numbers', () => {
  const spec = coverageSpec('negative-guard', 'typescript', 0);
  spec.helper = spec.helper.replace('return 31;', 'return rawNum / 7;').replace('return rawNum * 6;', 'return -811;');
  const result = createSourceOwnedFlowSupervision(contextFor(spec), 'en');
  assert.match(result.steps[1].text, /`rawNum \/ 7` if `rawNum <= -5`, otherwise `-811`/u);
  assert.doesNotMatch(result.steps[0].text + result.steps.at(-1).text, /811|rawNum/u);
});

test('unowned, deferred, mismatched and multi-target tasks refuse labels instead of guessing actors', () => {
  const base = contextFor(coverageSpec('arithmetic', 'typescript', 0));
  const mutations = [
    context => context.callTask.targets.push(structuredClone(context.callTask.targets[0])),
    context => context.callTask.targets[0].calleeSnippet = 'caller',
    context => context.callTask.targets[0].deferred = true,
    context => context.callTask.targets[0].confidence = 'unresolved',
    context => context.callTask.targets[0].arguments = ['another'],
    context => context.callTask.targets[0].sourceLimited = true,
    context => context.snippets[0].text = context.snippets[0].text.replace('return shapeNum(sentNum);', 'shapeNum(sentNum); return sentNum;'),
  ];
  for (const mutate of mutations) { const context = structuredClone(base); mutate(context); assert.throws(() => createSourceOwnedFlowSupervision(context, 'en')); }
  assert.throws(() => createSourceOwnedFlowSupervision(base, 'ja'));
});

test('hidden work, recovery, nested scopes, getters and unsupported control statements are refused in both native parsers', () => {
  for (const language of ['typescript', 'kotlin']) {
    const spec = coverageSpec('negative-guard', language, 0);
    const forbidden = language === 'typescript' ? ['throw 0;', 'function nested() { return 8; }', 'probeNum(rawNum);', 'rawNum++;']
      : ['throw Exception()', 'fun nested(): Int { return 8 };', 'probeNum(rawNum);', 'rawNum++;'];
    for (const insertion of forbidden) {
      const context = contextFor(spec); context.snippets[2].text = spec.helper.replace('return rawNum * 6', insertion + ' return rawNum * 6');
      assert.throws(() => createSourceOwnedFlowSupervision(context, 'en'), insertion);
    }
    for (const replacement of ['rawNum.other', 'probeNum(rawNum)', 'rawNum = 2']) {
      const context = contextFor(spec); context.snippets[2].text = spec.helper.replace('rawNum * 6', replacement);
      assert.throws(() => createSourceOwnedFlowSupervision(context, 'en'), replacement);
    }
    assert.throws(() => readModelReadingDeclaration({ id: 'bad', text: spec.helper.slice(0, -2), truncated: false }, language));
  }
});

test('partial validation refuses closing, appending or hiding anything beyond the visible branch', () => {
  for (const language of ['typescript', 'kotlin']) {
    const spec = coverageSpec('partial', language, 0);
    for (const addition of [' }', ' return 42;', ' // hidden', '\nwhile (rawNum > 0) { rawNum -= 1; }']) {
      assert.throws(() => readModelReadingDeclaration({ id: 'partial', text: spec.helper + addition, truncated: true }, language));
    }
  }
});

test('a native single-statement Kotlin branch retains the same incomplete-source boundary', () => {
  const spec = coverageSpec('partial', 'kotlin', 0);
  spec.helper = spec.helper.replace('{ return 31 }', 'return 31');
  const result = createSourceOwnedFlowSupervision(contextFor(spec), 'en');
  assert.equal(result.shape, 'partial'); assert.equal(result.declarations.callee.nativeParseComplete, false);
  assert.equal(result.declarations.callee.sourceText, spec.helper);
  assert.match(result.steps[1].text, /`31` if `rawNum <= -5`/u);
  assert.equal(result.steps[2].sourceId, null); assert.match(result.steps[2].text, /unknown/u);
});

test('an available recursive/caller body is not described as an absent inner implementation', () => {
  for (const language of ['typescript', 'kotlin']) {
    const spec = coverageSpec('combined', language, 0);
    for (const callable of [spec.parent, spec.callee]) {
      const context = contextFor(spec);
      context.snippets[2].text = spec.helper.replace(spec.cleanup, `${callable}(${spec.parameter})`);
      assert.throws(() => createSourceOwnedFlowSupervision(context, 'en'), /available recursive/u);
    }
  }
});
