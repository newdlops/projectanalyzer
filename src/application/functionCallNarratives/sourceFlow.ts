/** Complete guarded call recipes connect both source branches and every intermediate without model guesses. */
import { analyzeFunctionLogic, findFunctionAtPosition } from "../../analyzer/functionLogic";
import { analyzeFunctionTutorDeclaration } from "../../analyzer/functionTutor";
import { createFunctionCallSourceReader, readFunctionCallSourceExpression } from "../../analyzer/functionCalls";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import type { FunctionCallNarrativeChunk } from "../../shared/functionCallNarratives";
import { isFunctionCallNarrativeChunk, isFunctionCallNarrativeLanguage } from "../../shared/functionCallNarratives";
import type { SymbolNode } from "../../shared/types";
import { buildFunctionCallSourceSummary } from "./sourceSummary";
import { readSourceCallProofs } from "./sourceProofs";

/** Preserve the established compact guarded prose, then compile other complete paths from certified batches. */
export function buildFunctionCallSourceFlow(context: FunctionNarrativeContext, parent: SymbolNode, source: string,
  language: "ko" | "en"): FunctionCallNarrativeChunk | undefined {
  const guarded = buildGuardedSourceFlow(context, parent, source, language);
  if (guarded) return guarded;
  if (!context.callTask?.includeSummary || !context.sourceCallFlowProof) return;
  const proofs = readSourceCallProofs(context, parent, source);
  if (!proofs) return;
  const summary = buildFunctionCallSourceSummary(context, parent, source, proofs, language);
  const chunk = summary && { ...summary, calls: [], limitations: [] };
  return chunk && isFunctionCallNarrativeChunk(chunk, [], true) && isFunctionCallNarrativeLanguage(chunk, language) ? chunk : undefined;
}

/** Existing entire guard/early-return/bind/return recipe; other flows use the generic bounded compiler above. */
function buildGuardedSourceFlow(context: FunctionNarrativeContext, parent: SymbolNode, source: string,
  language: "ko" | "en"): FunctionCallNarrativeChunk | undefined {
  const task = context.callTask!, evidence = task.calleeEvidence;
  if (!context.sourceCallFlowProof || task.scope !== "overview" || task.routeStatus !== "structure" || !task.includeSummary
    || task.targets.length || task.sequence.length !== 3 || evidence?.length !== 3 || evidence.some(item => item.truncated)) return;
  const logic = analyzeFunctionLogic({ functionNode: parent, sourceText: source, maxBlocks: 32 });
  const blocks = logic.blocks, kinds = blocks.map(block => block.kind);
  if (JSON.stringify(kinds) !== JSON.stringify(["entry", "condition", "return", "mutation", "return", "exit"])
    || blocks.some(block => block.confidence !== "exact") || logic.callsites.length !== 3 || logic.edges.length !== 6) return;
  const [entry, guard, early, bind, finish, exit] = blocks;
  const expected = new Set([[entry, guard, "next"], [guard, early, "true"], [guard, bind, "false"],
    [early, exit, "return"], [bind, finish, "next"], [finish, exit, "return"]].map(([from, to, kind]) =>
      `${(from as typeof entry).id}:${(to as typeof entry).id}:${kind}`));
  if (logic.edges.some(edge => edge.confidence !== "exact" || !expected.delete(`${edge.sourceId}:${edge.targetId}:${edge.kind}`)) || expected.size) return;
  const tutor = analyzeFunctionTutorDeclaration({ functionNode: parent, sourceText: source, functionLogic: logic });
  if (tutor.executionKind !== "sync" || tutor.inputSummarySafe === false || tutor.parameters.some(p => p.rest || p.optional || p.defaultValue !== undefined)
    || tutor.gaps.some(gap => gap.kind !== "language-support")) return;
  const predicate = guard.condition?.expression;
  if (!predicate || readFunctionCallSourceExpression(predicate, new Set(tutor.parameters.map(parameter => parameter.name))) === undefined) return;
  const sites = logic.callsites.slice().sort((a, b) => a.range.startLine - b.range.startLine || a.range.startCharacter - b.range.startCharacter);
  const reader = createFunctionCallSourceReader(parent, source), readings = [];
  for (let index = 0; index < 3; index++) {
    const row = task.sequence[index], original = evidence.find(item => item.callId === row.callId);
    if (!original || row.deferred || sites[index].calleeName !== row.callee) return;
    const target = findFunctionAtPosition({ filePath: "/source/callee." + (parent.language === "kotlin" ? "kt" : "ts"),
      languageId: parent.language, sourceText: original.code, position: { line: 0, character: 0 } });
    if (!target || target.kind !== "function" || target.name !== row.callee) return;
    const node: SymbolNode = { id: "source-call-" + index, kind: "function", name: target.name, qualifiedName: target.qualifiedName,
      filePath: target.filePath, range: target.range, selectionRange: target.selectionRange, language: target.language };
    const facts = reader.read(node, original.code, sites[index].range, row.expression);
    // The legacy compact recipe names only a return leaf. Extended callee
    // paths must use the generic compiler so local changes/branches stay visible.
    if (!facts || facts.bodyPaths) return;
    readings.push(facts);
  }
  if (readings[0].use.kind !== "return" || readings[1].use.kind !== "binding" || readings[2].use.kind !== "return") return;
  const ko = language === "ko", binding = "`" + readings[1].use.name + "`";
  const code = task.sequence.map(row => "`" + row.expression + "`"), result = readings.map(reading => "`" + reading.returnExpression + "`");
  const transfer = readings.map(reading => reading.parameters.length ? (ko ? "매개변수 " : "parameter ")
    + reading.parameters.map((name, parameter) => "`" + name + "` (" + reading.parameterTypes[parameter] + ")").join(", ") + (ko ? "로 인자를 전달하여 " : " receives its call argument; ") : "");
  const conditional = context.sourceCallFlowProof.inferred ? ko ? "추정 대상이 원문 정의라면, " : "If candidate targets match these definitions, " : "";
  const summary = conditional + (ko ? `조건식 \`${predicate}\`의 결과가 참이면 ${code[0]}의 반환식 ${result[0]} 값을 반환합니다. 거짓이면 ${code[1]}의 ${result[1]} 결과를 ${binding}에 저장하고 ${code[2]}의 ${result[2]} 결과를 반환합니다.`
    : `When \`${predicate}\` is true, return ${code[0]}'s ${result[0]}. Otherwise store ${code[1]}'s ${result[1]} in ${binding}, then return ${code[2]}'s ${result[2]}.`);
  const flow = conditional + (ko ? `조건식 \`${predicate}\`의 참 경로에서는 ${code[0]} 호출을 진행합니다. 대상의 반환식 ${result[0]} 값을 부모 함수에서 바로 반환하므로 뒤의 호출은 건너뜁니다. 거짓 경로에서는 ${code[1]}의 ${transfer[1]}반환식 ${result[1]}의 결과를 ${binding}에 저장합니다. 이어 ${code[2]}의 ${transfer[2]}반환식 ${result[2]}의 결과를 부모 함수의 반환값으로 전달합니다.`
    : `The true branch of \`${predicate}\` calls ${code[0]}. Its return expression ${result[0]} becomes the parent's return, skipping later calls. The false branch calls ${code[1]}; ${transfer[1]}store its return expression ${result[1]} in ${binding}. Then call ${code[2]}; ${transfer[2]}return its expression ${result[2]} from the parent.`);
  const chunk = { summary, flow, calls: [], limitations: [] };
  return isFunctionCallNarrativeChunk(chunk, [], true) && isFunctionCallNarrativeLanguage(chunk, language) ? chunk : undefined;
}
