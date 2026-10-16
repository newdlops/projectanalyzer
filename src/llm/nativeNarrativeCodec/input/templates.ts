/** Lossless source-input templates over canonical shape arrays; definitions are literal and holes never overlap or replace tags. */
import { copyInput, inputKeys, inputRecord, requireInput, sameInputJson, INPUT_DEPTH, INPUT_NODES, type InputRecord } from "./data";
import { packNativeInputShapes, unpackNativeInputShapes } from "./shapes";

/** Value paths start after each array's tag. Only caller-owned array cells can become parameters. */
function at(array: any, path: number[]): any { let node = array; for (const part of path) { requireInput(Array.isArray(node) && Number.isInteger(part) && part >= 1 && part < node.length); node = node[part]; } return node; }
function replace(array: any, path: number[], value: unknown): void { let node = array; for (const part of path.slice(0, -1)) { requireInput(Array.isArray(node) && part >= 1 && part < node.length); node = node[part]; }
  const key = path.at(-1)!; requireInput(Array.isArray(node) && key >= 1 && key < node.length); node[key] = value; }

/** Canonical grouping retains source kind/role/type/format/status discriminators, independent of targets or model responses. */
function signature(node: any[], shapes: string[][]): string {
  const root: any[] = [], pending = [{ value: node as any, parent: root, key: 0, depth: 0 }];
  while (pending.length) { const row = pending.pop()!, value = row.value; let result: any;
    if (Array.isArray(value)) { result = [value[0], value.length]; if (row.depth < 2) for (let index = value.length - 1; index >= 1; index--) pending.push({ value: value[index], parent: result, key: index + 1, depth: row.depth + 1 }); }
    else result = value === null ? "null" : typeof value; row.parent[row.key] = result;
  }
  const discriminators: unknown[] = [];
  if (node[0] > 0) for (const [index, key] of shapes[node[0] - 1].entries()) if (["kind", "role", "type", "t", "format", "status"].includes(key) && (node[index + 1] === null || typeof node[index + 1] !== "object")) discriminators.push([index + 1, node[index + 1]]);
  return JSON.stringify([root[0], discriminators]);
}

/** Find invariant literal cells and explicit independent value holes without recursively comparing JSON. */
function makeTemplate(nodes: any[][]): InputRecord | undefined {
  const paths: number[][] = [], pending = [{ values: nodes as any[], path: [] as number[] }]; let visited = 0;
  while (pending.length) { const row = pending.pop()!; requireInput(++visited <= INPUT_NODES && row.path.length <= INPUT_DEPTH); const first = row.values[0], serialized = JSON.stringify(first);
    if (row.values.every(value => JSON.stringify(value) === serialized)) continue;
    if (row.values.every(value => Array.isArray(value) && value.length === first.length && value[0] === first[0])) for (let index = first.length - 1; index >= 1; index--) pending.push({ values: row.values.map(value => value[index]), path: [...row.path, index] });
    else { requireInput(row.path.length > 0); paths.push(row.path); }
  }
  if (!paths.length) return undefined; const literal = copyInput(nodes[0]); for (const path of paths) replace(literal, path, null); return { base: literal, paths };
}

