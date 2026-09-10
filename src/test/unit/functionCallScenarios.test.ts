/** Parent scenario snapshots exercise source ordering, per-visit choices, termination and traversal limits. */
import assert from "node:assert/strict";
import test from "node:test";
import { createFunctionCallsSlice } from "../../application/functionCalls";
import { getFunctionCallsControlSource } from "../../webview/functionCalls/controlSource";
import { functionCallsToken, loadFunctionCallsFixture } from "./helpers/functionCallsFixture";

const runtime = new Function(`${getFunctionCallsControlSource()}; return { traceFunctionCalls, exampleFunctionCallScenarios };`)();
type Choice = { key: string; kind: string; visit: number; label: string; options: Array<{ value: string; kind: string }> };

/** Selects decisions at the point they are reached, so tests do not rely on source line IDs. */
async function scenario(language: "typescript" | "python", name: string) {
  const f = await loadFunctionCallsFixture(language), analysis = f.analysis(name);
  const slice = createFunctionCallsSlice(f.graph, analysis, { graphVersion: "snapshot:scenarios", sourceToken: functionCallsToken(analysis.functionNode.id), requestId: 1 }, functionCallsToken, () => undefined, f.file.content);
  const connections = new Map(slice.connections.map(connection => [connection.id, connection]));
  const names = (trace: { callIds: string[] }) => trace.callIds.map(id => slice.nodes.find(node => node.id === connections.get(id)?.to)!.name);
  const run = (choose: (decision: Choice) => string) => {
    const selection = new Map();
    for (let i = 0; i < 64; i += 1) {
      const trace = runtime.traceFunctionCalls(slice.control, connections, selection);
      if (!trace.pending) return trace;
      const decision = trace.pending as Choice, outcome = choose(decision);
      const option = decision.options.find(option => option.value === outcome || option.kind === outcome);
      assert.ok(option, `No ${outcome} option at ${decision.label}`); selection.set(decision.key, option.value);
    }
    throw new Error("Unbounded scenario decisions");
  };
  return { f, analysis, slice, connections, names, run };
}

