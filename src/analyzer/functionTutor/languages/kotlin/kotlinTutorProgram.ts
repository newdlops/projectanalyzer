/**
 * Projects Kotlin source control facts into the shared symbolic Tutor program.
 * Decisions and terminals retain exact source evidence, while unsupported Kotlin
 * expressions stay opaque and cannot be mistaken for JavaScript calculations.
 */
import { createContentHash } from "../../../../shared/hash";
import type { FunctionLogicAnalysis, FunctionLogicBlock } from "../../../functionLogic";
import { kotlinPositionOffset, type KotlinSource } from "../../../languages/kotlin";
import type {
  FunctionTutorConstraint, FunctionTutorDecision, FunctionTutorEvidence, FunctionTutorExpression,
  FunctionTutorGap, FunctionTutorOperation, FunctionTutorParameterFact, FunctionTutorProgram,
  FunctionTutorProgramBlock, FunctionTutorTerminal
} from "../../types";
import { readKotlinLiteral } from "./kotlinLiteralFacts";

/** Produces only source operations and an explicit symbolic-only evaluation contract. */
export function createKotlinTutorProgram(source: KotlinSource, logic: FunctionLogicAnalysis,
  parameters: FunctionTutorParameterFact[], gaps: FunctionTutorGap[]): FunctionTutorProgram {
  const bindings = (logic.valueBindings ?? []).map((binding) => ({
    bindingId: binding.id, parameterId: parameters.find((parameter) => parameter.bindingId === binding.id)?.id,
    name: binding.name, kind: binding.kind, certainty: binding.confidence
  }));
  const bindingsByName = new Map(bindings.map((binding) => [binding.name, binding.bindingId]));
  const callsByBlock = indexOwnedCalls(source, logic);
  const outgoing = new Map<string, typeof logic.edges>();
  for (const edge of logic.edges) {
    const edges = outgoing.get(edge.sourceId) ?? [];
    edges.push(edge); outgoing.set(edge.sourceId, edges);
  }
  const blocks = logic.blocks.map((block): FunctionTutorProgramBlock => {
    const sourceText = sourceSlice(source, block).trim();
    const evidence: FunctionTutorEvidence = { kind: ["return", "throw", "exit"].includes(block.kind) ? "terminal" : "fallback",
      certainty: block.confidence, filePath: block.filePath, range: block.range,
      summary: "Kotlin source block; symbolic control evidence, without runtime evaluation." };
    const operations: FunctionTutorOperation[] = [];
    // Invocation arguments and receiver calls are evaluated before the enclosing
    // assignment/return. Syntax end order retains inner calls before outer calls.
    for (const call of callsByBlock.get(block.id) ?? []) operations.push({ kind: "effect", effectKind: "call",
      summary: `${call.calleeText}()`, certainty: call.confidence ?? "exact" });
    for (const change of block.valueChanges ?? []) {
      const access = block.valueAccesses?.find((candidate) => candidate.name === change.target
        && (candidate.access === "define" || candidate.access === "write" || candidate.access === "readwrite"));
      const bindingId = access?.bindingId ?? bindingsByName.get(change.target);
      if (bindingId && change.operation === "initialize") operations.push({ kind: "define", bindingId,
        value: sourceExpression(change.value ?? "", bindingsByName) });
      else if (bindingId && change.operation === "assign" && change.operator === "=") operations.push({ kind: "assign",
        target: { kind: "binding", bindingId }, operator: "set", value: sourceExpression(change.value ?? "", bindingsByName) });
      else operations.push({ kind: "unsupported", reason: "language-gap",
        summary: `${change.target} ${change.operator} ${change.value ?? ""}`.trim() });
    }
    if ((block.kind === "call" || block.kind === "effect") && !callsByBlock.has(block.id)) operations.push({ kind: "effect", effectKind: "call",
      summary: sourceText.slice(0, 240), certainty: block.confidence });
    const terminal = sourceTerminal(block, sourceText, bindingsByName);
    const decision = createSourceDecision(block, outgoing.get(block.id) ?? []);
    return { blockId: block.id, kind: block.kind, label: block.label, operations, decision, terminal, evidence: [evidence] };
  });
  return { evaluationMode: "symbolic-only", entryBlockId: logic.blocks.find((block) => block.kind === "entry")?.id
    ?? logic.blocks[0]?.id ?? "kotlin-entry:unavailable", blocks,
    edges: logic.edges.map((edge) => ({ edgeId: edge.id, sourceBlockId: edge.sourceId,
      targetBlockId: edge.targetId, kind: edge.kind, label: edge.label, certainty: edge.confidence })),
    bindings, gaps };
}

/** Places retained lexical calls on the narrowest executable block or explicit predicate owner. */
function indexOwnedCalls(source: KotlinSource, logic: FunctionLogicAnalysis): Map<string, FunctionLogicAnalysis["callsites"]> {
  const offsets = new Map(logic.blocks.map((block) => [block.id, {
    from: kotlinPositionOffset(source, { line: block.range.startLine, character: block.range.startCharacter }),
    to: kotlinPositionOffset(source, { line: block.range.endLine, character: block.range.endCharacter })
  }]));
  const result = new Map<string, FunctionLogicAnalysis["callsites"]>();
  const ordered = [...logic.callsites].sort((left, right) => left.range.endLine - right.range.endLine
    || left.range.endCharacter - right.range.endCharacter || right.range.startLine - left.range.startLine
    || right.range.startCharacter - left.range.startCharacter);
  for (const call of ordered) {
    const from = kotlinPositionOffset(source, { line: call.range.startLine, character: call.range.startCharacter });
    const to = kotlinPositionOffset(source, { line: call.range.endLine, character: call.range.endCharacter });
    const owner = call.blockId && offsets.has(call.blockId) ? call.blockId
      : logic.blocks.filter((block) => block.kind !== "entry" && block.kind !== "exit" && block.kind !== "callable"
        && (offsets.get(block.id)?.from ?? Infinity) <= from && (offsets.get(block.id)?.to ?? -1) >= to)
        .sort((left, right) => {
          const leftRange = offsets.get(left.id)!;
          const rightRange = offsets.get(right.id)!;
          return (leftRange.to - leftRange.from) - (rightRange.to - rightRange.from) || right.depth - left.depth;
        })[0]?.id;
    if (!owner) continue;
    const calls = result.get(owner) ?? [];
    calls.push(call); result.set(owner, calls);
  }
  return result;
}

