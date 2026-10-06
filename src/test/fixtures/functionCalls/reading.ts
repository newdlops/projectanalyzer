/** Cross-file source example for static and model-assisted call reading. */
import { addFee, double } from "./readingHelpers";
export function checkout(enabled: boolean, amount: number): number {
  if (!enabled) return zero();
  const adjusted = addFee(amount);
  return double(adjusted);
}
export function zero(): number { return 0; }
