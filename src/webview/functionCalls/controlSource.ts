/** Pure bounded scenario traversal and example planning; source expressions are labels, never executed. */
export function getFunctionCallsControlSource(): string {
  return /* js */ String.raw`
    /** Follows one parent's CFG using explicit assumptions, with independent decisions on each loop visit. */
    function traceFunctionCalls(plan, connections, selection = new Map(), maxSteps = 1024) {
      const blocks = new Map((plan?.blocks || []).map(block => [block.id, block]));
      const rows = [], decisions = [], callIds = [], seenChoices = new Set();
      const visits = new Map(), loops = new Map(), activations = new Map(), visited = new Set();
      const limit = Math.max(1, Math.min(2048, maxSteps));
      let current = plan?.entryId, pending, terminal, completion, limited = Boolean(plan?.limited), status = "limited";
      const choose = (key, label, options, kind, visit, blockId) => {
        const value = selection.get(key);
        const decision = { key, label, options, kind, visit, blockId, value: options.some(option => option.value === value) ? value : undefined };
        if (!seenChoices.has(key)) {
          seenChoices.add(key); decisions.push(decision);
          // Put the decision after its predicate calls and before dependent
          // calls, using the same visit identity as the editable control.
          if (kind !== "loop") rows.push({ kind: "decision", decisionKey: key, blockId, label, value: decision.value, visit });
        }
        if (!decision.value) { pending = decision; return undefined; }
        return decision.value;
      };
      for (let step = 0; current && step < limit && rows.length < 256; step += 1) {
        const block = blocks.get(current);
        if (!block) { limited = true; break; }
        // A break/return may leave a loop without revisiting its header.
        for (const [id, loop] of loops) if (id !== block.id && !(block.loopIds || []).includes(id)) {
          rows.push({ kind: "loopEnd", blockId: id, label: loop.label, count: loop.iteration }); loops.delete(id);
        }
        const stateKey = block.id + "|" + [...loops].map(([id, loop]) => id + ":" + loop.iteration).join("|") + "|" + (completion?.ownerId || "");
        if (visited.has(stateKey)) { limited = true; break; }
        visited.add(stateKey);
        const visit = (visits.get(block.id) || 0) + 1; visits.set(block.id, visit);
        const repeatIterator = block.kind === "loop" && block.loopKind === "iterator" && loops.has(block.id);
        for (const call of repeatIterator ? [] : block.calls || []) {
          const connection = connections.get(call.connectionId);
          if (!connection) { limited = true; continue; }
          let included = true;
          for (const guard of call.guards || []) {
            const nullish = ["nullish", "notNullish"].includes(guard.outcome);
            const outcomes = nullish ? ["notNullish", "nullish"] : ["true", "false"];
            const key = guard.id + ":" + block.id + ":" + visit;
            const value = choose(key, guard.expression, outcomes.map(outcome => ({ value: outcome, kind: outcome })), "expression", visit, block.id);
            if (!value) { included = false; break; }
            if (value !== guard.outcome) { included = false; break; }
          }
          if (pending) break;
          if (included) {
            if (connection.deferred || connection.relation !== "call") {
              rows.push({ kind: "deferred", blockId: block.id, connectionId: call.connectionId, expression: call.expression }); continue;
            }
            callIds.push(call.connectionId);
            rows.push({ kind: "call", blockId: block.id, connectionId: call.connectionId, expression: call.expression,
              ordinal: callIds.length, visit, loops: [...loops.values()].map(loop => ({ label: loop.label, iteration: loop.iteration })) });
          }
        }
        if (pending) { status = "awaiting"; break; }
        const next = block.next || [];
        // The shared CFG sends throws to function exit even when a catch may
        // handle them. Do not turn that missing transfer into an uncaught result.
        if (block.unresolvedException) { terminal = undefined; limited = true; rows.push({ kind: "unknown", blockId: block.id, label: block.label }); break; }
        if (["return", "throw"].includes(block.kind)) terminal = { kind: block.kind, label: block.label, blockId: block.id };
        if (block.kind === "exit") { terminal ||= { kind: "exit", label: block.label, blockId: block.id }; status = "complete"; break; }
        if (block.kind === "unknown" || block.kind === "embedded") { limited = true; rows.push({ kind: "unknown", blockId: block.id, label: block.label }); }
        let edge;
        const body = block.kind === "loop" ? next.find(edge => ["iterate", "true"].includes(edge.kind)) : undefined;
        const exit = block.kind === "loop" ? next.find(edge => ["exit", "false"].includes(edge.kind)) : undefined;
        if (body && exit) {
          let loop = loops.get(block.id);
          if (!loop) {
            const activation = (activations.get(block.id) || 0) + 1; activations.set(block.id, activation);
            const key = block.id + ":loop:" + activation;
            const count = choose(key, block.label, ["1", "0", "2"].map(value => ({ value, kind: "iterations" })), "loop", activation, block.id);
            if (count === undefined) { status = "awaiting"; break; }
            loop = { label: block.label, iteration: 0, count: Number(count) };
            loops.set(block.id, loop);
          }
          if (loop.iteration < loop.count) {
            loop.iteration += 1; edge = body;
            rows.push({ kind: "loop", blockId: block.id, label: block.label, iteration: loop.iteration, count: loop.count });
          } else {
            edge = exit; loops.delete(block.id);
            rows.push({ kind: "loopEnd", blockId: block.id, label: block.label, count: loop.count });
          }
        } else if (next.length > 1) {
          const value = choose(block.id + ":branch:" + visit, block.label,
            next.map(edge => ({ value: edge.id, kind: edge.kind, label: edge.label })), "branch", visit, block.id);
          if (!value) { status = "awaiting"; break; }
          edge = next.find(edge => edge.id === value);
        } else edge = next[0];
        if (["break", "continue"].includes(block.kind)) rows.push({ kind: block.kind, blockId: block.id, label: block.label });
        if (!edge) { status = terminal ? "complete" : "limited"; limited ||= !terminal; break; }
        let target = edge.to;
        if (["return", "throw", "break", "continue"].includes(block.kind)) {
          if (["break", "continue"].includes(block.kind) && completion && !(blocks.get(target)?.finallyOwnerIds || []).includes(completion.ownerId)) terminal = undefined;
          if (edge.cleanups?.length) {
            const [first, ...remaining] = edge.cleanups;
            completion = { ownerId: first.ownerId, remaining, resumeTo: target }; target = first.entryId;
          } else if (completion && !(blocks.get(target)?.finallyOwnerIds || []).includes(completion.ownerId)) completion = undefined;
        }
        if (completion && !(blocks.get(target)?.finallyOwnerIds || []).includes(completion.ownerId)) {
          const nextCleanup = completion.remaining.shift();
          if (nextCleanup) { completion.ownerId = nextCleanup.ownerId; target = nextCleanup.entryId; }
          else { target = completion.resumeTo; completion = undefined; }
        }
        current = target;
      }
      if (status === "limited") limited = true;
      return { rows, decisions, callIds, pending, terminal, status, limited };
    }

    /** Enumerates a few bounded examples; two-iteration scenarios remain available through explicit editing. */
    function exampleFunctionCallScenarios(plan, connections, maxExamples = 8) {
      const queue = [new Map()], results = [], seen = new Set();
      for (let cursor = 0; cursor < queue.length && cursor < 160 && results.length < maxExamples; cursor += 1) {
        const selection = queue[cursor], trace = traceFunctionCalls(plan, connections, selection);
        if (trace.pending) {
          for (const option of trace.pending.options) {
            if (trace.pending.kind === "loop" && option.value === "2") continue;
            const next = new Map(selection); next.set(trace.pending.key, option.value);
            const signature = [...next].map(([key, value]) => key + "=" + value).join("|");
            if (seen.has(signature) || queue.length >= 256) continue;
            seen.add(signature); queue.push(next);
          }
        } else if (trace.status === "complete") results.push({ selection, trace });
      }
      return results.sort((a, b) => b.trace.callIds.length - a.trace.callIds.length);
    }
  `;
}
