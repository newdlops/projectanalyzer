/** Independent parser and full-field counterexamples for synthetic control-flow supervision; no inference/runtime substitution. */
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { coverageKinds, coverageSpec, coverageReading } from './model-reading-coverage-fixtures.mjs';

/** The fixture owns its callee source; caller metadata cannot supply another body's explanation. */
function target(spec, confidence=spec.kind==='missing'?'unresolved':'exact') {
  return { expression:`${spec.callee}(${spec.arg})`,confidence,sourceLimited:['missing','partial'].includes(spec.kind) };
}

test('unowned targets, unsupported inputs and source-completeness contradictions cannot become coverage labels', () => {
  for(const args of [['unknown','typescript',0],['combined','python',0],['combined','kotlin',5]])assert.throws(()=>coverageSpec(...args),TypeError);
  const spec=coverageSpec('combined','typescript',0),owned=target(spec);
  for(const patch of [{expression:'shapeNum(other)'},{sourceLimited:true},{confidence:'unresolved'}])assert.throws(()=>coverageReading(spec,'en',{...owned,...patch}),TypeError);
  assert.throws(()=>coverageReading(spec,'fr',owned),TypeError);
  const missing=coverageSpec('missing','kotlin',0);
  assert.throws(()=>coverageReading(missing,'ko',{...target(missing),confidence:'exact'}),TypeError);
});

test('the TypeScript AST assigns three distinct returns to the true branch, later try return and catch', () => {
  const spec=coverageSpec('combined','typescript',0),file=ts.createSourceFile('fixture.ts',spec.helper,ts.ScriptTarget.Latest,true);
  assert.equal(file.parseDiagnostics.length,0);
  const pending=[file],visited=new Set(),returns=[];
  while(pending.length) {
    const node=pending.pop();if(visited.has(node))continue;visited.add(node);
    assert.ok(visited.size<=128);
    if(ts.isReturnStatement(node)) {
      let child=node,parent=node.parent,condition,zone;
      const owners=new Set();
      while(parent) {
        assert.ok(!owners.has(parent)&&owners.size<32);owners.add(parent);
        if(ts.isIfStatement(parent))condition=parent.expression.getText(file);
        if(ts.isTryStatement(parent))zone=child===parent.tryBlock?'try':child===parent.catchClause?'catch':'finally';
        child=parent;parent=parent.parent;
      }
      returns.push({expression:node.expression.getText(file),...(condition?{condition}:{}),zone});
    }
    ts.forEachChild(node,child=>{pending.push(child);});
  }
  assert.deepEqual(returns.sort((a,b)=>a.expression.localeCompare(b.expression)),[
    {expression:'-19',zone:'catch'}, {expression:'31',condition:'rawNum <= -5',zone:'try'}, {expression:'rawNum * 6',zone:'try'}
  ].sort((a,b)=>a.expression.localeCompare(b.expression)));
  const kotlin=coverageSpec('combined','kotlin',0);
  assert.ok(kotlin.helper.includes('return 31 }\nreturn rawNum * 6 } catch'));
  assert.ok(!kotlin.helper.includes('} return'));
});

test('combined full prose preserves the catch alternative independently of the normal fallback', () => {
  const spec=coverageSpec('combined','typescript',0),reading=coverageReading(spec,'en',target(spec));
  assert.equal(reading.role,'In try, select `31` if `rawNum <= -5`, else `rawNum * 6`; catch selects `-19`.');
  for(const field of ['role','output','flow']) {
    for(const fact of ['31','rawNum <= -5','rawNum * 6','-19'])assert.ok(reading[field].includes(fact),field+' '+fact);
    assert.match(reading[field],/catch[^.]{0,40}`-19`/u);
  }
  assert.match(reading.flow,/Before return completion, finally calls `probeNum\(rawNum\)`/u);
  assert.match(reading.effects,/effects and completion are unknown/u);
});

test('candidate qualification occurs once and exact targets retain their source argument-to-parameter mapping', () => {
  for(const locale of ['ko','en']) {
    const spec=coverageSpec('writes','kotlin',1),exact=coverageReading(spec,locale,target(spec));
    const candidate=coverageReading(spec,locale,target(spec,'inferred'));
    assert.doesNotMatch(exact.role,/후보|candidate/iu);
    assert.equal((candidate.role.match(/후보|candidate/giu)??[]).length,1);
    assert.ok(exact.inputs.includes('inletN')&&exact.inputs.includes('sourceN'));
    assert.doesNotMatch(exact.inputs,/미확인|unknown/iu);
    assert.ok(exact.role.includes('working -= 7'));
    assert.doesNotMatch(exact.flow,/finally|반복|\bwhile\b/u);
  }
});

test('missing and truncated sources keep unknown results and effects in every full authored field', () => {
  for(const language of ['typescript','kotlin'])for(const locale of ['ko','en'])for(const kind of ['missing','partial']) {
    const spec=coverageSpec(kind,language,4),reading=coverageReading(spec,locale,target(spec));
    for(const field of ['role','output','effects','flow'])assert.match(reading[field],/미확인|unknown/iu);
    assert.doesNotMatch(reading.role,/otherwise|아니면|또는/u);
    assert.doesNotMatch(reading.flow,/`other`|otherwise `numberN`/u);
    if(kind==='missing')assert.equal(spec.helper,undefined);
    else {
      assert.ok(reading.output.includes('numberN <= -31')&&reading.output.includes('47'));
      assert.match(reading.effects,/보인 부분|visible part/u);
    }
  }
});

test('all trusted recipes fit the existing full-field language, source citation and length contract without clipping', () => {
  for(const language of ['typescript','kotlin'])for(let variant=0;variant<5;variant++)for(const kind of coverageKinds)for(const locale of ['ko','en']) {
    const spec=coverageSpec(kind,language,variant);
    for(const confidence of kind==='missing'?['unresolved']:['exact','inferred']) {
      const reading=coverageReading(spec,locale,target(spec,confidence)),source=(spec.caller+'\n'+(spec.helper??'')).replace(/\s+/gu,'');
      for(const [field,limit] of Object.entries({summary:240,flow:600,role:160,inputs:180,output:180,effects:180})) {
        assert.ok(reading[field].length>0&&reading[field].length<=limit,[language,variant,kind,locale,confidence,field].join('/'));
        if(locale==='ko')assert.match(reading[field],/^[가-힣]/u);
        assert.equal((reading[field].match(/`/gu)??[]).length%2,0);
        for(const quoted of reading[field].matchAll(/`([^`]+)`/gu))assert.ok(source.includes(quoted[1].replace(/\s+/gu,'')),quoted[1]);
      }
    }
  }
});
