/** Narrative grounding fixture: a fixed addition must not become a percentage discount. */
export function computeTotal(amount: number, enabled: boolean): number {
  const base = Math.max(0, amount);
  if (!enabled) return 0;
  const fee = base > 100 ? 5 : 0;
  const total = base + fee;
  return total;
}
