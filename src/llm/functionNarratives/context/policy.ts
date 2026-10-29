/** Pure admission policy: reserve response tokens, respect model/configuration ceilings and keep memory headroom. */
import { FunctionNarrativeError } from "../../../shared/functionNarratives";
import type { LocalNarrativeContextOptions, LocalNarrativeContextSettings, LocalNarrativeMemory } from "./types";

export const LOCAL_NARRATIVE_BASE_CONTEXT = 8192;
export const LOCAL_NARRATIVE_OUTPUT_TOKENS = 2400;
const TOKEN_MARGIN = 256;
const CONTEXT_STEP = 1024;
// This is an allocation estimate, not measured RSS: allow 256 KiB/token for
// cache/compute growth and 512 MiB for the runner/cache outside the weights.
// Post-load observations still enforce the reserve if this estimate is wrong.
const BYTES_PER_CONTEXT_TOKEN = 256 * 1024;
const RUNNER_BYTES = 512 * 1024 * 1024;

/** Invalid settings use defaults; finite values are clamped before they reach an executable argument. */
export function localNarrativeContextSettings(options: LocalNarrativeContextOptions = {}): LocalNarrativeContextSettings {
  const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return { maxContextTokens: Math.floor(Math.max(8192, Math.min(131072, finite(options.maxContextTokens, 32768))) / CONTEXT_STEP) * CONTEXT_STEP,
    memoryReservePercent: Math.max(20, Math.min(30, finite(options.memoryReservePercent, 25))) };
}

/** A byte-based upper estimate is used only where a legacy CLI has no tokenizer endpoint. */
export function estimateLocalNarrativePromptTokens(prompt: string, system: string): number {
  return Buffer.byteLength(prompt, "utf8") + Buffer.byteLength(system, "utf8") + 256;
}

/** Reject missing/invalid observations rather than allowing an unmeasured memory allocation. */
export function assertLocalNarrativeMemory(memory: LocalNarrativeMemory, settings: LocalNarrativeContextSettings): void {
  if (!Number.isFinite(memory.totalBytes) || !Number.isFinite(memory.availableBytes) || memory.totalBytes <= 0
    || memory.availableBytes < 0 || memory.availableBytes > memory.totalBytes) {
    throw new FunctionNarrativeError("memory-pressure", "memory-observation");
  }
  if (memory.availableBytes < memory.totalBytes * settings.memoryReservePercent / 100) {
    throw new FunctionNarrativeError("memory-pressure", "memory-reserve");
  }
}

/** Select the smallest tier that fits; when headroom is tight, use an aligned smaller allocation instead of discarding source. */
export function selectLocalNarrativeContext(input: {
  promptTokens: number; settings: LocalNarrativeContextSettings; memory: LocalNarrativeMemory;
  /** A warm server already owns these tokens and its weights; only additional allocation is charged. */
  residentTokens?: number;
  modelBytes?: number;
  modelContextTokens?: number;
}): number {
  const { settings, memory } = input;
  const nativeLimit = Number.isSafeInteger(input.modelContextTokens) && input.modelContextTokens! > 0 ? input.modelContextTokens! : settings.maxContextTokens;
  const ceiling = Math.min(settings.maxContextTokens, nativeLimit);
  if (!Number.isSafeInteger(input.promptTokens) || input.promptTokens < 0) throw new FunctionNarrativeError("failed", "runner-tokenization");
  const required = input.promptTokens + LOCAL_NARRATIVE_OUTPUT_TOKENS + TOKEN_MARGIN;
  if (required > ceiling) throw new FunctionNarrativeError("context-too-large",
    nativeLimit < settings.maxContextTokens ? "model-context-limit" : "configured-context-limit");
  assertLocalNarrativeMemory(memory, settings);
  const resident = input.residentTokens ?? 0;
  if (resident >= required && resident <= ceiling) return resident;
  const baseline = Math.min(LOCAL_NARRATIVE_BASE_CONTEXT, ceiling);
  const minimum = Math.min(ceiling, Math.max(baseline, Math.ceil(required / CONTEXT_STEP) * CONTEXT_STEP));
  let preferred = baseline;
  while (preferred < minimum) preferred = Math.min(ceiling, preferred * 2);
  const budget = memory.availableBytes - memory.totalBytes * settings.memoryReservePercent / 100;
  const overhead = resident ? 0 : Math.max(0, input.modelBytes ?? 0) + RUNNER_BYTES;
  const affordable = resident + Math.floor(Math.max(0, budget - overhead) / BYTES_PER_CONTEXT_TOKEN / CONTEXT_STEP) * CONTEXT_STEP;
  if (budget < overhead || affordable < minimum) throw new FunctionNarrativeError("memory-pressure", "context-memory-budget");
  return preferred <= affordable ? preferred : minimum;
}
