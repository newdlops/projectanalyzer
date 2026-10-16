/** Exact source-constant omission and restoration; variable names, order, cardinalities and model-owned leaves remain independent. */
import { ARRAY_KEYS, OBJECT_KEYS, copyCodec, MAX_NATIVE_CHARACTERS, putCodec, requireCodec, sameCodec, parseCodec, type DataPath, type Schema } from "./data";
import { codecValidator, compileCodec, validateCodec } from "./validation";
import type { NativeNamedWire, NativeNamedWireOptions, NativeNarrativeSchema } from "./types";

type Node = { original: Schema; path: DataPath; kind?: "constant" | "object" | "array" | "opaque";
  names?: string[]; children?: Node[]; homogeneous?: boolean; constant?: unknown; output?: Schema };
const CONSTANT_KEYS = new Set(["const", "description", "title", "$comment"]);
const clone = <T>(value: T, maximum = 196608) => copyCodec(value, maximum, 20000, 64);

/** Optional objects, unions/references and schemas with extra constraints remain opaque, preserving all their original rules. */
export function createNativeNamedWire(original: NativeNarrativeSchema, options?: NativeNamedWireOptions): NativeNamedWire {
  const schema = clone(original) as Schema, root: Node = { original: schema, path: [] }, pending = [{ node: root, leave: false }], visited = new Set<Schema>();
  let variableLeaves = 0, omittedSingleValues = 0;
  const modelValues = new Set(options?.modelValuePaths ?? []);
  while (pending.length) {
    const { node, leave } = pending.pop()!, current = node.original;
    if (leave) {
      if (node.kind === "object") {
        const properties: Schema = {};
        for (const [index, name] of node.names!.entries()) if (node.children![index].kind !== "constant") putCodec(properties, name, node.children![index].output);
        const names = Object.keys(properties); node.output = { ...current, properties, required: current.required.filter((name: string) => names.includes(name)) };
        if (!names.length) { node.kind = "constant"; node.constant = Object.fromEntries(node.names!.map((name, index) => [name, node.children![index].constant])); node.output = { const: node.constant }; omittedSingleValues++; }
      } else if (node.kind === "array") {
        if (!node.homogeneous && node.children!.every(child => child.kind === "constant") && current.minItems === node.children!.length && current.maxItems === node.children!.length) {
          node.kind = "constant"; node.constant = node.children!.map(child => child.constant); node.output = { const: node.constant }; omittedSingleValues++;
        } else node.output = { ...current, items: node.homogeneous ? node.children![0].output : node.children!.map(child => child.output) };
      }
      continue;
    }
    requireCodec(current && typeof current === "object" && !Array.isArray(current) && !visited.has(current)); visited.add(current);
    requireCodec(visited.size <= 20000 && node.path.length <= 64, "native-codec-budget");
    const path = "$" + node.path.map(part => typeof part === "number" || part === "*" ? "[" + part + "]" : "." + part).join("");
    // A calculated singleton/empty object must still be supplied by the model.
    // Preserve its entire domain so no inner field can be filled from metadata before the raw guard.
    if (modelValues.has(path)) { requireCodec(!Object.hasOwn(current, "const") && !(current.enum?.length === 1), "native-codec-fixed-calculation"); node.kind = "opaque"; node.output = current; variableLeaves++; continue; }
    if (Object.hasOwn(current, "const") && Object.keys(current).every(key => CONSTANT_KEYS.has(key))) { node.kind = "constant"; node.constant = current.const; node.output = current; omittedSingleValues++; continue; }
    const properties = current.properties, names = properties ? Object.keys(properties) : [];
    if (current.type === "object" && properties && typeof properties === "object" && !Array.isArray(properties) && current.additionalProperties === false
      && Array.isArray(current.required) && current.required.length === names.length && new Set(current.required).size === names.length
      && current.required.every((name: string) => Object.hasOwn(properties, name)) && Object.keys(current).every(key => OBJECT_KEYS.has(key))) {
      node.kind = "object"; node.names = names; node.children = names.map(name => ({ original: properties[name], path: [...node.path, name] }));
    } else if (current.type === "array" && current.items && typeof current.items === "object" && Object.keys(current).every(key => ARRAY_KEYS.has(key))) {
      node.kind = "array"; node.homogeneous = !Array.isArray(current.items); const children: Schema[] = node.homogeneous ? [current.items] : current.items;
      requireCodec(children.length <= 900); node.children = children.map((child, index) => ({ original: child, path: [...node.path, node.homogeneous ? "*" : index] }));
    } else { node.kind = "opaque"; node.output = current; variableLeaves++; continue; }
    pending.push({ node, leave: true }); for (let index = node.children.length - 1; index >= 0; index--) pending.push({ node: node.children[index], leave: false });
  }
  requireCodec(variableLeaves > 0, "native-codec-no-model-fields");
  const validation = codecValidator(), originalValid = compileCodec(schema, validation), wireValid = compileCodec(root.output!);

  /** Reorder complete fields and restore source metadata only after validating all original independent model leaves. */
  function convert(input: unknown, encode: boolean): string {
    const value = clone(input, MAX_NATIVE_CHARACTERS); validateCodec(encode ? originalValid : wireValid, value);
    const holder: Schema = {}, queue: Array<{ node: Node; value: any; parent: object; key: string | number; depth: number }> = [{ node: root, value, parent: holder, key: "value", depth: 0 }]; let count = 0;
    while (queue.length) {
      const row = queue.pop()!, { node } = row; requireCodec(++count <= 20000 && row.depth <= 64, "native-codec-budget"); let output: any;
      if (node.kind === "constant") { if (encode) sameCodec(row.value, node.constant); output = clone(node.constant, MAX_NATIVE_CHARACTERS); }
      else if (node.kind === "opaque") output = row.value;
      else if (node.kind === "array") {
        requireCodec(Array.isArray(row.value) && row.value.length <= 900 && row.value.length >= (node.original.minItems ?? 0) && row.value.length <= (node.original.maxItems ?? 900));
        if (!node.homogeneous) requireCodec(row.value.length <= node.children!.length); output = new Array(row.value.length);
        for (let index = row.value.length - 1; index >= 0; index--) queue.push({ node: node.children![node.homogeneous ? 0 : index], value: row.value[index], parent: output, key: index, depth: row.depth + 1 });
      } else {
        requireCodec(row.value && typeof row.value === "object" && !Array.isArray(row.value));
        const names = encode ? node.names! : node.names!.filter((_name, index) => node.children![index].kind !== "constant"); sameCodec(Object.keys(row.value).sort(), [...names].sort()); output = {};
        for (const name of node.names!) putCodec(output, name, undefined);
        for (let index = node.names!.length - 1; index >= 0; index--) {
          const name = node.names![index], child = node.children![index];
          if (child.kind === "constant" && encode) { sameCodec(row.value[name], child.constant); delete output[name]; continue; }
          queue.push({ node: child, value: child.kind === "constant" ? child.constant : row.value[name], parent: output, key: name, depth: row.depth + 1 });
        }
      }
      putCodec(row.parent, row.key, output);
    }
    validateCodec(encode ? wireValid : originalValid, holder.value);
    const text = JSON.stringify(holder.value); requireCodec(text.length <= MAX_NATIVE_CHARACTERS, "native-codec-output-limit"); return text;
  }
  return { schema: clone(root.output!), variableLeaves, omittedSingleValues,
    encode: value => convert(value, true), decode: raw => JSON.parse(convert(parseCodec(raw), false)) };
}
