/** Bounded producer-to-JSON materialization: preserve source aliases by value, omit only declared optional absence, and reject capabilities/cycles before reading them. */
import { FunctionNarrativeError } from "../../../shared/functionNarratives";
import { putCodec, requireCodec, sameCodec } from "../data";

// Host-only occurrence bindings are included here; the serialized model source and complete packet keep their separate original 196608 limits.
const MAX_SOURCE_CHARACTERS = 1048576;
const optional = new Set([
  "sourceEvidence", "groundingLimited", "returnTypeText", "valueNames", "valueFacts", "scenarioBatch", "nodePreparation",
  "parameters.*.type", "sourceFlow.paths.*.reason", "sourceFlow.paths.*.graph",
  ...["graphNodeId", "graphOccurrence", "loweredPredicate", "writeTargets", "branch"].map(key => "sourceFlow.paths.*.steps.*." + key),
  "sourceFlow.paths.*.steps.*.branch.inputCondition"
]);
type Frame = { value: unknown; holder: object; key: string | number; path: string[]; depth: number; exit?: boolean };

/** Materialize every expanded path iteratively. A shared producer node may recur after its earlier visit leaves the active ancestor set. */
export function copyRootSource<T>(input: T): T {
  const holder = { value: undefined as unknown }, pending: Frame[] = [{ value: input, holder, key: "value", path: [], depth: 0 }];
  const active = new Set<object>(), visited = new Set<object>(); let count = 0, characters = 0;
  const charge = (amount: number) => { characters += amount; if (characters > MAX_SOURCE_CHARACTERS) throw new FunctionNarrativeError("context-too-large", "native-root-source-budget"); };
  while (pending.length) {
    const row = pending.pop()!, value = row.value;
    if (row.exit) { active.delete(value as object); continue; }
    if (++count > 100000 || row.depth > 128) throw new FunctionNarrativeError("context-too-large", "native-root-source-budget");
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      if (typeof value === "number") requireCodec(Number.isFinite(value) && !Object.is(value, -0), "native-root-source-number");
      charge(JSON.stringify(value).length); putCodec(row.holder, row.key, value); continue;
    }
    if (typeof value === "string") { requireCodec(value.length <= MAX_SOURCE_CHARACTERS, "native-root-source-string"); charge(JSON.stringify(value).length); putCodec(row.holder, row.key, value); continue; }
    requireCodec(value && typeof value === "object", "native-root-source-data");
    requireCodec(!active.has(value), "native-root-source-cycle"); active.add(value); visited.add(value); requireCodec(visited.size <= 100000);
    const array = Array.isArray(value); requireCodec(array ? Object.getPrototypeOf(value) === Array.prototype : [null, Object.prototype].includes(Object.getPrototypeOf(value)), "native-root-source-prototype");
    if (array && value.length > 100000) throw new FunctionNarrativeError("context-too-large", "native-root-source-budget");
    requireCodec(Object.getOwnPropertySymbols(value).length === 0, "native-root-source-capability");
    const keys = Object.getOwnPropertyNames(value).filter(key => !array || key !== "length");
    if (array) sameCodec(keys, Array.from({ length: value.length }, (_, index) => String(index)), "native-root-source-array");
    const result: any = array ? [] : {}; putCodec(row.holder, row.key, result); charge(2); pending.push({ ...row, exit: true });
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index], descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      requireCodec(key.length <= MAX_SOURCE_CHARACTERS, "native-root-source-key");
      requireCodec(Object.hasOwn(descriptor, "value") && descriptor.enumerable, "native-root-source-accessor");
      const path = [...row.path, array ? "*" : key];
      if (descriptor.value === undefined && optional.has(path.join("."))) continue;
      charge(array ? 1 : JSON.stringify(key).length + 2);
      pending.push({ value: descriptor.value, holder: result, key, path, depth: row.depth + 1 });
    }
  }
  // Reverse pushes above preserve ordinary key order, including source strings and prototype-named literal keys.
  return holder.value as T;
}
