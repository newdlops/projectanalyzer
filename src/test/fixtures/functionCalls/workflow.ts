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

function nestedCalls() { return notify(isReady(1) ? persist(audit(1)) : reject("invalid")); }
function repeatDecision(enabled: boolean) {
  if (enabled) persist(1);
  audit(2);
  if (enabled) notify(3);
  return finish();
}
function loopControl(items: number[]) {
  for (const item of items) {
    if (!isReady(item)) continue;
    persist(item);
    if (item > 10) break;
    notify(item);
  }
  return finish();
}
function loadItems() { return [1, 2]; }
function iteratorCalls() { for (const item of loadItems()) persist(item); return finish(); }
function conditionLoop() { let item = 1; while (isReady(item)) { persist(item); item += 1; } return finish(); }
function cleanup(enabled: boolean) { try { if (enabled) return persist(1); return reject("invalid"); } finally { audit(2); } }
function delayed(button: EventTarget) { button.addEventListener("click", handleClick); audit(0); }
function handleClick() { persist(1); }
function nestedCleanup() { try { try { return persist(1); } finally { audit(2); } } finally { notify(3); } }
function overrideCleanup() { try { return persist(1); } finally { return notify(2); } }
function caughtThrow() { try { throw reject("invalid"); } catch { audit(1); } finish(); }
function throwCleanup() { try { throw reject("invalid"); } finally { audit(2); } }
function loopCleanup(items: number[]) {
  for (const item of items) {
    try { if (!isReady(item)) continue; persist(item); break; }
    finally { audit(item); }
  }
  return finish();
}