for (const language of ["typescript", "python"] as const) {
  const python = language === "python";
  test(`${language} parent scenarios separate early return from joined normal calls`, async () => {
    const s = await scenario(language, python ? "process_batch" : "processBatch");
    const early = s.run(() => "true");
    assert.deepEqual(s.names(early), ["reject"]);
    assert.equal(early.terminal.kind, "return");
    const skipped = s.run(decision => decision.kind === "loop" ? "0" : "false");
    assert.deepEqual(s.names(skipped), ["finish", "persist"]);
    const normal = s.run(decision => decision.kind === "loop" ? "1" : /enabled/u.test(decision.label) ? "false" : "true");
    assert.deepEqual(s.names(normal), [python ? "is_ready" : "isReady", "persist", "notify", "audit", "finish", "persist"]);
    assert.equal(normal.status, "complete");
    assert.equal(normal.limited, false);
    const examples = runtime.exampleFunctionCallScenarios(s.slice.control, s.connections);
    assert.ok(examples.length > 1 && examples.length <= 8);
    assert.ok(examples.some((example: { trace: { callIds: string[] } }) => s.names(example.trace).join() === "reject"));
    assert.doesNotMatch(JSON.stringify(s.slice.control), /\/workspace\//u);
  });

  test(`${language} nested argument calls and conditional tests precede their consumer`, async () => {
    const s = await scenario(language, python ? "nested_calls" : "nestedCalls");
    assert.deepEqual(s.names(s.run(() => "true")), [python ? "is_ready" : "isReady", "audit", "persist", "notify"]);
    assert.deepEqual(s.names(s.run(() => "false")), [python ? "is_ready" : "isReady", "reject", "notify"]);
    const trace = s.run(() => "true");
    assert.equal(trace.rows.find((row: { ordinal?: number }) => row.ordinal === 3).expression, "persist(audit(1))");
    // A visual decision belongs after the call which computes its predicate,
    // before the selected argument arm; repeated guards do not duplicate it.
    assert.deepEqual(trace.rows.map((row: { kind: string }) => row.kind), ["call", "decision", "call", "call", "call"]);
    const awaiting = runtime.traceFunctionCalls(s.slice.control, s.connections);
    assert.deepEqual(s.names(awaiting), [python ? "is_ready" : "isReady"]);
    assert.equal(awaiting.rows.at(-1).decisionKey, awaiting.pending.key);
  });

  test(`${language} repeated decisions and loop visits keep independent outcomes`, async () => {
    const s = await scenario(language, python ? "process_batch" : "processBatch");
    const trace = s.run(decision => decision.kind === "loop" ? "2" : /enabled/u.test(decision.label) ? "false" : /is_?[Rr]eady/u.test(decision.label) ? decision.visit === 1 ? "true" : "false" : "false");
    assert.deepEqual(s.names(trace), [python ? "is_ready" : "isReady", "persist", "notify", python ? "is_ready" : "isReady", "reject", "finish", "persist"]);
    const repeated = trace.decisions.filter((decision: Choice) => /is_?[Rr]eady/u.test(decision.label));
    assert.equal(repeated.length, 2); assert.notEqual(repeated[0].key, repeated[1].key);
    assert.deepEqual(trace.rows.filter((row: { kind: string; label: string }) => row.kind === "decision" && /is_?[Rr]eady/u.test(row.label)).map((row: { decisionKey: string }) => row.decisionKey), repeated.map((decision: Choice) => decision.key));
    const sameText = await scenario(language, python ? "repeat_decision" : "repeatDecision");
    let count = 0;
    const changed = sameText.run(() => ++count === 1 ? "true" : "false");
    assert.deepEqual(sameText.names(changed), ["persist", "audit", "finish"]);
    assert.notEqual(changed.decisions[0].key, changed.decisions[1].key);
  });

  test(`${language} continue and break change the parent's subsequent call order`, async () => {
    const s = await scenario(language, python ? "loop_control" : "loopControl");
    const trace = s.run(decision => decision.kind === "loop" ? "2" : /is_?[Rr]eady/u.test(decision.label) ? decision.visit === 1 ? "true" : "false" : "true");
    assert.deepEqual(s.names(trace), [python ? "is_ready" : "isReady", python ? "is_ready" : "isReady", "persist", "finish"]);
    assert.ok(trace.rows.some((row: { kind: string }) => row.kind === "continue"));
    assert.ok(trace.rows.some((row: { kind: string }) => row.kind === "break"));
  });

  test(`${language} iterator expressions run once while predicates are tested again at loop exit`, async () => {
    const iterator = await scenario(language, python ? "iterator_calls" : "iteratorCalls");
    assert.deepEqual(iterator.names(iterator.run(() => "2")), [python ? "load_items" : "loadItems", "persist", "persist", "finish"]);
    const condition = await scenario(language, python ? "condition_loop" : "conditionLoop");
    assert.deepEqual(condition.names(condition.run(() => "1")), [python ? "is_ready" : "isReady", "persist", python ? "is_ready" : "isReady", "finish"]);
  });

  test(`${language} finally cleanup follows evaluation of a returned business call`, async () => {
    const s = await scenario(language, "cleanup");
    const trace = s.run(decision => decision.options.some(option => option.kind === "true") ? "true" : decision.options[0].value);
    assert.deepEqual(s.names(trace), ["persist", "audit"]);
    assert.equal(trace.terminal.kind, "return");
  });

  test(`${language} nested cleanup, overriding return and thrown completion retain their order`, async () => {
    const nested = await scenario(language, python ? "nested_cleanup" : "nestedCleanup");
    assert.deepEqual(nested.names(nested.run(decision => decision.options[0].value)), ["persist", "audit", "notify"]);
    const override = await scenario(language, python ? "override_cleanup" : "overrideCleanup");
    const overridden = override.run(decision => decision.options[0].value);
    assert.deepEqual(override.names(overridden), ["persist", "notify"]);
    assert.match(overridden.terminal.label, /notify\(2\)/u);
    const thrown = await scenario(language, python ? "throw_cleanup" : "throwCleanup");
    const throwing = thrown.run(decision => decision.options[0].value);
    assert.deepEqual(thrown.names(throwing), ["reject", "audit"]);
    assert.equal(throwing.terminal.kind, "throw");
  });

  test(`${language} continue and break run finally before transferring out of the try`, async () => {
    const s = await scenario(language, python ? "loop_cleanup" : "loopCleanup");
    const trace = s.run(decision => decision.kind === "loop" ? "2" : /is_?[Rr]eady/u.test(decision.label) ? decision.visit === 1 ? "true" : "false" : decision.options[0].value);
    assert.deepEqual(s.names(trace), [python ? "is_ready" : "isReady", "audit", python ? "is_ready" : "isReady", "persist", "audit", "finish"]);
    assert.equal(trace.status, "complete");
  });

  test(`${language} an unresolved throw-to-catch transfer is not presented as an uncaught exit`, async () => {
    const s = await scenario(language, python ? "caught_throw" : "caughtThrow");
    const trace = s.run(decision => decision.options[0].value);
    assert.deepEqual(s.names(trace), ["reject"]);
    assert.equal(trace.status, "limited");
    assert.equal(trace.terminal, undefined);
  });
}

test("optional dispatch and deferred handlers are not forced into the immediate call sequence", async () => {
  const optional = await scenario("typescript", "conditionalArguments");
  assert.deepEqual(optional.names(optional.run(decision => decision.options.some(option => option.kind === "nullish") ? "nullish" : "false")), ["audit", "notify", "audit"]);
  const delayed = await scenario("typescript", "delayed");
  assert.deepEqual(delayed.names(delayed.run(() => "true")), ["audit"]);
  assert.ok(delayed.slice.connections.some(connection => connection.deferred));
});

test("control traversal stops at unknown nodes, missing targets, cycles and step budgets", async () => {
  const s = await scenario("typescript", "processBatch");
  assert.equal(runtime.traceFunctionCalls(s.slice.control, s.connections).status, "awaiting");
  assert.equal(runtime.traceFunctionCalls(s.slice.control, s.connections, new Map(), 1).status, "limited");
  const plan = { signature: "root()", entryId: "a", limited: false, blocks: [{ id: "a", kind: "entry", label: "root", loopIds: [], calls: [], next: [{ id: "ab", to: "b", kind: "next" }] }, { id: "b", kind: "operation", label: "", loopIds: [], calls: [], next: [{ id: "ba", to: "a", kind: "next" }] }] };
  assert.equal(runtime.traceFunctionCalls(plan, new Map()).status, "limited");
  plan.blocks.pop();
  assert.equal(runtime.traceFunctionCalls(plan, new Map()).status, "limited");
});
