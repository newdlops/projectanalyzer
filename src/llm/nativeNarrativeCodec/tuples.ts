/** Bijection between complete mandatory named objects and field-order arrays; opaque domains retain every original constraint. */
import { ARRAY_KEYS, OBJECT_KEYS, copyCodec, MAX_NATIVE_CHARACTERS, putCodec, requireCodec, type DataPath, type Schema } from "./data";
import { codecValidator, compileCodec, validateCodec } from "./validation";
import type { NativeNarrativeSchema, NativeObjectTupleWire } from "./types";

type Node = { original: Schema; path: DataPath; kind?: "object" | "array" | "opaque"; names?: string[]; children?: Node[]; homogeneous?: boolean; output?: Schema };

/** Transform only closed objects with every property required; source literal const/enum data is never traversed. */
export function createNativeObjectTupleWire(original: NativeNarrativeSchema): NativeObjectTupleWire {
  const schema = copyCodec(original) as Schema, root: Node = { original: schema, path: [] }, pending = [{ node: root, leave: false }], seen = new Set<Schema>();
  let objects = 0, leaves = 0;
  while (pending.length) {
    const { node, leave } = pending.pop()!, current = node.original;
    if (leave) {
      if (node.kind === "object") {
        const metadata: Schema = Object.fromEntries(["description", "title", "$comment"].filter(key => Object.hasOwn(current, key)).map(key => [key, current[key]]));
        metadata.description = (metadata.description ? metadata.description + " " : "") + "Object fields in order: " + JSON.stringify(node.names) + ".";
        // Draft-07 rejects items: []; const: [] expresses the same complete empty tuple and is native-grammar compatible.
        node.output = node.children!.length ? { type: "array", items: node.children!.map(child => child.output), minItems: node.children!.length, maxItems: node.children!.length, additionalItems: false, ...metadata }
          : { const: [], ...metadata };
      } else node.output = { ...current, items: node.homogeneous ? node.children![0].output : node.children!.map(child => child.output) };
      continue;
    }
    requireCodec(current && typeof current === "object" && !Array.isArray(current) && !seen.has(current)); seen.add(current); requireCodec(seen.size <= 100000 && node.path.length <= 128);
    const names = current.properties ? Object.keys(current.properties) : [];
    if (current.type === "object" && current.additionalProperties === false && Array.isArray(current.required) && current.required.length === names.length
      && new Set(current.required).size === names.length && current.required.every((name: string) => Object.hasOwn(current.properties, name)) && Object.keys(current).every(key => OBJECT_KEYS.has(key))) {
      node.kind = "object"; node.names = names; node.children = names.map(name => ({ original: current.properties[name], path: [...node.path, name] })); objects++;
    } else if (current.type === "array" && current.items && typeof current.items === "object" && Object.keys(current).every(key => ARRAY_KEYS.has(key))) {
      node.kind = "array"; node.homogeneous = !Array.isArray(current.items); const children: Schema[] = node.homogeneous ? [current.items] : current.items;
      node.children = children.map((child, index) => ({ original: child, path: [...node.path, node.homogeneous ? "*" : index] }));
    } else { node.kind = "opaque"; node.output = current; leaves++; continue; }
    pending.push({ node, leave: true }); for (let index = node.children.length - 1; index >= 0; index--) pending.push({ node: node.children[index], leave: false });
  }
  const validation = codecValidator(), originalValid = compileCodec(schema, validation), wireValid = compileCodec(root.output!);

  /** Move cells in the original schema order and validate both domains without normalizing a model value. */
  function convert(input: unknown, encode: boolean): unknown {
    const value = copyCodec(input, MAX_NATIVE_CHARACTERS); validateCodec(encode ? originalValid : wireValid, value);
    const holder: Schema = {}, stack: Array<{ node: Node; value: any; parent: object; key: string | number; depth: number }> = [{ node: root, value, parent: holder, key: "value", depth: 0 }]; let count = 0;
    while (stack.length) {
      const row = stack.pop()!, { node } = row; requireCodec(++count <= 100000 && row.depth <= 128); let output: any;
      if (node.kind === "opaque") output = row.value;
      else if (node.kind === "array") {
        requireCodec(Array.isArray(row.value)); output = new Array(row.value.length);
        for (let index = row.value.length - 1; index >= 0; index--) stack.push({ node: node.children![node.homogeneous ? 0 : index], value: row.value[index], parent: output, key: index, depth: row.depth + 1 });
      } else {
        output = encode ? new Array(node.names!.length) : {};
        for (let index = node.names!.length - 1; index >= 0; index--) stack.push({ node: node.children![index], value: row.value[encode ? node.names![index] : index], parent: output, key: encode ? index : node.names![index], depth: row.depth + 1 });
      }
      putCodec(row.parent, row.key, output);
    }
    validateCodec(encode ? wireValid : originalValid, holder.value); return copyCodec(holder.value, MAX_NATIVE_CHARACTERS);
  }
  return { schema: root.output!, transformedClosedObjects: objects, unchangedIndependentLeaves: leaves, encode: value => convert(value, true), decode: value => convert(value, false) };
}
