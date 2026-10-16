/** Portable model-example validation: bounded literal JSON text and explicit unavailable reasons, never executable syntax. */
import type { FunctionNarrativeExample, FunctionNarrativeValue } from "./types";

export function isFunctionNarrativeExample(value: unknown): value is FunctionNarrativeExample;
export function isFunctionNarrativeExample(value: unknown, complete: true): value is FunctionNarrativeExample<FunctionNarrativeValue>;

/** Also emitted into the Webview; all helpers stay inside this function. */
export function isFunctionNarrativeExample(value: unknown, complete = false): value is FunctionNarrativeExample<FunctionNarrativeValue> {
  const record = (item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item);
  const unavailable = (item: unknown): boolean => complete && record(item) && Object.keys(item).length === 2
    && item.kind === "not-evaluated" && typeof item.reason === "string" && Boolean(item.reason.trim()) && [...item.reason].length <= 180;
  const json = (text: unknown): boolean => {
    if (unavailable(text)) return true;
    if (typeof text !== "string" || !text.trim() || text.length > (complete ? 24000 : 1200)) return false;
    let literal: unknown;
    try { literal = JSON.parse(text); } catch { return false; }
    const pending = [{ value: literal, depth: 0 }]; let count = 0;
    while (pending.length) {
      const item = pending.pop()!;
      if (++count > (complete ? 100000 : 96) || item.depth > (complete ? 256 : 6)) return false;
      if (typeof item.value === "number" && !Number.isFinite(item.value)) return false;
      if (item.value && typeof item.value === "object") {
        const entries = Object.entries(item.value);
        // Native JSON stays literal text across the portable boundary; its own keys are never merged into application objects.
        if (!complete && (entries.length > 16 || entries.some(([key]) => ["__proto__", "constructor", "prototype"].includes(key)))) return false;
        for (const [, child] of entries) pending.push({ value: child, depth: item.depth + 1 });
      }
    }
    return true;
  };
  if (!record(value) || Object.keys(value).some((key) => !["inputs", "result"].includes(key))
    || (complete ? !json(value.result) : typeof value.result !== "string" || !value.result.trim() || value.result.length > 1200)
    || !Array.isArray(value.inputs) || value.inputs.length > 32) return false;
  const seen = new Set<string>();
  for (const input of value.inputs) {
    if (!record(input) || Object.keys(input).some((key) => !["name", "json"].includes(key))
      || typeof input.name !== "string" || !input.name.trim() || input.name.length > (complete ? 24000 : 120) || seen.has(input.name)
      || !complete && ["__proto__", "constructor", "prototype"].includes(input.name) || !json(input.json)) return false;
    seen.add(input.name);
  }
  return true;
}
