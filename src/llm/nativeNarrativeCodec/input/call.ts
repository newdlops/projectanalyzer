/** Complete source-only call packet constructor. Shared syntax argument facts stay fixed; every original explanatory field stays model-authored. */
import { FunctionNarrativeError } from "../../../shared/functionNarratives";
import { createFunctionCallNarrativeSchema } from "../../../shared/functionCallNarratives";
import type { FunctionCallNarrativeTask } from "../../../shared/functionCallNarratives";
import { createNativeCallCodec } from "../call";
import { factorNativeSchema } from "../schemaSharing";
import { copyInput, inputOptions, inputRecord, putInput, requireInput, sameInput, sameInputJson, type InputRecord } from "./data";
import { encodeSchemaNotation, decodeSchemaNotation } from "./notation";
import { packNativeInputMessages, unpackNativeInputMessages } from "./messages";
import { numberNativeSourceLines } from "./numbering";
import { nativeSourceInputSha256 } from "./sourceNotation";
import { nativeRootInstructions } from "./instructions";
import { nativeCallInstructions } from "./callInstructions";
import type { NativeCallPacketInput, NativeCallPacket, NativeInputMessage } from "./types";

const fields = ["callId", "role", "output", "effects", "reason", "inputs"];
const forbiddenSourcePorts = new Set(["sourceWorksheet", "sourceExampleFacts", "sourceVerifiedAnalysis", "sourceCallReadings", "sourceProseReader", "valueFacts"]);
const optionalTaskFields = new Set(["terminal", "calleeEvidence", "earlierModelReadings"]);
const optionalTargetFields = new Set(["callerSnippet", "calleeSnippet", "arguments", "parameters", "sourceKind", "returnSyntax", "resultUse", "effectSyntax"]);

/** The in-process Host may explicitly assign undefined to declared optional fields. Match their original JSON absence; every defined value remains intact. */
function sourceOptions(input: unknown, optional: ReadonlySet<string>): InputRecord {
  requireInput(input && typeof input === "object" && !Array.isArray(input));
  const names = Object.getOwnPropertyNames(input), record = inputOptions(input, [], names), result: InputRecord = {};
  for (const name of names) if (record[name] !== undefined || !optional.has(name)) putInput(result, name, record[name]);
  return result;
}

/** Own the producer DTO before strict JSON codecs. Only typed optional absence is normalized; accessors, unknown undefined fields, sparse targets and aliases still fail. */
function sourceTask(input: unknown): InputRecord {
  const task = sourceOptions(input, optionalTaskFields), targets = task.targets;
  requireInput(Array.isArray(targets) && targets.length <= 2 && Object.getPrototypeOf(targets) === Array.prototype);
  sameInput(Reflect.ownKeys(targets), [...Array.from({ length: targets.length }, (_, index) => String(index)), "length"]);
  const ownedTargets: InputRecord[] = [], targetOwners = new Set<object>();
  for (let index = 0; index < targets.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(targets, String(index))!;
    requireInput(Object.hasOwn(descriptor, "value") && descriptor.enumerable);
    requireInput(!targetOwners.has(descriptor.value)); targetOwners.add(descriptor.value);
    ownedTargets.push(sourceOptions(descriptor.value, optionalTargetFields));
  }
  task.targets = ownedTargets; return inputRecord(task);
}

/** Source DTO objects cannot smuggle the legacy worksheet/prose/evaluated-answer ports; source strings are kept opaque and whole. */
function requireSourceOnly(value: unknown): void {
  const stack = [value], seen = new Set<object>();
  while (stack.length) { const node = stack.pop(); if (!node || typeof node !== "object") continue; requireInput(!seen.has(node) && seen.size < 100000); seen.add(node);
    for (const [key, child] of Object.entries(node)) { requireInput(!forbiddenSourcePorts.has(key), "native-input-source-port"); stack.push(child); }
  }
}

/** Canonical prior ordering is serialization only; missing/nonstring fields fail and no sentence is changed, shortened or manufactured. */
function canonicalPriors(input: unknown): InputRecord[] {
  const calls = copyInput(input); requireInput(Array.isArray(calls)); return calls.map(value => { const row = inputOptions(value, fields), result: InputRecord = {};
    for (const field of fields) { requireInput(typeof row[field] === "string"); result[field] = row[field]; } return result; });
}

/** Static original directions depend only on locale and the presence of parser-owned syntax records, never source answers. */
function directions(task: InputRecord, locale: "ko" | "en"): string {
  const rules: string[] = [...nativeCallInstructions.rules[locale], nativeCallInstructions.common[locale]];
  if (task.targets.some((target: InputRecord) => target.returnSyntax)) rules.push(nativeCallInstructions.returnSyntax[locale]);
  if (task.targets.some((target: InputRecord) => target.effectSyntax)) rules.push(nativeCallInstructions.effectSyntax[locale]);
  // The original source-only adapter moves both sides of its one schema line together; preserve that exact blank line and wire direction sequence.
  return rules.join("\n") + "\n\n" + nativeCallInstructions.wireDirections[locale] + "\n";
}