/** Reads direct declared-input predicates without proving any runtime path feasible. */
export function collectKotlinParameterConstraints(logic: FunctionLogicAnalysis,
  parameters: FunctionTutorParameterFact[]): FunctionTutorConstraint[] {
  const constraints: FunctionTutorConstraint[] = [];
  for (const block of logic.blocks) {
    const source = block.condition?.expression.trim();
    if (!source) continue;
    for (const parameter of parameters) {
      const escaped = parameter.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const truthy = new RegExp(`^${escaped}$`, "u").test(source);
      const falsy = new RegExp(`^!\\s*${escaped}$`, "u").test(source);
      const comparison = new RegExp(`^${escaped}\\s*(==|!=|<=|>=|<|>)\\s*(.+)$`, "u").exec(source);
      let operator: FunctionTutorConstraint["operator"] | undefined;
      let operand: ReturnType<typeof readKotlinLiteral>;
      if (truthy || falsy) {
        if (parameter.typeKind !== "boolean") continue;
        operator = truthy ? "truthy" : "falsy";
      } else if (comparison) {
        operand = readKotlinLiteral(comparison[2]);
        if (!operand) continue;
        if (operand.kind === "null" && (comparison[1] === "==" || comparison[1] === "!=")) {
          operator = comparison[1] === "==" ? "nullish" : "non-nullish";
          operand = undefined;
        } else {
          const operators: Record<string, FunctionTutorConstraint["operator"]> = { "==": "eq", "!=": "neq", "<": "lt", "<=": "lte", ">": "gt", ">=": "gte" };
          operator = operators[comparison[1]];
        }
      }
      if (!operator) continue;
      constraints.push({ id: `kotlin-constraint:${createContentHash(`${block.id}:${parameter.id}`).slice(0, 24)}`,
        blockId: block.id, parameterId: parameter.id, memberPath: [], operator, operand,
        certainty: "exact", evidence: [{ kind: "branch-constraint", certainty: "exact", filePath: block.filePath,
          range: block.range, summary: "Source-authored Kotlin parameter predicate; symbolic path feasibility remains unknown." }] });
      break;
    }
  }
  return constraints;
}

/** Only parser-preserved condition text is normalized; rendered labels are never parsed. */
function createSourceDecision(block: FunctionLogicBlock, edges: FunctionLogicAnalysis["edges"]): FunctionTutorDecision | undefined {
  if (!["condition", "loop", "switch"].includes(block.kind)) return undefined;
  const outcomes: FunctionTutorDecision["outcomes"] = [];
  for (const edge of edges) {
    const matches: FunctionTutorDecision["outcomes"][number]["matches"] | undefined = edge.kind === "true" || edge.kind === "false" ? edge.kind
      : edge.kind === "case" ? edge.presentation?.key === "logic-edge-default" || edge.label === "else" ? "default" : "case"
        : edge.kind === "exit" ? "loop-exit" : edge.kind === "iterate" ? "true" : undefined;
    if (matches) outcomes.push({ edgeId: edge.id, label: edge.label ?? edge.kind, matches });
  }
  if (!outcomes.length) return undefined;
  return { expression: { kind: "unsupported", reason: "language-gap",
    summary: block.condition?.expression ?? "Kotlin source decision; symbolic-only." }, outcomes };
}

/** Decodes literal/binding evidence only; Kotlin arithmetic and receiver expressions are opaque. */
function sourceExpression(text: string, bindingsByName: Map<string, string>): FunctionTutorExpression {
  const literal = readKotlinLiteral(text);
  if (literal) return { kind: "literal", value: literal };
  const bindingId = bindingsByName.get(text.trim().replace(/^`|`$/gu, ""));
  if (bindingId) return { kind: "binding", bindingId };
  return { kind: "unsupported", reason: "language-gap", summary: text.trim().slice(0, 480) || "Kotlin value is unknown." };
}

/** Source terminals are visible even when their returned/thrown value is unsupported. */
function sourceTerminal(block: FunctionLogicBlock, text: string,
  bindingsByName: Map<string, string>): FunctionTutorTerminal | undefined {
  if (block.kind === "return" || block.kind === "throw") {
    const expression = text.replace(/^(?:return|throw)\b\s*/u, "");
    return { kind: block.kind, value: expression ? sourceExpression(expression, bindingsByName) : undefined };
  }
  if (block.kind === "break" || block.kind === "continue" || block.kind === "exit") return { kind: block.kind };
  return undefined;
}

/** Slices source by UTF-16 editor coordinates, retaining CRLF and Unicode identity. */
function sourceSlice(source: KotlinSource, block: FunctionLogicBlock): string {
  const from = kotlinPositionOffset(source, { line: block.range.startLine, character: block.range.startCharacter });
  const to = kotlinPositionOffset(source, { line: block.range.endLine, character: block.range.endCharacter });
  return source.text.slice(from, to);
}
