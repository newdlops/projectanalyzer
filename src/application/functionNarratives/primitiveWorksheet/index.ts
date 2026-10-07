/** Public conservative source worksheet boundary; final purpose/paragraph synthesis always remains with the selected LLM. */
import type { FunctionNarrativeContext } from "../../../shared/functionNarratives";
import { buildFunctionNarrativeScenarioFrames, getFunctionNarrativeExampleConstraints } from "../scenarioFrames";
import { tracePrimitiveRoute, type PrimitiveTrace } from "./trace";
import type { Primitive } from "./expression";

/** Returns the existing validated response contract only for fully proved primitive preparation/node tasks. */
export function buildPrimitiveWorksheetResponse(context: FunctionNarrativeContext, language: "ko" | "en"): string | undefined {
  if (!context.nodePreparation && !context.nodeTask || context.summaryTask || !supportedContext(context)) return undefined;
  if (context.nodeTask?.targets.some(target => !target.graphNodeId)) return undefined;
  const traces: PrimitiveTrace[] = [];
  for (let index = 0; index < context.sourceFlow!.paths.length; index++) {
    const path = context.sourceFlow!.paths[index];
    let trace: PrimitiveTrace | undefined;
    if (context.nodeTask) {
      try { trace = tracePrimitiveRoute(context, path, new Map(context.nodeTask.example.inputs.map(input => [input.name, JSON.parse(input.json)])), language); }
      catch { return undefined; }
    } else {
      const constraints = getFunctionNarrativeExampleConstraints(context, index);
      const numeric = new Set([10, 0, 1, -1]);
      for (const step of path.steps.filter(step => step.kind === "condition")) {
        for (const match of (step.loweredPredicate ?? step.code).matchAll(/\b\d+(?:\.\d+)?\b/gu)) {
          const value = Number(match[0]); numeric.add(value); numeric.add(value + 1); numeric.add(value - 1);
        }
      }
      // A bounded queue of Cartesian candidates proves route feasibility without executing source or enumerating unbounded inputs.
      let candidates: Map<string, Primitive>[] = [new Map()];
      for (const parameter of context.parameters!) {
        if (parameter.name.length > 32) return undefined;
        const type = parameter.type?.replace(/\s/gu, "") ?? "";
        const boolean = constraints.booleans.find(value => value.name === parameter.name);
        if (constraints.nullInputs.includes(parameter.name) && !type.endsWith("?")
          || boolean && !/^(?:Boolean\??|boolean)$/u.test(type)) return undefined;
        const options: Primitive[] | undefined = constraints.nullInputs.includes(parameter.name) ? [null] : boolean ? [boolean.json === "true"]
          : /^(?:Boolean\??|boolean)$/u.test(type) ? [true, false]
            : /^(?:Int\??|number)$/u.test(type) ? [...numeric].slice(0, 12)
              : /^(?:String\??|string)$/u.test(type) ? ["sample"] : undefined;
        if (!options) return undefined;
        const next: Map<string, Primitive>[] = [];
        for (const candidate of candidates) for (const value of options) {
          if (next.length >= 128) break;
          next.push(new Map([...candidate, [parameter.name, value]]));
        }
        candidates = next;
      }
      for (const candidate of candidates) { trace = tracePrimitiveRoute(context, path, candidate, language); if (trace) break; }
    }
    if (!trace) return undefined;
    traces.push(trace);
  }
  if (context.nodeTask) {
    const path = context.sourceFlow!.paths[0], trace = traces[0];
    const first = path.steps.findIndex(step => step.graphNodeId === context.nodeTask!.targets[0]?.graphNodeId
      && step.graphOccurrence === context.nodeTask!.targets[0]?.graphOccurrence);
    const prior = new Map(trace.inputs.map(input => [input.name, input.json]));
    for (let index = 0; index < first; index++) if (path.steps[index].kind === "mutation") {
      for (const value of trace.steps[index].values ?? []) prior.set(value.name, value.after);
    }
    // Mixed fallback work must not silently overwrite an earlier model guess.
    // Unknown/mismatching carried values preserve the existing LLM request.
    for (const value of context.nodeTask.reading?.priorState ?? []) {
      try { if (prior.get(value.name) !== JSON.stringify(JSON.parse(value.value))) return undefined; }
      catch { return undefined; }
    }
    const steps = context.nodeTask.targets.map(target => {
      const index = path.steps.findIndex(step => step.graphNodeId === target.graphNodeId && step.graphOccurrence === target.graphOccurrence);
      return index < 0 ? undefined : trace.steps[index];
    });
    return steps.every(Boolean) ? JSON.stringify({ steps }) : undefined;
  }
  const ko = language === "ko", frames = buildFunctionNarrativeScenarioFrames(context);
  return JSON.stringify({ summary: ko ? "소스 노드를 순서대로 읽고 있습니다." : "Source nodes are being read in order.", limitations: [],
    scenarios: traces.map((trace, index) => ({ title: ko ? "노드 해설 준비" : "Preparing node readings", when: frames[index].when,
      outcome: frames[index].outcome, explanation: ko ? "소스 노드를 순서대로 읽고 있습니다." : "Source nodes are being read in order.",
      analysis: { pathReason: ko ? "소스 해설 준비 중입니다." : "Preparing source readings.", stateChange: ko ? "소스 해설 준비 중입니다." : "Preparing source readings.",
        alternative: ko ? "소스 해설 준비 중입니다." : "Preparing source readings." }, assumptions: [], example: { inputs: trace.inputs, result: "null" }, steps: trace.steps.slice(0, 2) })) });
}

/** Final synthesis can omit fabricated prerequisites only when its exact completed primitive result is source-proved. */
export function hasCompletePrimitiveWorksheet(context: FunctionNarrativeContext): boolean {
  if (!context.summaryTask || !supportedContext(context) || context.sourceFlow!.paths.length !== 1
    || context.snippets.some(snippet => snippet.truncated || snippet.role === "helper")) return false;
  try {
    const trace = tracePrimitiveRoute(context, context.sourceFlow!.paths[0],
      new Map(context.summaryTask.inputs.map(input => [input.name, JSON.parse(input.json)])), "en");
    return trace !== undefined && trace.result === context.summaryTask.resultJson;
  } catch { return false; }
}

/** Independent capability guard shared by preparation, focused reads and final-summary evidence checks. */
function supportedContext(context: FunctionNarrativeContext): boolean {
  if (context.callTask || context.detailLevel !== "rich" || !["kotlin", "typescript", "javascript"].includes(context.language)
    // This worksheet independently proves every selected operation from source.
    // A bounded IR fact selection (groundingLimited) is not missing source;
    // inferred/partial/unsupported paths still fail the complete trace check.
    || context.limited || context.snippets.some(snippet => snippet.truncated)
    || !context.parameters || context.parameters.length > 8 || !context.sourceFlow?.paths.length
    || context.parameters.some(parameter => !/^(?:Boolean\??|Int\??|String\??|boolean|number|string)$/u.test(parameter.type?.replace(/\s/gu, "") ?? ""))) return false;
  const source = context.snippets.find(snippet => snippet.role === "function")?.text ?? "";
  // Nested lexical scopes, loops and exception transfers need richer binding/runtime semantics.
  return (source.match(/\{/gu)?.length ?? 0) === 1 && (source.match(/\}/gu)?.length ?? 0) === 1
    && !/\b(?:for|while|do|try|catch|throw|defer)\b/u.test(source);
}
