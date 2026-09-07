async function chooseAsync(value) { return value; }
function* steps(value) { yield value; return value + 1; }
const objectRunner = { run(value) { return value; } };
class Counter { ready = true; constructor(seed) { this.count = seed; } enabled(value) { return this.passThrough(value) && this.count > 0; } passThrough(value) { return this.ready && value; } static pass(value) { return value; } }
export async function advancedScenario(value, present) {
  const asyncResult = await chooseAsync(value);
  const iterator = steps(asyncResult ? 2 : 4);
  const first = iterator.next();
  const counter = new Counter(first.value || 0);
  const optional = undefined?.run(asyncResult);
  const fromObject = objectRunner?.run(asyncResult);
  return optional ?? counter.enabled(Counter.pass(fromObject));
}
