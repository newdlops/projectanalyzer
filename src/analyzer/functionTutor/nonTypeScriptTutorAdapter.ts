/**
 * Conservative declaration adapter for Function Logic languages that do not
 * use the TypeScript parser. It reads only the selected declaration header,
 * existing lexical binding facts, and structured condition source facts; it
 * never interprets a language or treats rendered UI text as source evidence.
 */

import { createContentHash } from "../../shared/hash";
import type { SourceRange, SymbolNode } from "../../shared/types";
import type { FunctionLogicAnalysis, FunctionLogicBlock } from "../functionLogic";
import { boundFunctionTutorStaticValue, createFunctionTutorUnknown } from "./staticValue";
import type {
  FunctionTutorConstraint,
  FunctionTutorDeclarationAnalysis,
  FunctionTutorEvidence,
  FunctionTutorGap,
  FunctionTutorParameterFact,
  FunctionTutorParameterTypeKind,
  FunctionTutorProgramBlock,
  FunctionTutorStaticValue
} from "./types";

/** Builds partial, source-backed Tutor facts for Python, Java, and functional languages. */
export function analyzeNonTypeScriptTutorDeclaration(
  functionNode: SymbolNode,
  sourceText: string,
  functionLogic: FunctionLogicAnalysis
): FunctionTutorDeclarationAnalysis {
  const header = readDeclarationHeader(sourceText, functionNode.language);
  const gaps: FunctionTutorGap[] = [];
  const bindingsByName = new Map((functionLogic.valueBindings ?? []).map((binding) => [binding.name, binding.id]));
  const rawParameters = header ? splitTopLevel(header.parameters) : [];
  if (!header) gaps.push({ kind: "language-support", summary: "The declaration header could not be safely isolated; only Function Logic binding facts are available." });
  const parameterNames = rawParameters.length > 0
    ? rawParameters.map(readParameterName).filter((name): name is string => Boolean(name))
    : (functionLogic.valueBindings ?? []).filter((binding) => binding.kind === "parameter").map((binding) => binding.name);
  const parameters = parameterNames.map((name, index) => createParameter(
    name,
    rawParameters[index],
    index,
    functionNode,
    bindingsByName,
    header?.range ?? functionNode.selectionRange,
    gaps
  ));
  const parameterByName = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const constraints = collectStructuredConstraints(functionLogic.blocks, parameterByName, functionNode.filePath, sourceText);
  const programBlocks = functionLogic.blocks.map(createProgramBlock);
  const entry = functionLogic.blocks.find((block) => block.kind === "entry");
  const programBindings = (functionLogic.valueBindings ?? []).map((binding) => ({
    bindingId: binding.id,
    parameterId: parameters.find((parameter) => parameter.bindingId === binding.id)?.id,
    name: binding.name,
    kind: binding.kind,
    certainty: binding.confidence
  }));
  if (functionLogic.blocks.some((block) => (block.valueChanges?.length ?? 0) > 0)) {
    gaps.push({ kind: "unsupported-expression", summary: "Non-TypeScript value writes remain visible in Function Logic but are not evaluated by the Tutor interpreter yet." });
  }
  return {
    functionNode,
    language: functionLogic.language,
    executionKind: header?.async ? "async" : "sync",
    parameters,
    constraints,
    program: {
      entryBlockId: entry?.id ?? functionLogic.blocks[0]?.id ?? "tutor-entry:missing",
      blocks: programBlocks,
      edges: functionLogic.edges.map((edge) => ({
        edgeId: edge.id,
        sourceBlockId: edge.sourceId,
        targetBlockId: edge.targetId,
        kind: edge.kind,
        label: edge.label,
        certainty: edge.confidence
      })),
      bindings: programBindings,
      gaps: gaps.slice()
    },
    gaps
  };
}

