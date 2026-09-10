/** Call-mode fixture: guards, repeated sites, shared callees, callbacks and cycles. */
// @ts-nocheck -- intentionally unresolved fixture calls are never executed.
export function processBatch(items: number[], enabled: boolean) {
  if (!enabled) return reject("disabled");
  for (const item of items) {
    if (isReady(item)) {
      persist(item);
      notify(item);
    } else {
      reject("invalid");
    }
  }
  if (items.length > 4) audit(items.length);
  finish();
  return persist(items.length);
}
function isReady(item: number) { return item > 0; }
function persist(item: number) { return audit(item); }
function notify(item: number) { return audit(item); }
function reject(reason: string) { return reason; }
function audit(value: number) { return value; }
function finish() { externalTransport.send(); }
function countdown(value: number): number { return value > 0 ? countdown(value - 1) : 0; }
function cycleA() { cycleB(); }
function cycleB() { cycleA(); }
function deferred() { return () => notify(1); }
function shortCircuit(enabled: boolean) { return enabled && isReady(1); }
function finalBranchLoop(items: number[]) {
  for (const item of items) {
    if (isReady(item)) notify(item);
  }
}
function conditionalArguments(enabled: boolean, callback?: (value: boolean) => void, service?: { save(value: boolean): void }) {
  notify(enabled ? persist(1) : audit(2));
  callback?.(isReady(1));
  service?.save(isReady(2));
  return enabled || audit(0);
}
