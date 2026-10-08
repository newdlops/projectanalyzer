/** Closed cleanup recipe: preserve return-expression evaluation before finally, without trusting simplified CFG return edges. */
import type { SymbolNode, SourceRange } from "../../shared/types";
import type { FunctionLogicAnalysis } from "../functionLogic";
import type { FunctionTutorDeclarationAnalysis } from "../functionTutor";
import type { FunctionCallSourceBodyFacts, FunctionCallSourceBodyStep } from "./sourceBody";
import { readFunctionCallSourceDeclaredParameters } from "./sourceParameters";
import { readFunctionCallSourceExecution } from "./sourceExecution";
import { readFunctionCallSourceRange } from "./sourceSyntax";
import { readFunctionCallFinallySyntax } from "./sourceFinallySyntax";
import { createFunctionCallSourceValueReader, type FunctionCallSourceValue } from "./sourceCallValues";

/** Full AST/CFG/callsite coverage is required; catch, control transfers, writes, extra work and async cleanup stay model work. */
export function readFunctionCallSourceFinally(callee: SymbolNode, source: string, logic: FunctionLogicAnalysis,
  tutor: FunctionTutorDeclarationAnalysis, maxDepth: number): FunctionCallSourceBodyFacts | undefined {
  if (readFunctionCallSourceExecution(tutor, logic.signature) !== "sync" || logic.blocks.length > maxDepth
    || logic.gaps.some(gap => !["parseLimited", "dynamicBehavior"].includes(gap.code))
    || logic.blocks.some(block => block.confidence !== "exact" || !["entry", "try", "return", "call", "exit"].includes(block.kind))
    || logic.edges.some(edge => edge.confidence !== "exact")) return;
  const declaration = readFunctionCallSourceRange(source, logic.sourceRange ?? callee.range);
  if (!declaration || declaration.length > 1800) return;
  const syntax = readFunctionCallFinallySyntax(callee, source), declared = readFunctionCallSourceDeclaredParameters(tutor, { allowBodyGaps: true });
  if (!syntax || !declared || declared.opaqueParameters.length) return;
  const entry = logic.blocks.filter(block => block.kind === "entry"), exit = logic.blocks.filter(block => block.kind === "exit");
  const attempt = logic.blocks.find(block => block.kind === "try" && equalRange(block.range, syntax.tryRange));
  const returned = logic.blocks.find(block => block.kind === "return" && equalRange(block.range, syntax.returnRange));
  const cleanup = syntax.cleanupRanges.map(range => logic.blocks.find(block => block.kind === "call" && equalRange(block.range, range)));
  if (entry.length !== 1 || exit.length !== 1 || !attempt || !returned || cleanup.some(block => !block)
    || returned.parentBlockId !== attempt.id || cleanup.some(block => block!.parentBlockId !== attempt.id)
    || logic.blocks.length !== 4 + cleanup.length) return;
  // The existing graph deliberately simplifies return-through-finally. Match
  // its complete known skeleton, then use the independent AST cleanup regions
  // to explain language ordering rather than treating these edges as a trace.
  const expected = new Set([`${entry[0].id}:${attempt.id}:next`, `${attempt.id}:${returned.id}:next`, `${returned.id}:${exit[0].id}:return`,
    ...cleanup.map((block, index) => `${block!.id}:${cleanup[index + 1]?.id ?? exit[0].id}:next`)]);
  if (logic.edges.length !== expected.size || logic.edges.some(edge => !expected.delete(`${edge.sourceId}:${edge.targetId}:${edge.kind}`)) || expected.size) return;
  const parameters = declared.parameters.map(parameter => parameter.name), names = new Set(parameters);
  const readValue = createFunctionCallSourceValueReader(callee, source, logic);
  const raw = readFunctionCallSourceRange(source, returned.range)?.trim();
  const expression = raw && /^return\s+/u.test(raw) ? raw.replace(/^return\s+/u, "").replace(/;\s*$/u, "").trim() : undefined;
  const value = expression && readValue(expression, returned, names);
  if (!value || value.calls.length || value.accesses?.length || value.externalReads?.length) return;
  const finalizers: FunctionCallSourceBodyStep[] = [], sites = new Set<FunctionLogicAnalysis["callsites"][number]>();
  for (const block of cleanup) {
    const text = readFunctionCallSourceRange(source, block!.range)?.trim().replace(/;\s*$/u, "");
    const call = text && readValue(text, block!, names);
    if (!call || call.calls.length !== 1 || call.calls[0] !== text || call.accesses?.length || call.externalReads?.length) return;
    call.sites.forEach(site => sites.add(site));
    finalizers.push({ key: block!.id, kind: "call", source: text!, ...operands(call) });
  }
  if (sites.size !== logic.callsites.length) return;
  return { parameters, parameterTypes: declared.parameters.map(parameter => parameter.type), returnExpression: expression!, returnSource: raw!,
    ...(declared.opaqueParameters.length ? { opaqueParameters: declared.opaqueParameters } : {}), finalizers,
    bodyPaths: [[{ key: returned.id, kind: "return", source: expression!, ...operands(value) }]] };
}

/** Preserve every getter/captured read and nested call; these remain unknown operations, never evaluator inputs. */
function operands(value: FunctionCallSourceValue): Partial<FunctionCallSourceBodyStep> {
  return { ...(value.calls.length ? { calls: value.calls } : {}), ...(value.accesses?.length ? { accesses: value.accesses } : {}),
    ...(value.inferredCalls?.length ? { inferredCalls: value.inferredCalls } : {}), ...(value.externalReads?.length ? { externalReads: value.externalReads } : {}) };
}

/** Exact parser ranges prevent borrowing a nested or neighboring operation. */
function equalRange(left: SourceRange, right: SourceRange): boolean {
  return left.startLine === right.startLine && left.startCharacter === right.startCharacter
    && left.endLine === right.endLine && left.endCharacter === right.endCharacter;
}
