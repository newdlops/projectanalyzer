/** One source-only numeric-domain plan per complete route. Reuses indexed syntax facts and never calculates or substitutes operand values. */
import type { FunctionNarrativeFlowStep, FunctionNarrativeValueFact } from "../../../shared/functionNarratives";
import { declaredRootValueDomain } from "./domains";
import { rootSourceLiteral } from "./syntax";
import type { NativeRootSourceContext } from "./types";

/** Retain original display domains, but admit a number field only with a declared/current-source proof at that exact occurrence. */
export function createRootNumericPlan(context: NativeRootSourceContext): ReadonlySet<FunctionNarrativeFlowStep> {
  const declared = new Set(context.parameters.filter(parameter => {
    const rule = declaredRootValueDomain(context.language, parameter.type) as any;
    return ["number", "integer"].includes(rule.type) || rule.anyOf?.some((item: any) => ["number", "integer"].includes(item.type));
  }).map(parameter => parameter.name));
  const original = new Set(declared), current = new Set(declared), result = new Set<FunctionNarrativeFlowStep>(), visited = new Set<string>();
  const isNumber = (names: ReadonlySet<string>, operand: string) => names.has(operand) || typeof rootSourceLiteral(operand)?.value === "number";
  const key = (snippetId: string, target: string) => JSON.stringify([snippetId, target]), index = new Map<string, FunctionNarrativeValueFact[]>();
  for (const fact of context.valueFacts ?? []) {
    const operands = fact.operation === "conditional" ? fact.operands.slice(1) : fact.operands;
    if (operands.length && operands.every(operand => isNumber(original, operand))) original.add(fact.target); else original.delete(fact.target);
    const id = key(fact.source.snippetId, fact.target), entries = index.get(id) ?? []; entries.push(fact); index.set(id, entries);
  }
  for (const step of context.sourceFlow.paths[0].steps) {
    const identity = JSON.stringify([step.graphNodeId, step.graphOccurrence]); if (visited.has(identity)) break; visited.add(identity);
    for (const written of step.writeTargets ?? []) {
      const facts = (index.get(key(step.source.snippetId, written)) ?? []).filter(fact => fact.source.startLine >= step.source.startLine && fact.source.endLine <= step.source.endLine);
      if (facts.length === 1) {
        const operands = facts[0].operation === "conditional" ? facts[0].operands.slice(1) : facts[0].operands;
        if (operands.length && operands.every(operand => isNumber(current, operand))) current.add(written); else current.delete(written);
      } else {
        const assignment = /^(?:(?:val|var|let|const)\s+)?([\p{L}_$][\p{L}\p{N}_$]*)(?:\s*:\s*[^=;]+)?\s*=\s*(.*?)\s*;?$/su.exec(step.code.trim());
        const expression = assignment?.[1] === written ? assignment[2] : step.code.trim(), literal = rootSourceLiteral(expression);
        if (typeof literal?.value === "boolean") current.delete(written);
        else if (isNumber(current, expression) || declared.has(written)) current.add(written);
        else current.delete(written);
      }
    }
    const name = step.writeTargets?.length === 1 ? step.writeTargets[0] : undefined;
    if (name && (original.has(name) || isNumber(original, step.code.trim())) && (current.has(name) || isNumber(current, step.code.trim()))) result.add(step);
  }
  return result;
}
