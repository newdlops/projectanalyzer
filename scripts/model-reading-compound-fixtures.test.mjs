/** Source ownership, factor diversity and full supervision contracts for offline compound fixtures. */
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { compoundCases, compoundSpec } from './model-reading-compound-fixtures.mjs';
import { coverageReading } from './model-reading-coverage-fixtures.mjs';
import { createTruncatedReturnBranchSupervision } from './model-reading-supervision.mjs';

/** Match the actual source-availability contract rather than the root task's unrelated limited flag. */
function target(spec, confidence = spec.kind === 'missing' ? 'unresolved' : 'exact') {
  return { expression: `${spec.callee}(${spec.arg})`, confidence, sourceLimited: spec.kind !== 'combined',
    ...(spec.helper ? { calleeSnippet: 'callee' } : {}) };
}

test('each semantic factor pair covers all sixteen combinations independently of names and coefficients', () => {
  for (const split of ['training', 'valid']) {
    const descriptors = compoundCases(split);
    assert.equal(descriptors.length, split === 'training' ? 64 : 32);
    const groups = Map.groupBy(descriptors, item => `${item.nameFamily}/${item.operandLevel}`);
    for (const group of groups.values()) {
      assert.equal(group.length, 16);
      const rows = group.map(item => compoundSpec('combined', 'typescript', item).levels);
      const factors = Object.keys(rows[0]);
      assert.equal(factors.length, 5);
      for (let a = 0; a < factors.length; a++) for (let b = a + 1; b < factors.length; b++) {
        const pairs = new Set(rows.map(row => `${row[factors[a]]}/${row[factors[b]]}`));
        assert.equal(pairs.size, 16, `${split}/${factors[a]}/${factors[b]}`);
      }
    }
  }
});

test('names and operand levels cross the same source recipes without selecting a semantic layout', () => {
  const descriptors = compoundCases('training');
  for (let row = 0; row < 16; row++) {
    const specs = descriptors.filter(item => item.matrixRow === row).map(item => compoundSpec('combined', 'typescript', item));
    assert.equal(specs.length, 4);
    assert.equal(new Set(specs.map(spec => spec.callee)).size, 2);
    assert.equal(new Set(specs.map(spec => spec.calculation.split(' ').at(-1))).size, 2);
    assert.equal(new Set(specs.map(spec => JSON.stringify(spec.levels))).size, 1);
  }
});

test('canonical full, partial and missing groups have unique sources and disjoint train/validation declarations', () => {
  const sources = { training: new Set(), valid: new Set() };
  for (const split of ['training', 'valid']) for (const kind of ['combined', 'partial', 'missing']) {
    const descriptors = compoundCases(split, kind);
    assert.equal(descriptors.length, (split === 'training' ? 2 : 1) * (kind === 'combined' ? 32 : kind === 'partial' ? 16 : 1));
    for (const language of ['typescript', 'kotlin']) for (const item of descriptors) {
      const spec = compoundSpec(kind, language, item), key = JSON.stringify([language, spec.caller, spec.helper]);
      assert.ok(!sources[split].has(key)); sources[split].add(key);
    }
  }
  for (const source of sources.valid) assert.ok(!sources.training.has(source));
  const descriptor = compoundCases('training')[0];
  for (const patch of [{ split: 'test' }, { nameFamily: 2 }, { matrixRow: 16 }, { operandLevel: -1 }]) {
    assert.throws(() => compoundSpec('combined', 'typescript', { ...descriptor, ...patch }), TypeError);
  }
  assert.throws(() => compoundSpec('partial', 'kotlin', { ...descriptor, operandLevel: 1 }), TypeError);
  assert.throws(() => compoundSpec('missing', 'kotlin', { ...descriptor, matrixRow: 1 }), TypeError);
  assert.throws(() => compoundCases('valid', 'unknown'), TypeError);
  assert.throws(() => compoundSpec('combined', 'python', descriptor), TypeError);
});

