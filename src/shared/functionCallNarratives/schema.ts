/** Fixed model call slots bound output to source-issued facts without trusting generated graph identities. */
import type { FunctionCallNarrativeTask } from "./types";
import { getFunctionCallFixedInputs } from "./fixedInputs";
export function createFunctionCallNarrativeSchema(task: FunctionCallNarrativeTask, language: "ko" | "en"): Record<string, unknown> {
  const prose = (limit: number) => ({ type: "string", minLength: 1, maxLength: limit,
    ...(language === "ko" ? { pattern: `^[가-힣][^"\\\\\\x00-\\x1F]{0,${limit - 1}}$` } : {}) });
  const fields = ["callId", "role", "inputs", "output", "effects", "reason"];
  return { type: "object", additionalProperties: false,
    required: [...(task.includeSummary ? ["summary", "flow"] : []), "calls", "limitations"], properties: {
      ...(task.includeSummary ? { summary: prose(240), flow: prose(600) } : {}),
      calls: { type: "array", minItems: task.targets.length, maxItems: task.targets.length,
        items: task.targets.length ? task.targets.map(target => ({ type: "object", additionalProperties: false, required: fields,
          properties: { callId: { const: target.callId }, role: prose(160), inputs: getFunctionCallFixedInputs(target,language)?{const:getFunctionCallFixedInputs(target,language)}:prose(180), output: prose(180), effects: prose(180), reason: prose(180) }
        })) : { type: "object" } },
      limitations: { type: "array", maxItems: 2, items: prose(180) }
    } };
}
