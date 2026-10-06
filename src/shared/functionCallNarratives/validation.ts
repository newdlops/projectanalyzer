/** Portable response validation for model text and browser page delivery; this does not verify prose semantics. */
import type { FunctionCallNarrativeChunk } from "./types";
export function isFunctionCallNarrativeChunk(value: unknown, ids?: readonly string[], includeSummary?: boolean): value is FunctionCallNarrativeChunk {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const prose = (text: unknown, limit: number) => typeof text === "string" && text.trim().length > 0 && text.length <= limit && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/u.test(text);
  if (Object.keys(record).some(key => !["summary", "flow", "calls", "limitations"].includes(key))
    || (includeSummary === true || record.summary !== undefined) && !prose(record.summary, 240)
    || (includeSummary === true || record.flow !== undefined) && !prose(record.flow, 600)
    || includeSummary === false && (record.summary !== undefined || record.flow !== undefined)
    || !Array.isArray(record.calls) || record.calls.length > 2 || ids && record.calls.length !== ids.length
    || !Array.isArray(record.limitations) || record.limitations.length > 2 || !record.limitations.every(text => prose(text, 180))) return false;
  return record.calls.every((call, index) => {
    if (!call || typeof call !== "object" || Array.isArray(call)) return false;
    return Object.keys(call).length === 6 && typeof call.callId === "string" && /^call-[1-9][0-9]{0,2}$/u.test(call.callId)
      && (!ids || call.callId === ids[index]) && prose(call.role, 160) && prose(call.inputs, 180)
      && prose(call.output, 180) && prose(call.effects, 180) && prose(call.reason, 180);
  });
}
/** Rejects mismatched prose scripts while allowing quoted identifiers and source literals. */
export function isFunctionCallNarrativeLanguage(chunk: FunctionCallNarrativeChunk, language: "ko" | "en"): boolean {
  const descriptions = [chunk.summary, chunk.flow, ...chunk.limitations,
    ...chunk.calls.flatMap(call => [call.role, call.inputs, call.output, call.effects, call.reason])].filter((text): text is string => text !== undefined);
  return descriptions.every(text => {
    const prose = text.replace(/`[^`]*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, " ");
    return language === "ko" ? (prose.match(/[가-힣]/gu)?.length ?? 0) >= 2 : /[A-Za-z]/u.test(prose) && !/[가-힣]/u.test(prose);
  });
}
