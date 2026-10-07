/** Bounded typed input candidates prove one primitive source route without executing source. */
import type { FunctionNarrativeContext, FunctionNarrativeFlowPath, FunctionNarrativeExample } from "../../../shared/functionNarratives";
import { getFunctionNarrativeExampleConstraints } from "../scenarioFrames";
import { tracePrimitiveRoute, type PrimitiveTrace } from "./trace";
import type { Primitive } from "./expression";

/** At most 128 candidates and eight declared inputs; an excluded example supports a concrete alternative on an unchanged route. */
export function selectPrimitiveTrace(context: FunctionNarrativeContext, path: FunctionNarrativeFlowPath, language: "ko" | "en",
  excluded?: FunctionNarrativeExample["inputs"]): PrimitiveTrace | undefined {
  if (!context.parameters || context.parameters.length > 8) return undefined;
  const single = { ...context, sourceFlow: { basis: "source-control-flow" as const, paths: [path], limited: path.status === "partial" } };
  const constraints = getFunctionNarrativeExampleConstraints(single, 0), numeric = new Set([10, 0, 1, -1]);
  for (const step of path.steps.filter(step => step.kind === "condition" || step.kind === "loop")) {
    for (const match of (step.loweredPredicate ?? step.code).matchAll(/\b\d+(?:\.\d+)?\b/gu)) {
      const value = Number(match[0]); numeric.add(value); numeric.add(value + 1); numeric.add(value - 1);
    }
  }
  let candidates: Map<string, Primitive>[] = [new Map()];
  for (const parameter of context.parameters) {
    if (parameter.name.length > 32) return undefined;
    const type = parameter.type?.replace(/\s/gu, "") ?? "", boolean = constraints.booleans.find(value => value.name === parameter.name);
    if (constraints.nullInputs.includes(parameter.name) && !type.endsWith("?")
      || boolean && !/^(?:Boolean\??|boolean)$/u.test(type)) return undefined;
    const options: Primitive[] | undefined = constraints.nullInputs.includes(parameter.name) ? [null] : boolean ? [boolean.json === "true"]
      : /^(?:Boolean\??|boolean)$/u.test(type) ? [true, false]
        : /^(?:Int\??|number)$/u.test(type) ? [...numeric].slice(0, 12)
          : /^(?:String\??|string)$/u.test(type) ? ["sample", "other"] : undefined;
    if (!options) return undefined;
    const next: Map<string, Primitive>[] = [];
    for (const candidate of candidates) for (const value of options) {
      if (next.length >= 128) break;
      next.push(new Map([...candidate, [parameter.name, value]]));
    }
    candidates = next;
  }
  for (const candidate of candidates) {
    if (excluded && excluded.every(input => JSON.stringify(candidate.get(input.name)) === input.json)) continue;
    const trace = tracePrimitiveRoute(context, path, candidate, language);
    if (trace) return trace;
  }
  return undefined;
}
