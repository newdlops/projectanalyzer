/** Lossless whole-block call/input messages with canonical shape/DAG cost selection; every original instruction byte remains in place. */
import { FunctionNarrativeError } from "../../../shared/functionNarratives";
import { copyInput, inputKeys, inputRecord, requireInput, sameInputJson, type InputRecord } from "./data";
import { packNativeInputShapes } from "./shapes";
import { packNativeInputDag } from "./dag";
import { unpackNativeSourceJson } from "./sourceJson";
import { nativeCallInstructions } from "./callInstructions";
import type { NativeInputMessage } from "./types";

const names = ["SCHEMA NOTATION:", "SOURCE DATA:", "sourceReadingRoles:"], schemaMarker = names[0] + "\n";
const markers: Readonly<Record<string, string>> = { "json-shapes-v1": "LOSSLESS JSON INPUT:\n", "json-template-shapes-v1": "LOSSLESS TEMPLATE INPUT:\n", "json-dag-shapes-v1": "LOSSLESS DAG INPUT:\n" };
const legends: Readonly<Record<string, string>> = nativeCallInstructions.messageLegends;

/** Admit message records before accessing roles/content; no hidden member or source capability is evaluated. */
function ownedMessages(input: readonly NativeInputMessage[]): NativeInputMessage[] {
  const messages = copyInput(input); requireInput(Array.isArray(messages)); for (const message of messages) { inputKeys(message, ["role", "content"]); requireInput(["system", "user"].includes(message.role) && typeof message.content === "string"); } return messages;
}

/** Restore all original instructions and the exact ordered two/three named JSON blocks, with no manufactured optional block. */
export function unpackNativeInputMessages(input: readonly NativeInputMessage[]): NativeInputMessage[] {
  return ownedMessages(input).map(message => {
    if (message.role !== "user") return message;
    const found = Object.entries(markers).filter(([, marker]) => message.content.includes(marker)); if (!found.length) return message; requireInput(found.length === 1);
    const [format, marker] = found[0], start = message.content.indexOf(legends[format] + "\n" + marker); requireInput(start >= 0);
    let packet: InputRecord; try { packet = inputRecord(JSON.parse(message.content.slice(start + legends[format].length + 1 + marker.length))); }
    catch (error) { if (error instanceof FunctionNarrativeError) throw error; throw new FunctionNarrativeError("invalid-response", "native-input-json"); }
    requireInput(packet.format === format); const blocks = inputRecord(unpackNativeSourceJson(packet)), keys = Object.keys(blocks); requireInput(keys.length === 2 || keys.length === 3); sameInputJson(keys, names.slice(0, keys.length));
    return { ...message, content: message.content.slice(0, start) + keys.flatMap(key => [key, JSON.stringify(blocks[key])]).join("\n") };
  });
}

/** Pack the complete canonical blocks, choosing DAG only when the entire message plus its original legend is shorter than shapes. */
export function packNativeInputMessages(input: readonly NativeInputMessage[]): NativeInputMessage[] {
  const messages = ownedMessages(input), users = messages.filter(message => message.role === "user" && message.content.includes(schemaMarker)); requireInput(users.length === 1);
  const user = users[0], start = user.content.indexOf(schemaMarker), tail = user.content.slice(start).split("\n"); requireInput(tail.length === 4 || tail.length === 6); const blocks: InputRecord = {};
  for (let index = 0; index < tail.length / 2; index++) { requireInput(tail[index * 2] === names[index]); try { blocks[names[index]] = JSON.parse(tail[index * 2 + 1]); } catch { throw new FunctionNarrativeError("invalid-response", "native-input-json"); } }
  const shape = packNativeInputShapes(blocks), dag = packNativeInputDag(blocks);
  const rewrite = (packet: InputRecord) => messages.map(message => message === user ? { ...message, content: message.content.slice(0, start) + legends[packet.format] + "\n" + markers[packet.format] + JSON.stringify(packet) } : message);
  const fallback = rewrite(shape), candidate = dag.format === "json-dag-shapes-v1" ? rewrite(dag) : fallback, characters = (value: NativeInputMessage[]) => value.reduce((sum, message) => sum + message.content.length, 0);
  const result = characters(candidate) < characters(fallback) ? candidate : fallback; sameInputJson(unpackNativeInputMessages(result), messages); return result;
}
