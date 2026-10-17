/** Independent schema-authored CPU call wire replies; no source expression, inverse encoder, teacher or model is executed. */
import { expandNativeSchema } from "../../llm/nativeNarrativeCodec";
import type { FunctionNarrativeCallRequest, FunctionNarrativeModelResponse } from "../../application/functionNarratives";

/** Author only the raw wire fields requested by the public schema; source constants remain explicit schema metadata. */
export function completeNativeCallReply(request: FunctionNarrativeCallRequest, ordinal = 0): FunctionNarrativeModelResponse {
  const schema = expandNativeSchema(request.schema) as Record<string, any>, holder: Record<string, any> = {};
  const work = [{ rule: schema, owner: holder, key: "value", depth: 0 }]; let nodes = 0;
  while (work.length) {
    const { rule, owner, key, depth } = work.pop()!;
    if (++nodes > 100000 || depth > 128) throw new Error("CPU call fixture schema budget exceeded");
    if (Object.hasOwn(rule, "const")) { owner[key] = structuredClone(rule.const); continue; }
    if (rule.enum) { owner[key] = structuredClone(rule.enum[0]); continue; }
    if (rule.anyOf || rule.oneOf) { work.push({ rule: (rule.anyOf ?? rule.oneOf)[0], owner, key, depth: depth + 1 }); continue; }
    if (rule.type === "object") {
      const value: Record<string, any> = {}; owner[key] = value;
      for (const name of rule.required ?? []) work.push({ rule: rule.properties[name], owner: value, key: name, depth: depth + 1 });
    } else if (rule.type === "array") {
      const value: any[] = []; owner[key] = value;
      for (let index = 0; index < (rule.minItems ?? 0); index++) work.push({ rule: Array.isArray(rule.items) ? rule.items[index] : rule.items, owner: value, key: String(index), depth: depth + 1 });
    } else if (rule.type === "string") owner[key] = String(rule.pattern ?? "").includes("가-힣")
      ? `명시적인 CPU fixture ${ordinal} ${key} 문장은 실제 신경망이나 원문 실행의 정확도를 증명하지 않으며 원래 전체 문장을 그대로 보존합니다.`
      : `CPU fixture packet ${ordinal} ${key} retains this entire independent model prose with literal <text> and 😀; it proves no source execution.`;
    else if (rule.type === "boolean") owner[key] = false;
    else if (rule.type === "null") owner[key] = null;
    else if (rule.type === "integer" || rule.type === "number") owner[key] = rule.minimum ?? 0;
    else throw new Error("Unsupported CPU call fixture schema");
  }
  return { modelName: "Explicit complete native CPU fixture", text: JSON.stringify(holder.value) };
}
