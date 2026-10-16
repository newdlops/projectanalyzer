/** Resolves overview, assumed source route or one callsite exclusively from Host-owned static projections. */
import type { FunctionCallsResponse, FunctionCallConnection } from "../../protocol/functionCalls";
import type { FunctionCallNarrativesRequest } from "../../protocol/functionCallNarratives";
import type { FunctionCallNarrativeTask } from "../../shared/functionCallNarratives";
import { traceFunctionCalls } from "../../shared/functionCalls";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
export type FunctionCallNarrativePlan = {
  rows: Array<{ callId: string; connection: FunctionCallConnection; expression: string; occurrence: number }>;
  facts: Omit<FunctionCallNarrativeTask, "targets" | "includeSummary">;
};

/** Inactive retained choices are allowed, but all keys/options must belong to the delivered control plan. */
function validChoices(slice: FunctionCallsResponse, choices: NonNullable<FunctionCallNarrativesRequest["choices"]>): boolean {
  const choicesByPrefix = new Map<string, string[]>();
  for (const block of slice.control?.blocks ?? []) {
    choicesByPrefix.set(block.id + ":branch:", block.next.map(edge => edge.id));
    choicesByPrefix.set(block.id + ":loop:", ["0", "1", "2"]);
    for (const call of block.calls) for (const guard of call.guards) choicesByPrefix.set(guard.id + ":" + block.id + ":", ["true", "false", "nullish", "notNullish"]);
  }
  return new Set(choices.map(choice => choice.key)).size === choices.length && choices.every(choice => {
    const boundary = choice.key.lastIndexOf(":") + 1;
    return /^[1-9][0-9]{0,2}$/u.test(choice.key.slice(boundary)) && choicesByPrefix.get(choice.key.slice(0, boundary))?.includes(choice.value);
  });
}

/** Repeated visits remain distinct; a relationship overview never pretends to be one runtime sequence. */
export function buildFunctionCallNarrativePlan(slice: FunctionCallsResponse, request: FunctionCallNarrativesRequest): FunctionCallNarrativePlan {
  const byId = new Map(slice.connections.map(connection => [connection.id, connection]));
  const names = new Map(slice.nodes.map(node => [node.id, node.name]));
  let rows: FunctionCallNarrativePlan["rows"] = [];
  let conditions: FunctionCallNarrativeTask["conditions"] = [];
  let routeStatus: FunctionCallNarrativeTask["routeStatus"] = "structure", terminal: string | undefined, limited = slice.limited;
  if (request.scope === "scenario") {
    if (!slice.control || !validChoices(slice, request.choices ?? [])) throw new FunctionNarrativeError("invalid-response");
    const trace = traceFunctionCalls(slice.control, byId, new Map(request.choices?.map(choice => [choice.key, choice.value])));
    conditions = trace.decisions.map(decision => ({ expression: decision.label, outcome: decision.options.find(option => option.value === decision.value)?.kind || "unknown", visit: decision.visit }));
    routeStatus = trace.status; terminal = trace.terminal?.label; limited ||= trace.limited || Boolean(trace.pending);
    const counts = new Map<string, number>();
    rows = trace.rows.filter(row => row.connectionId && ["call", "deferred"].includes(row.kind)).map(row => {
      const connection = byId.get(row.connectionId!)!;
      const occurrence = (counts.get(connection.id) ?? 0) + 1; counts.set(connection.id, occurrence);
      return { callId: "", connection, expression: row.expression ?? connection.label, occurrence };
    });
  } else {
    const selected = request.scope === "call" ? slice.connections.filter(connection => connection.id === request.connectionId) : slice.connections;
    if (request.scope === "call" && selected.length !== 1) throw new FunctionNarrativeError("invalid-response");
    rows = selected.map(connection => ({ callId: "", connection, expression: slice.control?.blocks.flatMap(block => block.calls).find(call => call.connectionId === connection.id)?.expression ?? connection.label, occurrence: 1 }));
  }
  rows.forEach((row, index) => { row.callId = "call-" + (index + 1); });
  const sequence = rows.map(row => ({ callId: row.callId, expression: row.expression, callee: names.get(row.connection.to) ?? "unknown",
    deferred: row.connection.deferred || row.connection.relation !== "call" }));
  return { rows, facts: { scope: request.scope, signature: slice.control?.signature ?? "", sequence,
    conditions: conditions.map(condition => ({ ...condition })), routeStatus, terminal, sourceLimited: limited } };
}
