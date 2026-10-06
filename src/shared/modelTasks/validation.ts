/** Small portable lifecycle validation shared by the native scheduler and CSP-safe Webviews. */
import type { ModelTaskProgress } from "./types";
export function isModelTaskProgress(value: unknown): value is ModelTaskProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const count = (number: unknown) => Number.isSafeInteger(number) && (number as number) >= 0 && (number as number) <= 32;
  return Object.keys(item).every(key => ["id", "kind", "phase", "position", "waiting"].includes(key))
    && typeof item.id === "string" && /^model-task:[1-9][0-9]{0,15}$/u.test(item.id)
    && typeof item.kind === "string" && ["prepare", "inference"].includes(item.kind)
    && typeof item.phase === "string" && ["queued", "preparing", "running", "cancelling"].includes(item.phase)
    && count(item.position) && count(item.waiting) && (item.position as number) <= (item.waiting as number)
    && (item.phase === "queued" ? (item.position as number) > 0 : item.position === 0);
}
