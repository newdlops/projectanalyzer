/** Counterexamples prevent invalid complete Kotlin from silently becoming extra model-authored fields. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCompleteModelFixtureSyntax } from './model-reading-fixture-validation.mjs';
const callee = { kind: 'function', language: 'kotlin', name: 'convert' };
const syntax = { returns: { syntaxOnly: true, limited: false, sites: [{ expression: 'raw + 2' }] },
  effects: { syntaxOnly: true, limited: false, sites: [] } };

test('a recovered Kotlin symbol is rejected even when its name exists and other supplied fields look complete', () => {
  for (const metadata of [{ partial: true }, { kotlinDiagnosticCount: 1 }]) {
    assert.throws(() => assertCompleteModelFixtureSyntax({ ...callee, metadata }, syntax, 'Kotlin loop'), /Kotlin loop: recovered-declaration/u);
  }
  assert.throws(() => assertCompleteModelFixtureSyntax(undefined, syntax), /missing-declaration/u);
  assert.throws(() => assertCompleteModelFixtureSyntax({ ...callee, kind: 'class' }, syntax), /missing-declaration/u);
});

test('missing or malformed return/effect evidence cannot masquerade as a complete source fixture', () => {
  for (const candidate of [undefined, {}, { returns: syntax.returns }]) {
    assert.throws(() => assertCompleteModelFixtureSyntax(callee, candidate), /missing-source-inventory/u);
  }
  for (const field of ['returns', 'effects']) for (const value of [{ limited: undefined }, { syntaxOnly: false }, { sites: undefined }]) {
    const candidate = structuredClone(syntax); Object.assign(candidate[field], value);
    assert.throws(() => assertCompleteModelFixtureSyntax(callee, candidate), /missing-source-inventory/u);
  }
});

test('conservative evidence limits remain valid metadata unless a benchmark explicitly requires complete inventories', () => {
  for (const field of ['returns', 'effects']) {
    const candidate = structuredClone(syntax); candidate[field].limited = true;
    const before = structuredClone(candidate);
    assert.equal(assertCompleteModelFixtureSyntax(callee, candidate), undefined);
    assert.throws(() => assertCompleteModelFixtureSyntax(callee, candidate, 'exact fixture', { requireCompleteInventories: true }), /limited-source-inventory/u);
    assert.deepEqual(candidate, before);
  }
});

test('complete lexical inventories, including empty syntax, are accepted without mutation or outcome claims', () => {
  const before = structuredClone(syntax);
  assert.equal(assertCompleteModelFixtureSyntax(callee, syntax), undefined);
  assert.equal(assertCompleteModelFixtureSyntax({ ...callee, kind: 'method', language: 'typescript' }, syntax), undefined);
  const empty = { returns: { syntaxOnly: true, limited: false, sites: [] }, effects: { syntaxOnly: true, limited: false, sites: [] } };
  assert.equal(assertCompleteModelFixtureSyntax(callee, empty), undefined);
  assert.deepEqual(syntax, before);
});
