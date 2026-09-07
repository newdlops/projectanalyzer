/** Source-backed bounded Scenario cases: no body here is executed by the fixture. */
async function chooseAsync(value: boolean): Promise<boolean> { return value; }
function* steps(value: number): Generator<number, number> { yield value; return value + 1; }
const objectRunner = { run(value: boolean): boolean { return value; } };

class Counter {
  count = 1;
  ready = true;
  constructor(seed: number) { this.count = seed; }
  enabled(value: boolean): boolean { return this.passThrough(value) && this.count > 0; }
  passThrough(value: boolean): boolean { return this.ready && value; }
  static pass(value: boolean): boolean { return value; }
}

export async function advancedScenario(value: boolean, _present?: { run(flag: boolean): boolean }) {
  const asyncResult = await chooseAsync(value);
  const iterator = steps(asyncResult ? 2 : 4);
  const first = iterator.next();
  const counter = new Counter(first.value ?? 0);
  const optional = (null as { run(flag: boolean): boolean } | null)?.run(asyncResult);
  const fromObject = objectRunner?.run(asyncResult);
  return optional ?? counter.enabled(Counter.pass(fromObject));
}

// These remain explicit bounded gaps: inheritance, dynamic receiver, and bare async call.
class Derived extends Counter {}
export function unsupportedAdvanced(value: boolean, receiver: { [key: string]: () => boolean }) {
  const pending = chooseAsync(value);
  return receiver[value ? "yes" : "no"]() && Boolean(pending) && new Derived(1).enabled(value);
}