test('every complete TypeScript body owns the guard return and fallback in try, a separate catch and finally call', () => {
  for (const split of ['training', 'valid']) for (const item of compoundCases(split)) {
    const spec = compoundSpec('combined', 'typescript', item);
    const file = ts.createSourceFile('fixture.ts', spec.helper, ts.ScriptTarget.Latest, true);
    assert.equal(file.parseDiagnostics.length, 0);
    const declaration = file.statements[0], statement = declaration.body.statements[0];
    assert.ok(ts.isFunctionDeclaration(declaration) && ts.isTryStatement(statement));
    assert.equal(declaration.parameters[0].name.getText(file), spec.parameter);
    assert.equal(declaration.body.statements.length, 1);
    assert.equal(statement.tryBlock.statements.length, 2);
    const [branch, fallback] = statement.tryBlock.statements;
    assert.ok(ts.isIfStatement(branch) && !branch.elseStatement && ts.isReturnStatement(fallback));
    assert.equal(branch.expression.getText(file), spec.predicate);
    assert.equal(branch.thenStatement.statements[0].expression.getText(file), spec.early);
    assert.equal(fallback.expression.getText(file), spec.calculation);
    assert.equal(statement.catchClause.block.statements[0].expression.getText(file), spec.alternative);
    assert.equal(statement.finallyBlock.statements[0].expression.getText(file), spec.cleanup);
    assert.equal(statement.catchClause.block.statements.length, 1);
    assert.equal(statement.finallyBlock.statements.length, 1);
  }
});

test('same-name partial sources satisfy the bounded truncation guard and never acquire a known unseen result', () => {
  for (const split of ['training', 'valid']) for (const item of compoundCases(split, 'partial')) {
    for (const language of ['typescript', 'kotlin']) for (const locale of ['ko', 'en']) {
      const spec = compoundSpec('partial', language, item), complete = compoundSpec('combined', language, item);
      assert.equal(spec.callee, complete.callee);
      assert.ok(!spec.helper.includes('try') && !spec.helper.endsWith('} }'));
      const owned = target(spec), snippet = { id: 'callee', role: 'helper', text: spec.helper, truncated: true };
      assert.ok(createTruncatedReturnBranchSupervision(owned, locale, snippet));
      assert.equal(createTruncatedReturnBranchSupervision({ ...owned, sourceLimited: false }, locale, snippet), undefined);
      const reading = coverageReading(spec, locale, owned);
      for (const field of ['role', 'output', 'effects', 'flow']) assert.match(reading[field], /미확인|unknown/iu);
      assert.doesNotMatch(reading.role, /otherwise|아니면|또는/u);
    }
  }
});

test('every full label preserves owned expressions, all six bounds and exact/inferred uncertainty without clipping', () => {
  for (const split of ['training', 'valid']) for (const kind of ['combined', 'partial', 'missing']) {
    for (const item of compoundCases(split, kind)) for (const language of ['typescript', 'kotlin']) for (const locale of ['ko', 'en']) {
      const spec = compoundSpec(kind, language, item), source = `${spec.caller}\n${spec.helper ?? ''}`.replace(/\s+/gu, '');
      for (const confidence of kind === 'missing' ? ['unresolved'] : ['exact', 'inferred']) {
        const reading = coverageReading(spec, locale, target(spec, confidence));
        assert.equal(/후보|candidate/iu.test(reading.role), confidence === 'inferred');
        for (const [field, bound] of Object.entries({ summary: 240, flow: 600, role: 160, inputs: 180, output: 180, effects: 180 })) {
          assert.ok(reading[field].length > 0 && reading[field].length <= bound, `${split}/${kind}/${locale}/${field}`);
          if (locale === 'ko') assert.match(reading[field], /^[가-힣]/u);
          assert.equal((reading[field].match(/`/gu) ?? []).length % 2, 0);
          for (const match of reading[field].matchAll(/`([^`]+)`/gu)) assert.ok(source.includes(match[1].replace(/\s+/gu, '')), match[1]);
        }
        if (kind === 'combined') {
          for (const field of ['role', 'flow', 'output']) for (const fact of [spec.predicate, spec.early, spec.calculation, spec.alternative]) {
            assert.ok(reading[field].includes(fact), `${field}/${fact}`);
          }
          assert.ok(reading.flow.includes(spec.cleanup) && reading.effects.includes(spec.cleanup));
          assert.doesNotMatch(reading.role, /truncated|잘린/iu);
          assert.match(reading.effects, /미확인|unknown/iu);
        }
      }
    }
  }
});
