/** Canonical per-request JSON shape/text sharing. Every original source/prior field and string restores exactly, in order. */
import { copyInput, inputKeys, inputRecord, putInput, requireInput, sameInputJson, INPUT_DEPTH, INPUT_NODES, type InputRecord } from "./data";

/** Encode complete object key lists and profitable repeated whole strings from this input alone. */
export function packNativeInputShapes(value: unknown): InputRecord {
  const source = copyInput(value), counts = new Map<string, number>(), scan: unknown[] = [source];
  while (scan.length) { const item = scan.pop(); if (typeof item === "string") counts.set(item, (counts.get(item) ?? 0) + 1);
    else if (item && typeof item === "object") for (const child of Object.values(item)) scan.push(child); }
  const texts = [...counts].filter(([text, count]) => count > 1 && text.length >= 24 && (count - 1) * JSON.stringify(text).length > count * 9 + 8).map(([text]) => text);
  const textIds = new Map(texts.map((text, id) => [text, id])), shapes: string[][] = [], shapeIds = new Map<string, number>(), holder: InputRecord = {};
  const stack: Array<{ value: any; parent: object; key: string | number }> = [{ value: source, parent: holder, key: "data" }];
  while (stack.length) { const row = stack.pop()!, item = row.value; let output: unknown;
    if (typeof item === "string" && textIds.has(item)) output = [-1, textIds.get(item)];
    else if (!item || typeof item !== "object") output = item;
    else { const array = Array.isArray(item), keys = Object.keys(item); let tag = 0;
      if (!array) { const signature = JSON.stringify(keys); if (!shapeIds.has(signature)) { shapeIds.set(signature, shapes.length + 1); shapes.push(keys); } tag = shapeIds.get(signature)!; }
      const tuple: unknown[] = [tag, ...new Array(keys.length)]; output = tuple;
      for (let index = keys.length - 1; index >= 0; index--) stack.push({ value: item[keys[index]], parent: tuple, key: index + 1 }); }
    putInput(row.parent, row.key, output);
  }
  const packet = { format: "json-shapes-v1", shapes, texts, data: holder.data }; sameInputJson(unpackNativeInputShapes(packet), source); return packet;
}

/** Restore only this packet's shape/text references; array tags cannot borrow a foreign table or invent a missing field. */
export function unpackNativeInputShapes(input: unknown): unknown {
  const packet = inputRecord(input); inputKeys(packet, ["format", "shapes", "texts", "data"]); requireInput(packet.format === "json-shapes-v1");
  requireInput(Array.isArray(packet.shapes) && Array.isArray(packet.texts) && packet.texts.every((text: unknown) => typeof text === "string"));
  for (const keys of packet.shapes) requireInput(Array.isArray(keys) && keys.every(key => typeof key === "string") && new Set(keys).size === keys.length);
  const holder: InputRecord = {}, stack: Array<{ value: any; parent: object; key: string | number; depth: number }> = [{ value: packet.data, parent: holder, key: "value", depth: 0 }]; let count = 0;
  while (stack.length) { const row = stack.pop()!, item = row.value; requireInput(++count <= INPUT_NODES && row.depth <= INPUT_DEPTH); let output: unknown;
    if (!Array.isArray(item)) { requireInput(item === null || ["string", "boolean", "number"].includes(typeof item)); output = item; }
    else { const tag = item[0]; requireInput(Number.isInteger(tag) && tag >= -1);
      if (tag === -1) { requireInput(item.length === 2 && Number.isInteger(item[1]) && item[1] >= 0 && item[1] < packet.texts.length); output = packet.texts[item[1]]; }
      else { const keys: string[] = tag === 0 ? Array.from({ length: item.length - 1 }, (_, index) => String(index)) : packet.shapes[tag - 1]; requireInput(keys && item.length === keys.length + 1);
        const result: unknown[] | InputRecord = tag === 0 ? new Array(keys.length) : {}; output = result;
        for (let index = keys.length - 1; index >= 0; index--) stack.push({ value: item[index + 1], parent: result, key: keys[index], depth: row.depth + 1 }); }
    } putInput(row.parent, row.key, output);
  }
  return copyInput(holder.value);
}
