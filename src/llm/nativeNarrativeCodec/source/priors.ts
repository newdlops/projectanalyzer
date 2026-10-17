/** Validate whole original call-reading data and source references, without treating data labels as actual neural/source provenance. */
import { inputOptions, requireInput } from "../input/data";

/** A source-owned sequence and all six model fields stay aligned; no missing field, sentence or calculation is manufactured. */
export function requireNativeRootCallPriors(value: unknown, snippetIds: ReadonlySet<string>): void {
  const priors = inputOptions(value, ["basis", "signature", "sequence", "targets", "readings", "limitations"]);
  requireInput(priors.basis === "model-inference" && typeof priors.signature === "string");
  requireInput(Array.isArray(priors.sequence) && priors.sequence.length > 0 && priors.sequence.length <= 900
    && Array.isArray(priors.targets) && priors.targets.length === priors.sequence.length
    && Array.isArray(priors.readings) && priors.readings.length === priors.sequence.length && Array.isArray(priors.limitations));
  const ids = new Set<string>(), fields = ["callId", "role", "inputs", "output", "effects", "reason"];
  for (let index = 0; index < priors.sequence.length; index++) {
    const row = inputOptions(priors.sequence[index], ["callId", "expression", "callee", "deferred"]);
    requireInput(typeof row.callId === "string" && /^call-[1-9][0-9]{0,2}$/u.test(row.callId) && !ids.has(row.callId)); ids.add(row.callId);
    requireInput(typeof row.expression === "string" && typeof row.callee === "string" && typeof row.deferred === "boolean");
    const reading = inputOptions(priors.readings[index], fields);
    for (const field of fields) requireInput(typeof reading[field] === "string"); requireInput(reading.callId === row.callId);
    const target = inputOptions(priors.targets[index], ["callId", "caller", "callee", "language", "expression", "relation", "confidence", "guards", "loops", "deferred", "sourceLimited"],
      ["callerSnippet", "calleeSnippet", "arguments", "parameters", "sourceKind", "returnSyntax", "resultUse", "effectSyntax"]);
    requireInput(target.callId === row.callId && target.expression === row.expression && target.callee === row.callee && target.deferred === row.deferred);
    requireInput([target.caller, target.language].every(text => typeof text === "string") && ["call", "render", "event"].includes(target.relation)
      && ["exact", "resolved", "inferred", "unresolved"].includes(target.confidence) && typeof target.sourceLimited === "boolean");
    for (const field of ["callerSnippet", "calleeSnippet"]) if (Object.hasOwn(target, field)) requireInput(typeof target[field] === "string" && snippetIds.has(target[field]));
    requireInput(Array.isArray(target.guards) && Array.isArray(target.loops) && target.loops.every((text: unknown) => typeof text === "string"));
    for (const guard of target.guards) { const record = inputOptions(guard, ["expression", "outcome"]); requireInput(typeof record.expression === "string" && typeof record.outcome === "string"); }
    if (Object.hasOwn(target, "arguments")) requireInput(Array.isArray(target.arguments) && target.arguments.every((text: unknown) => typeof text === "string"));
    if (Object.hasOwn(target, "parameters")) { requireInput(Array.isArray(target.parameters)); for (const parameter of target.parameters) { const record = inputOptions(parameter, ["name", "type"]); requireInput(typeof record.name === "string" && typeof record.type === "string"); } }
    if (Object.hasOwn(target, "sourceKind")) requireInput(target.sourceKind === "method");
  }
  for (const limitations of priors.limitations) requireInput(Array.isArray(limitations) && limitations.every((text: unknown) => typeof text === "string"));
}
