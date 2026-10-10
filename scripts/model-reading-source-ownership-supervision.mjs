/** Source-derived prose supervision for the private flow transport experiment.
 * Templates label independently parsed synthetic source, never runtime answers.
 * Unsupported topology is refused; no previous flow or heldout reply is read.
 */
import assert from 'node:assert/strict';
import { readModelReadingDeclaration } from './model-reading-source-ownership-evidence.mjs';
const q = value => '`' + value + '`';

/** Read available actors from their own full source snapshots, then label the existing bounded corpus. */
export function createSourceOwnedFlowSupervision(context, locale) {
  assert.ok(['ko', 'en'].includes(locale));
  const task = context.callTask;
  assert.ok(task?.includeSummary && task.targets.length === 1 && task.sequence.length === 1);
  const target = task.targets[0];
  assert.equal(target.relation, 'call'); assert.equal(target.deferred, false);
  assert.deepEqual(target.guards, []); assert.deepEqual(target.loops, []);
  assert.equal(task.sequence[0].callId, target.callId);
  const parents = context.snippets.filter(snippet => snippet.role === 'function'); assert.equal(parents.length, 1);
  assert.equal(parents[0].truncated, false);
  const parent = readModelReadingDeclaration(parents[0], context.language);
  assert.equal(parent.name, context.functionName); assert.equal(parent.name, target.caller);
  assert.equal(parent.statements.length, 1);
  const use = parent.statements[0];
  assert.equal(use.kind, 'return'); assert.ok(use.invocation);
  assert.equal(use.expression, target.expression);
  assert.equal(use.invocation.callee, target.callee);
  assert.deepEqual(target.arguments, [use.invocation.argument]);
  const helpers = context.snippets.filter(snippet => snippet.role === 'helper'); assert.ok(helpers.length <= 1);
  let callee;
  if (helpers.length) {
    assert.equal(helpers[0].id, target.calleeSnippet);
    callee = readModelReadingDeclaration(helpers[0], context.language);
    assert.equal(callee.name, target.callee);
    assert.deepEqual(target.parameters?.map(parameter => parameter.name), callee.parameters);
    assert.ok(['exact', 'inferred'].includes(target.confidence));
    assert.equal(target.sourceLimited, callee.truncated);
  } else {
    assert.equal(target.calleeSnippet, undefined); assert.equal(target.confidence, 'unresolved'); assert.equal(target.sourceLimited, true);
  }
  const ko = locale === 'ko', steps = [], claims = [];
  const actor = ko ? `${target.confidence === 'inferred' ? '후보 대상' : '대상'} ${q(target.callee)}`
    : `${target.confidence === 'inferred' ? 'Candidate callee' : 'Callee'} ${q(target.callee)}`;
  /** A claim retains its own actor, original span and exact text independently of the human sentence. */
  const add = (owner, text, facts) => {
    assert.ok(text.trim() && /[.!?]$/u.test(text));
    assert.ok(!steps.some(step => step.text === text));
    const step = { sourceId: owner?.sourceId ?? null, text }; steps.push(step);
    const ledger = facts.map(fact => ({ ...fact, sourceId: step.sourceId }));
    claims.push({ index: steps.length - 1, actor: owner?.name ?? 'unknown', facts: ledger });
  };
  add(parent, ko ? `부모 ${q(parent.name)}는 ${q(target.expression)}로 인수 ${q(use.invocation.argument)}를 전달합니다.`
    : `Parent ${q(parent.name)} passes ${q(use.invocation.argument)} through ${q(target.expression)}.`,
  [{ kind: 'argument-passing', expression: target.expression, argument: use.invocation.argument, from: use.from, to: use.to }]);
  let shape;
  if (!callee) {
    shape = 'missing';
    add(undefined, ko ? `${actor}의 본문이 없어 반환값·내부 변경·호출·효과·완료는 미확인입니다.`
      : `${actor} has no supplied body; its result, inner writes, calls, effects and completion are unknown.`,
    [{ kind: 'unavailable-body', callable: target.callee }]);
  } else {
    const body = callee.statements;
    if (callee.truncated) {
      assert.equal(body.length, 1); const branch = body[0]; assert.equal(branch.kind, 'if');
      const result = oneReturn(branch.body);
      shape = 'partial';
      add(callee, ko ? `${actor}의 보인 부분은 ${q(branch.predicate)}이면 ${q(result.expression)}를 반환하며 쓰기·내부 호출은 없습니다.`
        : `${actor}'s visible part returns ${q(result.expression)} if ${q(branch.predicate)}, with no writes or inner calls in this part.`,
      [fact(branch, 'condition', branch.predicate), fact(result, 'return', result.expression)]);
      add(undefined, ko ? `${actor}의 잘린 나머지 결과·변경·호출·효과·완료는 미확인입니다.`
        : `${actor}'s truncated remaining results, writes, calls, effects and completion are unknown.`,
      [{ kind: 'truncated-tail', callable: callee.name }]);
    } else if (body.length === 1 && body[0].kind === 'try') {
      const attempt = body[0];
      assert.equal(attempt.cleanup.length, 1); const cleanup = attempt.cleanup[0]; assert.equal(cleanup.kind, 'call');
      assert.ok(![parent.name, callee.name].includes(cleanup.callee), 'An available recursive/caller body is not an unknown inner implementation');
      assert.ok(attempt.caught.length <= 1);
      const choices = returnChoices(attempt.body, ko), caught = attempt.caught.length ? oneReturn(attempt.caught) : undefined;
      shape = caught ? choices.branched ? 'combined' : 'catch-cleanup' : 'try-finally';
      add(callee, ko ? `${actor}의 try는 ${choices.text}${caught ? `, catch에 도달하면 ${q(caught.expression)}를 선택합니다.` : '를 선택합니다.'}`
        : `${actor}'s try selects ${choices.text}${caught ? `; if catch is reached, it selects ${q(caught.expression)}.` : '.'}`,
      [...choices.facts, ...(caught ? [fact(caught, 'catch-return', caught.expression)] : [])]);
      add(callee, ko ? `${actor}의 finally는 반환 완료 전에 ${q(cleanup.code.replace(/;$/u, ''))}를 호출합니다.`
        : `${actor}'s finally calls ${q(cleanup.code.replace(/;$/u, ''))} before return completion.`,
      [fact(cleanup, 'finally-call', cleanup.code.replace(/;$/u, ''))]);
      add(undefined, ko ? `내부 호출 ${q(cleanup.callee)}의 구현이 없어 동작·효과·완료는 미확인입니다.`
        : `Inner call ${q(cleanup.callee)} has no supplied implementation; behavior, effects and completion are unknown.`,
      [{ kind: 'unavailable-inner-body', callable: cleanup.callee }]);
    } else if (body[0]?.kind === 'declare') {
      assert.equal(body.length, 3);
      const [initial, change, result] = body; assert.equal(result.kind, 'return'); assert.ok(!result.invocation);
      assert.equal(result.expression, initial.name);
      let update, predicate;
      if (change.kind === 'while') { assert.equal(change.body.length, 1); update = change.body[0]; predicate = change.predicate; }
      else update = change;
      assert.equal(update.kind, 'assign'); assert.equal(update.name, initial.name);
      const declaration = `${initial.name} = ${initial.expression}`, mutation = `${update.name} ${update.operator} ${update.expression}`;
      shape = predicate ? 'loop' : 'writes';
      add(callee, ko ? `${actor}에서는 지역 ${q(declaration)}를 만들고 ${predicate ? `${q(predicate)}인 동안 ${q(mutation)}를 반복하며 반복 종료 경로에서` : `${q(mutation)} 후`} ${q(result.expression)}를 반환하며 내부 호출은 없습니다.`
        : `${actor} initializes local ${q(declaration)}, ${predicate ? `repeats ${q(mutation)} while ${q(predicate)} and, if the loop exits, returns` : `applies ${q(mutation)} and returns`} ${q(result.expression)}, with no inner calls.`,
      [fact(initial, 'local-initialization', declaration), ...(predicate ? [fact(change, 'loop-condition', predicate)] : []),
        fact(update, 'local-update', mutation), fact(result, 'return', result.expression)]);
    } else {
      const choices = returnChoices(body, ko); shape = choices.branched ? 'guard' : 'arithmetic';
      add(callee, ko ? `${actor}에서는 ${choices.text}를 반환하며 명시적 쓰기·내부 호출은 없습니다.`
        : `${actor} returns ${choices.text}, with no explicit writes or inner calls.`, choices.facts);
    }
  }
  const cleanup = callee?.statements[0]?.kind === 'try';
  add(parent, ko ? `${cleanup ? '대상의 finally가 정상 완료하고 대상이' : '대상이'} 정상 복귀하면 부모 ${q(parent.name)}가 호출 결과를 반환합니다.`
    : `${cleanup ? 'If finally completes normally and the callee returns normally' : 'If the callee returns normally'}, parent ${q(parent.name)} returns the call result.`,
  [{ kind: 'normal-return-use', expression: use.expression, from: use.from, to: use.to }]);
  const flow = steps.map(step => step.text).join(' ');
  assert.ok(steps.length >= 3 && steps.length <= 5 && Array.from(flow).length <= 600, `Full flow bound: ${Array.from(flow).length}`);
  if (ko) for (const step of steps) assert.match(step.text, /^[가-힣]/u);
  // Provenance validation is independent of the old completion. Every positive
  // source citation must fit the owning snapshot; null claims have no source span.
  for (const claim of claims) for (const entry of claim.facts) {
    if (entry.sourceId === null) { assert.ok(entry.from === undefined && entry.to === undefined); continue; }
    const owner = entry.sourceId === parent.sourceId ? parent : callee;
    assert.ok(entry.from >= 0 && entry.to <= owner.sourceText.length && entry.to > entry.from);
    const source = owner.sourceText.slice(entry.from, entry.to).replace(/\s+/gu, '');
    assert.ok(source.includes(entry.expression.replace(/\s+/gu, '')), 'Unowned source expression');
  }
  return { steps, claims, shape, declarations: { parent, ...(callee ? { callee } : {}) } };
}

/** A bounded return alternative is valid only when the full container has exactly the declared statements. */
function returnChoices(body, ko) {
  if (body.length === 1) {
    const result = oneReturn(body);
    return { text: q(result.expression), branched: false, facts: [fact(result, 'return', result.expression)] };
  }
  assert.equal(body.length, 2); const [branch, later] = body; assert.equal(branch.kind, 'if');
  const result = oneReturn(branch.body); assert.equal(later.kind, 'return'); assert.ok(!later.invocation);
  return { text: ko ? `${q(branch.predicate)}이면 ${q(result.expression)}, 아니면 ${q(later.expression)}`
    : `${q(result.expression)} if ${q(branch.predicate)}, otherwise ${q(later.expression)}`, branched: true,
  facts: [fact(branch, 'condition', branch.predicate), fact(result, 'branch-return', result.expression), fact(later, 'later-return', later.expression)] };
}
function oneReturn(body) {
  assert.equal(body.length, 1); assert.equal(body[0].kind, 'return'); assert.ok(!body[0].invocation); return body[0];
}
function fact(node, kind, expression) { return { kind, expression, from: node.from, to: node.to }; }
