/** Adapts the shared Python checker to the Tutor's typed input-quality and observation contracts. */
import { createPythonRegexRuntime, createPythonScenarioRuntime, type PythonValue } from "../../../shared/pythonScenario";
import type { FunctionTutorDeclarationAnalysis, FunctionTutorStaticValue as Value } from "../types";
import type { FunctionTutorDecisionObservation, FunctionTutorInputAssignment, FunctionTutorInputEvaluation } from "./types";

const runtime = createPythonScenarioRuntime(createPythonRegexRuntime());

/** Converts JSON-only input data and preserves partial results instead of executing unsupported Python. */
export function evaluatePythonTutorInputs(declaration: FunctionTutorDeclarationAnalysis, inputs: readonly FunctionTutorInputAssignment[], options: { maxSteps?: number; maxLoopVisits?: number; observeDecision?: (value: FunctionTutorDecisionObservation) => void }): FunctionTutorInputEvaluation {
  const program = declaration.program.python!; const values = new Map<string, PythonValue>();
  for (const parameter of declaration.parameters) {
    const input = inputs.find((item) => item.parameterId === parameter.id);
    const value = input?.omitted ? parameter.defaultValue : input?.value;
    if (!value) continue;
    try {
      const raw = JSON.parse(JSON.stringify(value, (_key, item) => {
        if (!item || typeof item !== "object" || !item.kind) return item;
        if (["boolean", "string", "number"].includes(item.kind)) return item.value;
        if (item.kind === "null") return null;
        if (item.kind === "array" && !item.truncated) return item.items;
        throw new Error("unknown-input");
      }));
      values.set(parameter.name, raw);
    } catch { /* Missing/unsupported inputs stop inside the checker with an explicit reason. */ }
  }
  // Tutor steps count source blocks; Python bytecode has several primitive operations per block.
  const result = runtime.evaluate(program, values, { maxSteps: Math.min(8192, (options.maxSteps ?? 128) * 64), maxLoopVisits: options.maxLoopVisits ?? 32 });
  for (const observation of result.observations) options.observeDecision?.({ ...observation, metric: observation.metric ?? "numeric",
    leftValue: observation.leftValue === undefined ? undefined : pythonTutorValue(observation.leftValue),
    rightValue: observation.rightValue === undefined ? undefined : pythonTutorValue(observation.rightValue) });
  return { status: result.status, reason: result.reason, blockIds: result.blockIds, edgeIds: result.edgeIds, decisions: result.decisions,
    terminal: result.terminal ? { ...result.terminal, value: pythonTutorValue(result.terminal.value) } : undefined };
}

/** Iteratively wraps bounded Python JSON values in the public static-value contract. */
export function pythonTutorValue(value: PythonValue): Value {
  let root: Value = { kind: "null" };
  const queue: Array<{ value: PythonValue; set(value: Value): void }> = [{ value, set: (item) => { root = item; } }];
  for (let i = 0; i < queue.length && i < 512; i += 1) {
    const item = queue[i];
    if (Array.isArray(item.value)) { const array: Value & { kind: "array" } = { kind: "array", items: [], truncated: false }; item.set(array); queue.push(...item.value.map((child, index) => ({ value: child, set: (next: Value) => { array.items[index] = next; } }))); }
    else if (item.value === null) item.set({ kind: "null" });
    else if (typeof item.value === "boolean") item.set({ kind: "boolean", value: item.value });
    else if (typeof item.value === "number") item.set({ kind: "number", value: item.value });
    else item.set({ kind: "string", value: item.value });
  }
  return root;
}
