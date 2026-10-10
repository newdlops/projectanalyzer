/** Source-only projection of the bounded init/update-or-loop/return vocabulary.
 * Evidence is parsed here, never accepted from a completion or caller-supplied
 * inventory. Unsupported native syntax is refused by the parser boundary.
 */
import assert from 'node:assert/strict';
import { createModelReadingSourceControlEvidence } from '../model-reading-source-control-evidence.mjs';

/** Derive five ordered operations only from complete matching local-state bodies.
 * Nonlocal, missing and partial bodies keep their native evidence but have no
 * specialized operation slots. Source context is never changed.
 */
export function createNativeOperationFlowPlan(context) {
  const nativeEvidence = createModelReadingSourceControlEvidence(context);
  const caller = nativeEvidence.owners.find(owner => owner.role === 'caller');
  const callee = nativeEvidence.owners.find(owner => owner.role === 'callee');
  const unsupported = { nativeEvidence, operationSlots: [] };
  if (!callee || callee.sourceTruncated || !callee.completeNativeBody) return unsupported;
  const [initial, change, returned] = callee.events;
  if (callee.events.length !== 3 || initial.kind !== 'initialize-local' || returned.kind !== 'return-value'
    || returned.expression !== initial.binding) return unsupported;
  const update = change.kind === 'while' && change.body.length === 1 ? change.body[0] : change;
  if (update.kind !== 'update-local' || update.binding !== initial.binding) return unsupported;
  assert.equal(nativeEvidence.syntaxOnly, true); assert.equal(caller.events.length, 1);
  assert.equal(caller.events[0].kind, 'return-call-result');
  assert.deepEqual(callee.explicitInvocations, { completeInventory: true, sites: [] });
  const calleeLedger = nativeEvidence.ledger.filter(entry => entry.sourceId === callee.sourceId);
  const callerLedger = nativeEvidence.ledger.filter(entry => entry.sourceId === caller.sourceId);
  assert.equal(callerLedger.length, 1);
  /** Each slot cites its own statement, retaining loop-child spans separately. */
  const make = (owner, kind, event, statementIndex) => {
    const ledger = owner === caller ? callerLedger : calleeLedger.filter(entry => entry.path[0] === statementIndex);
    assert.ok(ledger.length);
    for (const entry of ledger) {
      const snippet = context.snippets.find(item => item.id === entry.sourceId);
      assert.ok(snippet && snippet.text.slice(entry.from, entry.to) === entry.code);
    }
    return { sourceId: owner.sourceId, callable: owner.callable, kind, event,
      ...(owner.confidence ? { confidence: owner.confidence } : {}), syntaxOnly: true, ledger };
  };
  return { nativeEvidence, shape: change.kind === 'while' ? 'loop' : 'writes', operationSlots: [
    make(caller, 'argument-transfer', caller.events[0], 0),
    make(callee, 'initialize-local', initial, 0),
    make(callee, change.kind === 'while' ? 'while-update' : 'update-local', change, 1),
    make(callee, 'return-value-after-previous-statement', returned, 2),
    make(caller, 'normal-return-result-use', caller.events[0], 0),
  ] };
}