/** Parameterize repeated source structures only when the complete packet shrinks under the original character-cost rule. */
export function packNativeInputTemplates(value: unknown): InputRecord {
  const original = packNativeInputShapes(value), groups = new Map<string, any[][]>(), pending = [original.data];
  while (pending.length) { const node = pending.pop(); if (!Array.isArray(node)) continue;
    if (node[0] >= 0 && node.length >= 3) { const key = signature(node, original.shapes); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(node); }
    for (let index = node.length - 1; index >= 1; index--) if (Array.isArray(node[index])) pending.push(node[index]);
  }
  const templates: InputRecord[] = [], owned = new WeakMap<object, number>();
  for (const nodes of groups.values()) { if (nodes.length < 2) continue; const template = makeTemplate(nodes); if (!template) continue;
    const id = templates.length, rawCost = nodes.reduce((sum, node) => sum + JSON.stringify(node).length, 0), referenceCost = JSON.stringify(template).length + nodes.reduce((sum, node) => sum + JSON.stringify([-2, id, ...template.paths.map((path: number[]) => at(node, path))]).length, 0) + 16;
    if (referenceCost >= rawCost) continue; templates.push(template); for (const node of nodes) owned.set(node, id);
  }
  const holder: InputRecord = {}, stack: Array<{ value: any; parent: any; key: string | number }> = [{ value: original.data, parent: holder, key: "data" }];
  while (stack.length) { const row = stack.pop()!, node = row.value; let output: any;
    if (!Array.isArray(node)) output = node;
    else if (owned.has(node)) { const id = owned.get(node)!, parameters = templates[id].paths.map((path: number[]) => at(node, path)); output = [-2, id, ...new Array(parameters.length)]; for (let index = parameters.length - 1; index >= 0; index--) stack.push({ value: parameters[index], parent: output, key: index + 2 }); }
    else { output = new Array(node.length); for (let index = node.length - 1; index >= 0; index--) stack.push({ value: node[index], parent: output, key: index }); } row.parent[row.key] = output;
  }
  const references: any[][] = [], used = new Set<number>(), walk = [holder.data];
  while (walk.length) { const node = walk.pop(); if (!Array.isArray(node)) continue; if (node[0] === -2) { used.add(node[1]); references.push(node); } for (let index = node.length - 1; index >= 1; index--) if (Array.isArray(node[index])) walk.push(node[index]); }
  const ids = [...used].sort((a, b) => a - b), renumber = new Map(ids.map((id, index) => [id, index])); for (const reference of references) reference[1] = renumber.get(reference[1]);
  const candidate = { format: "json-template-shapes-v1", shapes: original.shapes, texts: original.texts, templates: ids.map(id => templates[id]), data: holder.data }, output = JSON.stringify(candidate).length < JSON.stringify(original).length ? candidate : original;
  sameInputJson(unpackNativeInputTemplates(output), value); return output;
}

/** Reject tag holes, duplicate/overlapping paths and definitions that could invoke another template. */
function requireTemplate(template: InputRecord): void {
  inputKeys(template, ["base", "paths"]); requireInput(Array.isArray(template.base) && template.base[0] >= 0 && Array.isArray(template.paths) && template.paths.length > 0);
  type Trie = { children: Map<number, Trie>; terminal: boolean }; const trie: Trie = { children: new Map(), terminal: false };
  for (const path of template.paths) { requireInput(Array.isArray(path) && path.length > 0 && path.length <= INPUT_DEPTH); let node = trie;
    for (const part of path) { requireInput(Number.isInteger(part) && part >= 1 && !node.terminal); if (!node.children.has(part)) node.children.set(part, { children: new Map(), terminal: false }); node = node.children.get(part)!; }
    requireInput(!node.terminal && node.children.size === 0 && at(template.base, path) === null); node.terminal = true;
  }
  const stack = [template.base]; while (stack.length) { const node = stack.pop(); if (!Array.isArray(node)) continue; requireInput(Number.isInteger(node[0]) && node[0] >= -1); for (let index = node.length - 1; index >= 1; index--) if (Array.isArray(node[index])) stack.push(node[index]); }
}

/** Expand only this packet's literal templates with bounded visits/depth before restoring the complete original shape tree. */
export function unpackNativeInputTemplates(input: unknown): unknown {
  const packet = inputRecord(input); if (packet.format === "json-shapes-v1") return unpackNativeInputShapes(packet);
  inputKeys(packet, ["format", "shapes", "texts", "templates", "data"]); requireInput(packet.format === "json-template-shapes-v1" && Array.isArray(packet.templates)); for (const template of packet.templates) requireTemplate(template);
  const holder: InputRecord = {}, stack = [{ value: packet.data, parent: holder as any, key: "data" as string | number, depth: 0 }], seen = new Set<object>(); let count = 0;
  while (stack.length) { const row = stack.pop()!; requireInput(++count <= INPUT_NODES && row.depth <= INPUT_DEPTH); let node = row.value, output: any;
    if (!Array.isArray(node)) output = node;
    else { requireInput(!seen.has(node)); seen.add(node);
      if (node[0] === -2) { const id = node[1]; requireInput(Number.isInteger(id) && id >= 0 && id < packet.templates.length); const template = packet.templates[id]; requireInput(node.length === template.paths.length + 2);
        const expanded = copyInput(template.base); for (let index = 0; index < template.paths.length; index++) replace(expanded, template.paths[index], node[index + 2]); node = expanded; }
      requireInput(Number.isInteger(node[0]) && node[0] >= -1); output = new Array(node.length); for (let index = node.length - 1; index >= 0; index--) stack.push({ value: node[index], parent: output, key: index, depth: row.depth + 1 });
    } row.parent[row.key] = output;
  }
  return unpackNativeInputShapes({ format: "json-shapes-v1", shapes: copyInput(packet.shapes), texts: copyInput(packet.texts), data: holder.data });
}
