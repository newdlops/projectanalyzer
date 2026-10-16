/** Canonical response-independent sharing of repeated complete input subtrees; definitions reference earlier nodes only. */
import { copyInput, inputKeys, inputRecord, requireInput, sameInput, sameInputJson, INPUT_DEPTH, INPUT_NODES, type InputRecord } from "./data";
import { packNativeInputShapes, unpackNativeInputShapes } from "./shapes";

type Position = { value: any[]; parent: any; key: string | number; depth: number; original?: string };
/** Record every literal shape-array position without recursion. Input ownership was checked before walking. */
function positions(root: any): { holder: InputRecord; rows: Position[] } {
  const holder = { data: root }, rows: Position[] = [], stack: Position[] = [{ value: root, parent: holder, key: "data", depth: 0 }];
  while (stack.length) { const row = stack.pop()!; if (!Array.isArray(row.value)) continue; requireInput(rows.length < INPUT_NODES && row.depth <= INPUT_DEPTH); rows.push(row);
    for (let index = row.value.length - 1; index >= 1; index--) if (Array.isArray(row.value[index])) stack.push({ value: row.value[index], parent: row.value, key: index, depth: row.depth + 1 }); }
  return { holder, rows };
}

/** Share only profitable identical input fragments, preserving the base format when the entire result would grow. */
export function packNativeInputDag(value: unknown): InputRecord {
  const original = packNativeInputShapes(value), working = copyInput(original), { holder, rows } = positions(working.data), groups = new Map<string, { count: number; id?: number }>();
  for (const row of rows) { row.original = JSON.stringify(row.value); const group = groups.get(row.original) ?? { count: 0 }; group.count++; groups.set(row.original, group); }
  const nodes: any[][] = [];
  for (const row of rows.sort((a, b) => b.depth - a.depth)) { const group = groups.get(row.original!)!; if (group.count < 2) continue;
    if (group.id === undefined) { const id = nodes.length, size = JSON.stringify(row.value).length, reference = JSON.stringify([-2, id]).length; if (size + 2 + group.count * reference >= group.count * size) continue; group.id = id; nodes.push(copyInput(row.value)); }
    else sameInput(row.value, nodes[group.id]); row.parent[row.key] = [-2, group.id];
  }
  const needed = new Set<number>(), pending = [holder.data];
  while (pending.length) { const node = pending.pop(); if (!Array.isArray(node)) continue;
    if (node[0] === -2) { const id = node[1]; if (needed.has(id)) continue; needed.add(id); requireInput(Number.isInteger(id) && id >= 0 && id < nodes.length); pending.push(nodes[id]); }
    else for (let index = node.length - 1; index >= 1; index--) if (Array.isArray(node[index])) pending.push(node[index]); }
  const ids = [...needed].sort((a, b) => a - b), renumber = new Map(ids.map((id, index) => [id, index])), kept = ids.map(id => nodes[id]);
  for (const root of [holder.data, ...kept]) for (const row of positions(root).rows) if (row.value[0] === -2) { requireInput(renumber.has(row.value[1])); row.value[1] = renumber.get(row.value[1]); }
  const candidate = { format: "json-dag-shapes-v1", shapes: working.shapes, texts: working.texts, nodes: kept, data: holder.data }, output = JSON.stringify(candidate).length < JSON.stringify(original).length ? candidate : original;
  sameInputJson(unpackNativeInputDag(output), value); return output;
}

/** Reject foreign/forward/self references and bounded expansion bombs before restoring all original JSON fields. */
export function unpackNativeInputDag(input: unknown): unknown {
  const packet = inputRecord(input); if (packet.format === "json-shapes-v1") return unpackNativeInputShapes(packet);
  inputKeys(packet, ["format", "shapes", "texts", "nodes", "data"]); requireInput(packet.format === "json-dag-shapes-v1" && Array.isArray(packet.nodes) && packet.nodes.length <= INPUT_NODES);
  for (const [index, node] of packet.nodes.entries()) { requireInput(Array.isArray(node) && node[0] >= -1);
    for (const { value } of positions(node).rows) if (value[0] === -2) requireInput(value.length === 2 && Number.isInteger(value[1]) && value[1] >= 0 && value[1] < index); }
  const holder: InputRecord = {}, stack = [{ value: packet.data, parent: holder as any, key: "data" as string | number, depth: 0 }]; let count = 0;
  while (stack.length) { const row = stack.pop()!; requireInput(++count <= INPUT_NODES && row.depth <= INPUT_DEPTH); let value = row.value;
    if (Array.isArray(value) && value[0] === -2) { const id = value[1]; requireInput(value.length === 2 && Number.isInteger(id) && id >= 0 && id < packet.nodes.length); value = packet.nodes[id]; }
    if (!Array.isArray(value)) { row.parent[row.key] = value; continue; }
    requireInput(Number.isInteger(value[0]) && value[0] >= -1); const output = new Array(value.length); row.parent[row.key] = output;
    for (let index = value.length - 1; index >= 0; index--) stack.push({ value: value[index], parent: output, key: index, depth: row.depth + 1 });
  }
  return unpackNativeInputShapes({ format: "json-shapes-v1", shapes: copyInput(packet.shapes), texts: copyInput(packet.texts), data: holder.data });
}
