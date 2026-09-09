/** Bounded input provenance and vocabulary extraction from parser-owned expressions, never return-label guessing. */
import type { FunctionTutorExpression as Expression, FunctionTutorStaticValue as Value } from "../functionTutor";
import type { NeuralScenarioProblem } from "./types";

export type NeuralInputEvidence = { strings: string[]; lengths: number[] };

/** Propagates parameter ownership through assignments so derived comparison literals can seed input mutations. */
export function collectNeuralInputEvidence(problem: NeuralScenarioProblem): Map<string, NeuralInputEvidence> {
  const result = new Map(problem.declaration.parameters.map((parameter) => [parameter.id, { strings: [] as string[], lengths: [] as number[] }]));
  const owners = new Map<string, Set<string>>();
  for (const binding of problem.declaration.program.bindings) {
    const parameter = problem.declaration.parameters.find((item) => item.id === binding.parameterId || item.bindingId === binding.bindingId);
    if (parameter) owners.set(binding.bindingId, new Set([parameter.id]));
  }
  const assignments = problem.declaration.program.blocks.flatMap((block) => block.operations.flatMap((operation) =>
    operation.kind === "define" ? [{ bindingId: operation.bindingId, expression: operation.value }]
      : operation.kind === "assign" ? [{ bindingId: operation.target.bindingId, expression: operation.value }] : []));
  const parts = assignments.map((assignment) => ({ ...assignment, facts: expressionFacts(assignment.expression) }));
  // Fixed-point union is monotone and bounded; cycles cannot cause recursive expansion.
  for (let pass = 0; pass < 32; pass += 1) {
    let changed = false;
    for (const part of parts) {
      const target = owners.get(part.bindingId) ?? new Set<string>();
      for (const bindingId of part.facts.bindings) for (const parameterId of owners.get(bindingId) ?? []) {
        if (!target.has(parameterId)) { target.add(parameterId); changed = true; }
      }
      owners.set(part.bindingId, target);
    }
    if (!changed) break;
  }
  const add = (ids: Iterable<string>, facts: ReturnType<typeof expressionFacts>) => {
    for (const id of ids) {
      const item = result.get(id); if (!item) continue;
      item.strings.push(...facts.literals.filter((value) => value.kind === "string").map((value) => (value as Value & { value: string }).value));
      item.lengths.push(...facts.literals.filter((value) => value.kind === "number").map((value) => (value as Value & { value: number }).value));
    }
  };
  for (const part of parts) add(owners.get(part.bindingId) ?? [], part.facts);
  for (const block of problem.declaration.program.blocks) {
    if (!block.decision) continue;
    const facts = expressionFacts(block.decision.expression);
    add(new Set(facts.bindings.flatMap((id) => [...(owners.get(id) ?? [])])), facts);
  }
  for (const item of result.values()) {
    item.strings = [...new Set(item.strings)].filter((value) => value.length <= 512).slice(0, 32);
    item.lengths = [...new Set(item.lengths)].filter((value) => Number.isInteger(value) && value >= 0 && value <= 512).slice(0, 32);
  }
  return result;
}

/** Walks only expression-owned data; source locations, callee names and return-only text are not vocabulary. */
function expressionFacts(root: Expression): { bindings: string[]; literals: Value[] } {
  const bindings = new Set<string>(); const literals: Value[] = []; const queue = [root]; const visited = new Set<Expression>();
  for (let cursor = 0; cursor < queue.length && cursor < 512; cursor += 1) {
    const item = queue[cursor]; if (visited.has(item)) continue; visited.add(item);
    if (item.kind === "binding") bindings.add(item.bindingId);
    else if (item.kind === "literal") literals.push(item.value);
    else if (item.kind === "member") queue.push(item.object);
    else if (item.kind === "binary") queue.push(item.left, item.right);
    else if (item.kind === "unary" || item.kind === "await") queue.push(item.operand);
    else if (item.kind === "logical") queue.push(...item.members);
    else if (item.kind === "conditional") queue.push(item.condition, item.whenTrue, item.whenFalse);
    else if (item.kind === "array") queue.push(...item.items);
    else if (item.kind === "object") queue.push(...item.entries.map((entry) => entry.value));
    else if (item.kind === "direct-call") queue.push(...item.arguments, ...(item.receiver ? [item.receiver] : []));
  }
  return { bindings: [...bindings], literals };
}

/** Source/caller tokens, affix inversions and near misses provide a bounded finite string vocabulary. */
export function createNeuralStringDomain(observed: string[], evidence: NeuralInputEvidence, name: string): string[] {
  const roots = [...new Set([...observed, ...evidence.strings])].filter((value) => value.length <= 512);
  const derived: string[] = [];
  for (const value of roots) for (const affix of evidence.strings) {
    if (!affix || value === affix) continue;
    if (value.startsWith(affix)) derived.push(value.slice(affix.length));
    if (value.endsWith(affix)) derived.push(value.slice(0, -affix.length));
  }
  const meaningful = [...new Set([...observed.filter(Boolean), ...derived.filter(Boolean), ...roots.filter(Boolean)])].slice(0, 24);
  const base = meaningful[0] || name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 24) || "a";
  const values = new Set<string>([...meaningful, "", " ", "\t", "\n", "\u200b"]);
  const lengths = [...new Set([0, 1, 2, ...evidence.lengths.flatMap((length) => [length - 1, length, length + 1]), ...meaningful.flatMap((value) => [value.length - 1, value.length, value.length + 1])])];
  for (const length of lengths) if (length >= 0 && length <= 512) values.add(base.repeat(Math.ceil(length / base.length)).slice(0, length));
  for (const value of meaningful) {
    for (const variant of [value.toLowerCase(), value.toUpperCase(), " " + value, value + " ", "\t" + value, value + "\u200b", value.slice(0, -1), value + "!", "가" + value]) values.add(variant);
    for (let index = 0; index < Math.min(12, value.length); index += 1) {
      values.add(value.slice(0, index) + value.slice(index + 1));
      values.add(value.slice(0, index) + (value[index] === "a" ? "b" : "a") + value.slice(index + 1));
    }
  }
  // Even length-only functions need enough distinct lengths to fit and hold out data.
  for (let length = 1; length <= 64; length += 1) values.add(base.repeat(Math.ceil(length / base.length)).slice(0, length));
  return [...values].filter((value) => value.length <= 512).slice(0, 160);
}
