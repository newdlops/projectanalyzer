/** Explicit CPU-only native fixtures. No subject source executes and no completion is used as neural correctness or timing evidence. */
import { expandNativeSchema, createNativeRootSource, createNativeRootCodec, type NativeRootSourceContext, type NativeNarrativeMode } from "../../llm/nativeNarrativeCodec";
import { createCompleteFunctionNarrativeRoot, type FunctionNarrativeRootRequest, type FunctionNarrativeModelResponse } from "../../application/functionNarratives";
import { nativeRootSourceFixture, nativeRootSourceReading, nativeRootUnavailableReading } from "./nativeNarrativeRootSource";

/** Public page identities match the real browser/Host contract; the source fixture itself remains unchanged. */
export function completeNativeSourceFixture(loop = false): NativeRootSourceContext {
  const context = nativeRootSourceFixture(loop), path = context.sourceFlow.paths[0];
  const nodeId = (index: number) => "function-logic-block:" + String(index + 1).padStart(32, "0");
  path.steps.forEach((step, index) => { step.graphNodeId = nodeId(index); });
  path.graph = { nodeIds: path.steps.map(step => step.graphNodeId!), edgeIds: path.steps.slice(1).map((_, index) => "function-logic-edge:" + String(index + 1).padStart(32, "0")) };
  return context;
}

/** Author a raw unverified fixture directly against the public request schema, independently of the Host's reply projection or inverse encoder. */
export async function completeNativeUnverifiedReply(request: FunctionNarrativeRootRequest): Promise<FunctionNarrativeModelResponse> {
  const schema = expandNativeSchema(request.schema) as Record<string, any>;
  const branch = schema.anyOf.find((rule: any) => rule.properties.mode.const === "unverified");
  if (!branch) throw new Error("Fixture requires the complete unverified mode");
  const holder: Record<string, any> = {}, work = [{ rule: branch, owner: holder, key: "value", depth: 0 }], visited = new Set<object>();
  let count = 0;
  while (work.length) {
    const { rule, owner, key, depth } = work.pop()!;
    if (++count > 100000 || depth > 128) throw new Error("Fixture schema budget exceeded");
    // Shared immutable schema definitions do not share any resulting fixture JSON values. Depth and expanded-node budgets bound this work independently.
    visited.add(rule);
    if (Object.hasOwn(rule, "const")) { owner[key] = structuredClone(rule.const); continue; }
    if (rule.enum) { owner[key] = structuredClone(rule.enum[0]); continue; }
    if (rule.anyOf || rule.oneOf) { work.push({ rule: (rule.anyOf ?? rule.oneOf)[0], owner, key, depth: depth + 1 }); continue; }
    if (rule.type === "object") {
      const value: Record<string, any> = {}; owner[key] = value;
      for (const name of rule.required ?? []) work.push({ rule: rule.properties[name], owner: value, key: name, depth: depth + 1 });
    } else if (rule.type === "array") {
      const value: any[] = []; owner[key] = value; const length = rule.minItems ?? 0;
      for (let index = 0; index < length; index++) work.push({ rule: Array.isArray(rule.items) ? rule.items[index] : rule.items, owner: value, key: String(index), depth: depth + 1 });
    } else if (rule.type === "string") owner[key] = "Source evidence remains unverified in this explicit CPU fixture.";
    else if (rule.type === "integer" || rule.type === "number") owner[key] = rule.minimum ?? 0;
    else if (rule.type === "boolean") owner[key] = false;
    else if (rule.type === "null") owner[key] = null;
    else throw new Error("Fixture encountered an unsupported schema");
  }
  if (!visited.size) throw new Error("Fixture schema was empty");
  return { modelName: "Explicit complete native CPU fixture", text: JSON.stringify(holder.value) };
}

/** Browser tests receive a real independently decoded portable page, with explicit authored prose and mode values. */
export function completeNativePageFixture(mode: NativeNarrativeMode = "unverified", withLoop = mode === "loop-visit") {
  const context = completeNativeSourceFixture(withLoop), source = createNativeRootSource({ context, locale: "en" });
  const original = nativeRootSourceReading(context), symbolic = mode === "source-infeasible" || mode === "unverified";
  const reading = symbolic ? nativeRootUnavailableReading(original, source.codec.readingSchema, "This full model reason remains unavailable with <script>literal text</script> and no concrete value.") : original;
  const raw = createNativeRootCodec(source.codec).encode({ mode, reading, justification: "The model retains this complete applicability reason without claiming observed execution.",
    ...(mode === "loop-visit" ? { loopVisits: [{ sourceOperationOrdinal: 1, visit: 3, earlierIterations: 2, meaning: "The third selected visit follows two earlier iterations in this explicit fixture." }] } : {}) });
  return { context, page: createCompleteFunctionNarrativeRoot(context, "en").decode(raw) };
}
