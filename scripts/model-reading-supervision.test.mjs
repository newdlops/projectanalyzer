/** Regression cases for public synthetic labels that previously taught both branches to return the same literal. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTwoReturnBranchSupervision } from './model-reading-supervision.mjs';

const target = { confidence: 'exact', returnSyntax: { limited: false, syntaxOnly: true, sites: [
  { expression: '-9', regions: [{ kind: 'then', expression: 'raw < 2' }] },
  { expression: 'raw + 2', regions: [] }
] } };
const source = 'function convert(raw: number): number { if (raw < 2) {return -9; }; return raw + 2; }';

test('a negative return literal cannot replace the distinct later calculation in either language', () => {
  assert.equal(createTwoReturnBranchSupervision(target, 'ko', source),
    '조건 `raw < 2`에 따라 `-9` 또는 `raw + 2`를 반환합니다.');
  assert.equal(createTwoReturnBranchSupervision(target, 'en', source),
    'Return `-9` when `raw < 2`, otherwise `raw + 2`.');
  assert.equal(createTwoReturnBranchSupervision(target, 'ko', 'fun convert(raw: Int): Int { if (raw < 2) { return -9 }; return raw + 2 }'),
    '조건 `raw < 2`에 따라 `-9` 또는 `raw + 2`를 반환합니다.');
  assert.equal(createTwoReturnBranchSupervision(target, 'en', 'fun convert(raw: Int): Int { if (raw < 2) return -9; return raw + 2 }'),
    'Return `-9` when `raw < 2`, otherwise `raw + 2`.');
  assert.equal(createTwoReturnBranchSupervision(target, 'en', 'fun convert(raw: Int): Int { if (raw < 2) return -9\nreturn raw + 2 }'),
    'Return `-9` when `raw < 2`, otherwise `raw + 2`.');
});

test('source site ownership, arithmetic ordering and candidate confidence are preserved without mutation', () => {
  const input = structuredClone(target);
  input.confidence = 'inferred';
  input.returnSyntax.sites[0].expression = 'raw * 2';
  input.returnSyntax.sites[1].expression = '-9';
  const before = structuredClone(input), result = createTwoReturnBranchSupervision(input, 'en',
    'fun convert(raw: Int): Int { if (raw < 2) { return raw * 2 }; return -9 }');
  assert.equal(result, 'In the candidate body, Return `raw * 2` when `raw < 2`, otherwise `-9`.');
  assert.deepEqual(input, before);
  assert.ok(!/always|completion|실제|완료/u.test(result));
});

test('partial, nested, catch, ambiguous and malformed evidence cannot become a simple branch label', () => {
  const variants = [
    undefined,
    { ...target, returnSyntax: { ...target.returnSyntax, limited: true } },
    { ...target, returnSyntax: { ...target.returnSyntax, syntaxOnly: false } },
    { ...target, returnSyntax: { ...target.returnSyntax, sites: target.returnSyntax.sites.slice(0, 1) } },
    { ...target, returnSyntax: { ...target.returnSyntax, sites: [target.returnSyntax.sites[0], ...target.returnSyntax.sites] } }
  ];
  for (const kind of ['catch', 'loop']) {
    const input = structuredClone(target); input.returnSyntax.sites[0].regions[0].kind = kind; variants.push(input);
  }
  const nested = structuredClone(target); nested.returnSyntax.sites[0].regions.push({ kind: 'try' }); variants.push(nested);
  const qualified = structuredClone(target); qualified.returnSyntax.sites[1].regions.push({ kind: 'else' }); variants.push(qualified);
  const malformed = structuredClone(target); malformed.returnSyntax.sites[1].expression = '`unfinished'; variants.push(malformed);
  for (const input of variants) assert.equal(createTwoReturnBranchSupervision(input, 'en', source), undefined);
});

test('the full source must prove that no throw, loop, write or missing text separates the two return choices', () => {
  assert.equal(createTwoReturnBranchSupervision(target, 'en'), undefined);
  for (const statement of ['throw 0;', 'raw++;', 'while (raw > 0) { raw--; }']) {
    assert.equal(createTwoReturnBranchSupervision(target, 'en', source.replace('return raw + 2;', statement + ' return raw + 2;')), undefined);
  }
  assert.equal(createTwoReturnBranchSupervision({ ...target, sourceLimited: true }, 'en', source), undefined);
});

test('long expressions are refused intact and unsupported locales fail explicitly', () => {
  const input = structuredClone(target); input.returnSyntax.sites[1].expression = 'x'.repeat(200);
  assert.equal(createTwoReturnBranchSupervision(input, 'en', source.replace('raw + 2', 'x'.repeat(200))), undefined);
  assert.throws(() => createTwoReturnBranchSupervision(target, 'ja'), TypeError);
});