/** Returns the declaration parameter segment without scanning beyond the first header line. */
function readDeclarationHeader(sourceText: string, language: string): { parameters: string; range: SourceRange; async: boolean } | undefined {
  const lines = sourceText.split(/\r?\n/);
  const declarationIndex = lines.findIndex((line) => isDeclarationLine(line, language));
  if (declarationIndex < 0) return undefined;
  const line = lines[declarationIndex];
  const open = line.indexOf("(");
  if (open < 0) {
    // F#/OCaml declarations have whitespace-separated parameters.
    const functional = /^\s*(?:let|and)\s+(?:rec\s+)?[A-Za-z_][\w']*\s+(.+?)\s*=/.exec(line);
    if (!functional) return undefined;
    return {
      parameters: functional[1].trim().split(/\s+/).join(","),
      range: { startLine: declarationIndex, startCharacter: 0, endLine: declarationIndex, endCharacter: line.length },
      async: /\basync\b/.test(line)
    };
  }
  const close = findClosingParenthesis(line, open);
  if (close < 0) return undefined;
  return {
    parameters: line.slice(open + 1, close),
    range: { startLine: declarationIndex, startCharacter: open + 1, endLine: declarationIndex, endCharacter: close },
    async: /\basync\b/.test(line)
  };
}

function isDeclarationLine(line: string, language: string): boolean {
  const normalized = language.toLowerCase();
  if (normalized === "python") return /^\s*(?:async\s+)?def\s+/.test(line);
  if (normalized === "elixir") return /^\s*defp?\s+/.test(line);
  if (normalized === "fsharp" || normalized === "ocaml") return /^\s*(?:let|and)\s+/.test(line);
  return /\([^)]*\)\s*(?:\{|throws\b)/.test(line);
}

/** Finds a close parenthesis while respecting only quoted declaration defaults. */
function findClosingParenthesis(line: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let index = open; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote && line[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (character === "(") depth += 1;
    if (character === ")") { depth -= 1; if (depth === 0) return index; }
  }
  return -1;
}

/** Splits a declaration list without treating nested literals as separators. */
function splitTopLevel(text: string): string[] {
  const values: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === "'" || character === '"') { quote = character; continue; }
    if ("([{<".includes(character)) depth += 1;
    else if (")]}>".includes(character)) depth -= 1;
    else if (character === "," && depth === 0) { values.push(text.slice(start, index).trim()); start = index + 1; }
  }
  const tail = text.slice(start).trim();
  if (tail) values.push(tail);
  return values;
}