/** Build the full original model-source DTO, with every call-task field, complete given snippet and all six prior fields. */
function sourceContext(input: NativeCallPacketInput["context"]): { sourceData: InputRecord; task: FunctionCallNarrativeTask } {
  const context = inputOptions(input, ["functionName", "language", "limited", "snippets", "callTask"], ["sourceEvidence"]);
  requireInput(typeof context.functionName === "string" && typeof context.language === "string" && typeof context.limited === "boolean");
  const task = sourceTask(context.callTask); requireInput(typeof task.includeSummary === "boolean");
  for (const target of task.targets) { requireInput(target && typeof target === "object" && typeof target.callId === "string");
    if (target.arguments !== undefined) requireInput(Array.isArray(target.arguments) && target.arguments.every((value: unknown) => typeof value === "string"));
    if (target.parameters !== undefined) requireInput(Array.isArray(target.parameters) && target.parameters.every((value: InputRecord) => value && typeof value.name === "string" && typeof value.type === "string"));
  }
  if (Object.hasOwn(task, "earlierModelReadings")) task.earlierModelReadings = canonicalPriors(task.earlierModelReadings);
  const snippets = copyInput(context.snippets); requireInput(Array.isArray(snippets) && snippets.length > 0);
  const numbered = snippets.map((snippet: InputRecord) => { requireInput(snippet && typeof snippet === "object" && snippet.truncated === false && typeof snippet.text === "string" && snippet.text.length > 0); return { ...snippet, text: numberNativeSourceLines(snippet.text, snippet.startLine) }; });
  const sourceData = { functionName: context.functionName, language: context.language, ...(context.sourceEvidence !== undefined ? { sourceEvidence: copyInput(context.sourceEvidence) } : {}), callTask: task, snippets: numbered };
  requireSourceOnly(sourceData); return { sourceData, task: task as FunctionCallNarrativeTask };
}

/** Construct native input/output solely from supplied complete call-source fields; the Host must separately bind the actual capture and neural prior provenance. */
export function createNativeCallPacket(input: NativeCallPacketInput): NativeCallPacket {
  inputOptions(input, ["context", "locale"]); requireInput(input.locale === "ko" || input.locale === "en"); const { sourceData, task } = sourceContext(input.context);
  // This shared schema builder formats syntax argument transfers only. Its explanatory fields are free; no legacy fixed-output/reason/effect or source-prose evaluator is invoked.
  const schema = JSON.parse(JSON.stringify(createFunctionCallNarrativeSchema(task, input.locale))), codec = createNativeCallCodec(schema), compact = factorNativeSchema(codec.schema).schema, notation = encodeSchemaNotation(compact), sourceInputSha256 = nativeSourceInputSha256(sourceData);
  const expanded: NativeInputMessage[] = [{ role: "system", content: nativeRootInstructions.system[input.locale] }, { role: "user", content: directions(sourceData.callTask, input.locale) + nativeCallInstructions.schemaLegend + "\nSCHEMA NOTATION:\n" + JSON.stringify(notation) + "\nSOURCE DATA:\n" + JSON.stringify(sourceData) }];
  const payload: NativeCallPacket["payload"] = { schema: compact, messages: packNativeInputMessages(expanded) };
  if (Buffer.byteLength(JSON.stringify(payload) + "\n") > 196608) throw new FunctionNarrativeError("context-too-large", "native-input-request-bytes"); const original = copyInput(payload);
  function restore(): ReturnType<NativeCallPacket["restore"]> {
    sameInputJson(payload, original); const messages = unpackNativeInputMessages(payload.messages); sameInputJson(messages, expanded); const content = messages[1].content, schemaStart = content.indexOf("SCHEMA NOTATION:\n") + "SCHEMA NOTATION:\n".length, schemaEnd = content.indexOf("\n", schemaStart), dataStart = content.indexOf("SOURCE DATA:\n", schemaEnd) + "SOURCE DATA:\n".length;
    requireInput(schemaStart >= "SCHEMA NOTATION:\n".length && schemaEnd > schemaStart && dataStart >= "SOURCE DATA:\n".length); const restoredSchema = decodeSchemaNotation(JSON.parse(content.slice(schemaStart, schemaEnd))), restoredData = inputRecord(JSON.parse(content.slice(dataStart))); sameInput(restoredSchema, compact); sameInputJson(restoredData, sourceData); requireInput(nativeSourceInputSha256(restoredData) === sourceInputSha256); return { schema: restoredSchema, sourceData: restoredData };
  }
  restore(); return { payload, sourceInputSha256, restore, decode(raw) { restore(); return codec.decode(raw); } };
}
