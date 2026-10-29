/** Check declared JSON kinds, nested array elements and source-owned constants using bounded iterative work.
 * Portable example validation still owns total size, depth, unsafe keys and finite nested values.
 */
import { isDeepStrictEqual } from "node:util";

interface Check { value: unknown; schema: Record<string, any>; depth: number; aliases: Set<Record<string, any>>; }

/** Require one complete schema alternative, including every typed array element; never repair a value.
 * The generous work bound exceeds the portable contract's96 JSON visits even with nullable alternatives.
 */
export function matchesDeclaredValueSchema(value: unknown, schema: Record<string, any> | undefined): boolean {
  if (!schema) return false;
  const branches: Check[][] = [[{ value, schema, depth: 0, aliases: new Set() }]];
  let checks = 0;
  while (branches.length) {
    const pending = branches.pop()!;
    let failed = false, split = false;
    while (pending.length) {
      const current = pending.pop()!;
      if (++checks > 4096 || current.depth > 64 || current.aliases.has(current.schema)) return false;
      const rule = current.schema;
      if (Object.hasOwn(rule, "const")) {
        if (!isDeepStrictEqual(current.value, rule.const)) { failed = true; break; }
        continue;
      }
      if (Array.isArray(rule.anyOf)) {
        const aliases = new Set(current.aliases); aliases.add(rule);
        for (const alternative of rule.anyOf) branches.push([...pending, { ...current, schema: alternative, aliases }]);
        split = true; break;
      }
      if (!rule.type) continue; // Unknown aliases/items retain their original arbitrary JSON domain.
      if (!sameKind(current.value, rule.type)) { failed = true; break; }
      if (rule.type === "array" && rule.items && !Array.isArray(rule.items)) {
        const array = current.value as unknown[];
        for (const element of array) pending.push({ value: element, schema: rule.items, depth: current.depth + 1, aliases: new Set() });
      }
    }
    if (!failed && !split) return true;
  }
  return false;
}

/** Kind checks deliberately leave numeric ranges and illustrative execution semantics to other boundaries. */
function sameKind(value: unknown, type: unknown): boolean {
  return type === "null" && value === null || type === "boolean" && typeof value === "boolean"
    || type === "string" && typeof value === "string" || type === "number" && typeof value === "number" && Number.isFinite(value)
    || type === "integer" && typeof value === "number" && Number.isInteger(value)
    || type === "array" && Array.isArray(value) || type === "object" && value !== null && typeof value === "object" && !Array.isArray(value);
}
