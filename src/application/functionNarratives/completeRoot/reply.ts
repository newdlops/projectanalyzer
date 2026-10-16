/** Lossless conversion of a strictly decoded complete native reading to portable stored pages. Values are serialized, never calculated, normalized, clipped or repaired. */
import type { NativeNarrativeSchema, NativeRootSourceBindings } from "../../../llm/nativeNarrativeCodec";
import { FunctionNarrativeError, isFunctionNarrativePage, type FunctionNarrativePage, type FunctionNarrativeEvaluation,
  type FunctionNarrativeStep, type FunctionNarrativeValue, type FunctionNarrativeUnavailable } from "../../../shared/functionNarratives";

type Rule = Record<string, any>;
type DecodedStep = Omit<FunctionNarrativeStep, "values"> & { values: Array<{ name: string; before: unknown; after: unknown }> };
type DecodedRoot = FunctionNarrativeEvaluation & { reading: { summary: string; limitations: string[]; scenarios: Array<{
  title: string; when: string[]; explanation: string; analysis: { pathReason: string; stateChange: string; alternative: string };
  assumptions: string[]; outcome: string; steps: DecodedStep[]; exampleInputs: Array<{ name: string; value: unknown }>; exampleResult: unknown;
}> } };

/** The original schema distinguishes display text/source phase markers from typed JSON strings, including strings that resemble null or JSON. */
function displayCell(value: unknown, domain: Rule, symbolic: boolean): FunctionNarrativeValue {
  if (symbolic && value && typeof value === "object" && !Array.isArray(value)) return structuredClone(value) as FunctionNarrativeUnavailable;
  if (typeof value === "string" && (Object.hasOwn(domain, "const") || domain.type === "string" && domain.maxLength === 120 && domain.minLength === 1)) return value;
  const json = JSON.stringify(value); if (json === undefined) throw new FunctionNarrativeError("invalid-response"); return json;
}

/** Input is accepted only after the source-bound native decoder has validated its complete raw response. Graph identities come exclusively from captured Host bindings. */
export function projectCompleteRootReply(decoded: unknown, readingSchema: NativeNarrativeSchema, bindings: NativeRootSourceBindings): FunctionNarrativePage {
  const root = decoded as DecodedRoot, symbolic = root.mode === "source-infeasible" || root.mode === "unverified";
  const nativeScenario = root.reading.scenarios[0], schema = (readingSchema as Rule).properties.scenarios.items[0].properties;
  if (root.reading.scenarios.length !== 1 || nativeScenario.steps.length !== bindings.occurrences.length) throw new FunctionNarrativeError("invalid-response");
  const details = nativeScenario.steps.map((step, index) => {
    const binding = bindings.occurrences[index], valuesSchema = schema.steps.items[index].properties.values;
    if (step.code !== binding.code || JSON.stringify(step.source) !== JSON.stringify(binding.source)) throw new FunctionNarrativeError("invalid-response");
    const values = step.values.map((value, valueIndex) => {
      const domains = Object.hasOwn(valuesSchema, "const") ? { before: { const: valuesSchema.const[valueIndex].before }, after: { const: valuesSchema.const[valueIndex].after } }
        : (Array.isArray(valuesSchema.items) ? valuesSchema.items[valueIndex] : valuesSchema.items).properties;
      return { name: value.name, before: displayCell(value.before, domains.before, symbolic), after: displayCell(value.after, domains.after, symbolic) };
    });
    return { ...step, values, source: { ...binding.source }, nodeId: binding.nodeId, occurrence: binding.occurrence };
  });
  const exampleCell = (value: unknown): FunctionNarrativeValue => symbolic ? structuredClone(value) as FunctionNarrativeUnavailable : JSON.stringify(value);
  const page: FunctionNarrativePage = { summary: root.reading.summary, limitations: [...root.reading.limitations], scenarios: [{
    title: nativeScenario.title, when: [...nativeScenario.when], explanation: nativeScenario.explanation, analysis: { ...nativeScenario.analysis },
    outcome: nativeScenario.outcome, assumptions: [...nativeScenario.assumptions],
    example: { inputs: nativeScenario.exampleInputs.map(input => ({ name: input.name, json: exampleCell(input.value) })), result: exampleCell(nativeScenario.exampleResult) },
    evaluation: { mode: root.mode, justification: root.justification, ...(root.loopVisits ? { loopVisits: structuredClone(root.loopVisits) } : {}) },
    // The existing primary reader is bounded; every complete occurrence and full sentence remains in nodeDetails and disk storage.
    steps: details.slice(0, 5).map(({ nodeId: _nodeId, occurrence: _occurrence, ...step }) => step), nodeDetails: details,
    graph: structuredClone(bindings.route)
  }] };
  if (!isFunctionNarrativePage(page)) throw new FunctionNarrativeError("invalid-response"); return page;
}