function readParameterName(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const pythonOrElixir = /^\s*([A-Za-z_][\w']*)/.exec(text);
  if (!pythonOrElixir) return undefined;
  // Elixir defaults use a backslash marker, so the declaration name is always
  // the first lexical token rather than the default literal following it.
  if (text.includes("\\")) return pythonOrElixir[1];
  const beforeType = text.split(":")[0].trim().replace(/^\*+/, "");
  const java = /([A-Za-z_$][\w$]*)\s*(?:=|$)/.exec(beforeType);
  return java?.[1] ?? pythonOrElixir[1];
}

function createParameter(
  name: string,
  raw: string | undefined,
  index: number,
  functionNode: SymbolNode,
  bindingsByName: Map<string, string>,
  range: SourceRange,
  gaps: FunctionTutorGap[]
): FunctionTutorParameterFact {
  const id = `tutor-parameter:${createContentHash(`${functionNode.filePath}\0${range.startLine}\0${name}\0${index}`).slice(0, 24)}`;
  const typeText = readParameterType(raw);
  const typeKind = classifyType(typeText);
  const defaultValue = readParameterDefault(raw);
  const evidence: FunctionTutorEvidence[] = [{
    kind: typeText ? "parameter-type" : "fallback",
    certainty: typeText ? "exact" : "inferred",
    filePath: functionNode.filePath,
    range,
    summary: typeText ? "Declared parameter type." : "Parameter discovered from Function Logic declaration facts."
  }];
  if (raw?.includes("=")) evidence.push({ kind: "parameter-default", certainty: defaultValue?.kind === "unknown" ? "unknown" : "exact", filePath: functionNode.filePath, range, summary: "Declared parameter default." });
  const ownGaps: FunctionTutorGap[] = [];
  if (raw?.includes("=") && !defaultValue) ownGaps.push({ kind: "unsupported-parameter", parameterId: id, summary: `Default for ${name} is not a bounded static literal.` });
  gaps.push(...ownGaps);
  return {
    id,
    bindingId: bindingsByName.get(name),
    name,
    index,
    callingMode: "positional",
    typeKind,
    typeText,
    optional: Boolean(defaultValue) || /\?|Optional|None|nil/.test(typeText ?? ""),
    rest: false,
    defaultValue: defaultValue?.kind === "unknown" ? undefined : defaultValue,
    literalValues: [],
    memberFacts: [],
    declarationEvidence: evidence,
    gaps: ownGaps
  };
}

function readParameterType(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const python = /:\s*([^=]+?)(?:\s*=|$)/.exec(raw);
  if (python) return python[1].trim();
  const java = /^\s*(?:final\s+)?(.+?)\s+[A-Za-z_$][\w$]*\s*(?:=|$)/.exec(raw);
  return java?.[1]?.trim();
}

function classifyType(typeText: string | undefined): FunctionTutorParameterTypeKind {
  const text = (typeText ?? "").toLowerCase();
  if (/\b(bool|boolean)\b/.test(text)) return "boolean";
  if (/\b(byte|short|int|long|float|double|decimal|number)\b/.test(text)) return "number";
  if (/\b(str|string|char|text)\b/.test(text)) return "string";
  if (/\b(list|array|set|sequence)\b|\[\]/.test(text)) return "array";
  if (/\b(dict|map|object|record)\b/.test(text)) return "object";
  return "unknown";
}

function readParameterDefault(raw: string | undefined): FunctionTutorStaticValue | undefined {
  if (!raw) return undefined;
  const separator = raw.includes("=") ? raw.indexOf("=") : raw.indexOf("\\");
  if (separator < 0) return undefined;
  const text = raw.slice(separator + 1).trim().replace(/^\\\s*/, "");
  if (/^(true|True)$/.test(text)) return { kind: "boolean", value: true };
  if (/^(false|False)$/.test(text)) return { kind: "boolean", value: false };
  if (/^(null|None|nil)$/.test(text)) return { kind: "null" };
  if (/^undefined$/.test(text)) return { kind: "undefined" };
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return boundFunctionTutorStaticValue({ kind: "number", value: Number(text) });
  const quote = /^(?:'([^']*)'|"([^"]*)")$/.exec(text);
  if (quote) return { kind: "string", value: quote[1] ?? quote[2] ?? "" };
  return createFunctionTutorUnknown("unsupported-expression", "Default expression is not a bounded literal.");
}

function createProgramBlock(block: FunctionLogicBlock): FunctionTutorProgramBlock {
  return {
    blockId: block.id,
    kind: block.kind,
    label: block.label,
    operations: [],
    embeddedRelation: block.kind === "embedded" ? "immediate" : undefined,
    evidence: [{ kind: "fallback", certainty: block.confidence, filePath: block.filePath, range: block.range, summary: "Function Logic source block." }]
  };
}

/** Extracts only direct, literal parameter comparisons from structured condition facts. */
function collectStructuredConstraints(
  blocks: FunctionLogicBlock[],
  parameters: Map<string, FunctionTutorParameterFact>,
  filePath: string,
  sourceText: string
): FunctionTutorConstraint[] {
  const constraints: FunctionTutorConstraint[] = [];
  for (const block of blocks) {
    const expression = block.condition?.expression ?? readConditionFromBlockSource(block, sourceText);
    if (!expression) continue;
    for (const parameter of parameters.values()) {
      const truthy = new RegExp(`^\\s*${escapeRegExp(parameter.name)}\\s*$`).test(expression);
      const falsy = new RegExp(`^\\s*(?:not|!)\\s*${escapeRegExp(parameter.name)}\\s*$`).test(expression);
      const comparison = new RegExp(`^\\s*${escapeRegExp(parameter.name)}\\s*(==|!=|<=|>=|<|>)\\s*(.+?)\\s*:??\\s*$`).exec(expression);
      const reverse = new RegExp(`^\\s*(.+?)\\s*(==|!=|<=|>=|<|>)\\s*${escapeRegExp(parameter.name)}\\s*:??\\s*$`).exec(expression);
      let operator: FunctionTutorConstraint["operator"] | undefined;
      let operand: FunctionTutorStaticValue | undefined;
      if (truthy) operator = "truthy";
      else if (falsy) operator = "falsy";
      else if (comparison) { operator = comparisonOperator(comparison[1], false); operand = readParameterDefault(`x=${comparison[2]}`); }
      else if (reverse) { operator = comparisonOperator(reverse[2], true); operand = readParameterDefault(`x=${reverse[1]}`); }
      if (!operator || (operand?.kind === "unknown")) continue;
      const evidence: FunctionTutorEvidence = { kind: "branch-constraint", certainty: "exact", filePath, range: block.range, summary: "Direct parameter branch constraint." };
      constraints.push({
        id: `tutor-constraint:${createContentHash(`${block.id}\0${parameter.id}`).slice(0, 24)}`,
        blockId: block.id,
        parameterId: parameter.id,
        memberPath: [],
        operator,
        operand,
        certainty: "exact",
        evidence: [evidence]
      });
      break;
    }
  }
  return constraints;
}

/** Reads the parser-owned source range of a decision when the generic CFG omits condition metadata. */
function readConditionFromBlockSource(block: FunctionLogicBlock, sourceText: string): string | undefined {
  if (block.kind !== "condition" && block.kind !== "loop") return undefined;
  const lines = sourceText.split(/\r?\n/);
  const line = lines[block.range.startLine] ?? "";
  const segment = line.slice(block.range.startCharacter, block.range.endCharacter || line.length).trim();
  const match = /^(?:if|elif|while)\s+(.+?)(?::\s*)?$/.exec(segment);
  return match?.[1];
}

function comparisonOperator(operator: string, reversed: boolean): FunctionTutorConstraint["operator"] | undefined {
  const direct: Record<string, FunctionTutorConstraint["operator"]> = { "==": "eq", "!=": "neq", "<": reversed ? "gt" : "lt", "<=": reversed ? "gte" : "lte", ">": reversed ? "lt" : "gt", ">=": reversed ? "lte" : "gte" };
  return direct[operator];
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
