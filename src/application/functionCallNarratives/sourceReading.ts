/** Source-only call details and complete guarded recipes; unsupported source/whole-flow meanings retain the configured model. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import type { FunctionCallNarrativeTarget, FunctionCallReading } from "../../shared/functionCallNarratives";
import { getFunctionCallFixedInputs, formatFunctionCallDeclaredType, isFunctionCallNarrativeChunk, isFunctionCallNarrativeLanguage } from "../../shared/functionCallNarratives";
import { createFunctionCallSourceReader, type FunctionCallSourceFacts } from "../../analyzer/functionCalls";
import type { SymbolNode, SourceRange } from "../../shared/types";
import { buildFunctionCallSourceFlow } from "./sourceFlow";
import { buildFunctionCallSourceSummary, type SourceCallSummaryProof } from "./sourceSummary";
import { captureSourceCallProofs } from "./sourceProofs";
import { renderFunctionCallSourceReturns, renderFunctionCallSourceEffects } from "./sourceBodyReading";
import { renderFunctionCallSourceCallerEffects } from "./sourceCallerReading";

/** Full source is Host-owned and never goes through the model/Webview protocol. */
export type FunctionCallSourceCandidate = { target: FunctionCallNarrativeTarget; callerRange?: SourceRange;
  callee?: { node: SymbolNode; source: string } };

/** The lazy port compiles facts only when local generation asks for them, without preparing runtime or weights. */
export function attachFunctionCallSourceReading(context: FunctionNarrativeContext, parent: SymbolNode, source: string,
  candidates: FunctionCallSourceCandidate[]): void {
  const task = context.callTask!, snippets = context.snippets;
  const sourceFingerprint = JSON.stringify(snippets);
  const targets = task.targets.map(target => JSON.stringify(target));
  const fixedTask = () => JSON.stringify([task.scope, task.signature, task.sequence, task.conditions, task.routeStatus, task.terminal]);
  const taskFingerprint = fixedTask();
  const cache = new Map<"ko" | "en", SourceCallSummaryProof[] | undefined>();
  const owns = (owner: FunctionNarrativeContext) => owner.callTask === task && owner.snippets === snippets
    && JSON.stringify(snippets) === sourceFingerprint && fixedTask() === taskFingerprint
    && task.targets.length === candidates.length && task.targets.every((target, index) => JSON.stringify(target) === targets[index]);
  context.sourceCallReadings = { read(owner, language) {
    if (!owns(owner)) return;
    if (task.includeSummary && !task.targets.length && task.sequence.length) {
      try { return buildFunctionCallSourceFlow(owner, parent, source, language); } catch { return; }
    }
    if (!task.targets.length && !task.includeSummary) return;
    try {
      let proofs = cache.get(language);
      if (!cache.has(language)) {
        cache.set(language, undefined);
        const reader = createFunctionCallSourceReader(parent, source); proofs = [];
        for (const candidate of candidates) {
          const { target, callee, callerRange } = candidate;
          const helper = snippets.find(snippet => snippet.id === target.calleeSnippet);
          const root = snippets.find(snippet => snippet.role === "function");
          if (!callee || !callerRange || !helper || helper.truncated || !root || root.truncated || target.sourceLimited
            || target.relation !== "call" || target.deferred || !["exact", "resolved", "inferred"].includes(target.confidence)
            || !target.arguments || target.arguments.some(argument => /^(?:\.\.\.|\*)|=/u.test(argument))) return;
          const facts = reader.read(callee.node, callee.source, callerRange, target.expression);
          if (!facts || facts.parameters.length !== target.arguments.length || !helper.text.includes(facts.returnSource)
            || !root.text.includes(facts.callerSource)) return;
          const reading = describeCall(target, facts, language);
          if (!reading) return;
          proofs.push({ target, facts, callerRange, reading });
        }
        cache.set(language, proofs);
      }
      if (!proofs) return;
      const summary = task.includeSummary ? buildFunctionCallSourceSummary(owner, parent, source, proofs, language) : undefined;
      if (task.includeSummary && !summary) return;
      const chunk = { ...summary, calls: proofs.map(proof => proof.reading), limitations: [] };
      const valid = isFunctionCallNarrativeChunk(chunk, task.targets.map(target => target.callId), task.includeSummary)
        && isFunctionCallNarrativeLanguage(chunk, language) ? chunk : undefined;
      return valid;
    } catch {
      // Failed syntax proof keeps the original model path, never a false success.
      cache.set(language, undefined); return;
    }
  }, capture(owner, language) {
    const proofs = owns(owner) && cache.get(language);
    return proofs ? captureSourceCallProofs(owner, parent, source, proofs) : undefined;
  } };
}

/** The same strict public response contract binds source output to original call IDs and unchanged fixed inputs. */
export function buildSourceFunctionCallNarrativeResponse(context: FunctionNarrativeContext, language: "ko" | "en"):
  { modelName: string; text: string } | undefined {
  const chunk = context.sourceCallReadings?.read(context, language);
  return chunk ? { modelName: language === "ko" ? "소스 분석" : "Source analysis", text: JSON.stringify(chunk) } : undefined;
}

/** Explain symbolic expressions and their exact syntactic use, without substituting guessed inputs or inventing business roles. */
function describeCall(target: FunctionCallNarrativeTarget, facts: FunctionCallSourceFacts, language: "ko" | "en"): FunctionCallReading | undefined {
  const ko = language === "ko", branches = (facts.bodyPaths?.length ?? 0) > 1;
  const expression = branches ? ko ? "각 소스 경로의 반환값" : "the source path's return value" : "`" + facts.returnExpression + "`";
  const transfers = facts.parameters.map((name, index) => "`" + target.arguments![index] + "` → `" + name + "` (" + formatFunctionCallDeclaredType(facts.parameterTypes[index]) + ")");
  const guards = target.guards.map(guard => "`" + guard.expression + "` = " + guard.outcome);
  const loops = target.loops.map(loop => "`" + loop + "`");
  const conditions = [...guards, ...loops].join("; ");
  const koResult = branches ? "각 소스 경로의 반환값을" : `반환식 ${expression}의 결과를`;
  let output = facts.use.kind === "return" ? ko ? `${koResult} 이 호출부에서 부모 함수의 반환값으로 바로 전달합니다.`
    : `The callee returns ${expression}; this callsite returns it directly from the parent.`
    : facts.use.kind === "binding" ? ko ? `${koResult} 지역 변수 \`${facts.use.name}\`에 저장합니다. 부모의 최종 반환은 별도입니다.`
      : `The callee returns ${expression}; store it in local \`${facts.use.name}\`. This is not the parent's final return.`
      : ko ? `${koResult} 이 호출부에서는 저장하거나 반환하지 않습니다.`
        : `The callee returns ${expression}; this callsite discards the result.`;
  if (facts.callerReads || facts.opaqueParameters?.length || facts.bodyPaths?.some(path => path.some(step => step.kind === "call" || step.calls?.length || step.accesses?.length || step.externalReads?.length))) {
    const result = branches ? ko ? "각 경로의 반환값" : "each source-path return" : expression;
    const use = facts.use.kind === "return" ? ko ? "부모에서 반환합니다" : "return it from the parent"
      : facts.use.kind === "binding" ? ko ? `지역 \`${facts.use.name}\`에 저장합니다` : `store it in local \`${facts.use.name}\``
        : ko ? "이 호출부에서 저장·반환하지 않습니다" : "discard it at this callsite";
    const accesses = facts.callerReads || facts.opaqueParameters?.length || facts.bodyPaths!.some(path => path.some(step => step.accesses?.length || step.externalReads?.length));
    output = accesses ? ko ? `정상 완료 가정에서, 소스 식 ${result}을 ${use}. 객체 상태와 결과는 미확인입니다.`
      : `Assuming normal completion, use source ${result}: ${use}. Object state/results are unknown.`
      : ko ? `내부 호출의 정상 복귀·지역 값 유지 가정에서, ${result}을 ${use}.`
      : `Assuming normal calls preserve locals, use ${result}: ${use}.`;
  }
  const reading = { callId: target.callId,
    role: branches ? (ko ? `대상 \`${target.callee}\`의 반환 경로: ` : `Source returns of \`${target.callee}\`: `) + renderFunctionCallSourceReturns(facts) + "."
      : ko ? `대상 함수 \`${target.callee}\`의 반환식은 ${expression}입니다.` : `Call \`${target.callee}\` for its source return expression ${expression}.`,
    inputs: getFunctionCallFixedInputs(target, language) ?? (ko ? `인자 전달: ${transfers.join(", ")}.` : `Argument transfer: ${transfers.join(", ")}.`),
    output,
    effects: renderFunctionCallSourceCallerEffects(facts, renderFunctionCallSourceEffects(facts, ko), ko) ?? (ko ? "대상 본문에는 반환식 외의 변수 쓰기나 명시적인 다른 호출이 없습니다. 실제 실행 효과는 관찰하지 않았습니다."
      : "The callee body has no writes or explicit calls beyond its return expression. Runtime effects are unobserved."),
    reason: conditions ? ko ? `정적 도달 조건: ${conditions}. 이 조건 아래의 호출 관계이며 실제 실행 관찰은 아닙니다.`
      : `Static reaching conditions: ${conditions}. This is a source relationship, not an observed execution.`
      : ko ? "이 호출부에 별도의 정적 분기·반복 조건이 없습니다. 소스에 나타난 호출 관계를 읽습니다."
        : "No separate static branch or loop condition guards this callsite; read the source relationship." };
  // Proving a candidate's body never proves dispatch. Keep inferred relations
  // conditional in every field as well as preserving the Host's confidence.
  if (target.confidence === "inferred") {
    reading.role = (ko ? "추정 대상의 원문: " : "Candidate source: ") + reading.role;
    if (getFunctionCallFixedInputs(target, language) === undefined)
      reading.inputs = (ko ? "이 후보가 실제 대상이라면, " : "If this candidate is selected, ") + reading.inputs;
    reading.output = (ko ? "이 후보가 실제 대상이라면, " : "If this candidate is selected, ") + reading.output;
    reading.effects = (ko ? "이 후보 본문의 사실: " : "Facts about this candidate body: ") + reading.effects;
    reading.reason = (ko ? "호출 대상은 추정입니다. " : "The target is inferred. ") + reading.reason;
    // Empty lists and checked formal transfers remain byte-identical to the
    // public fixed-input contract, including its dispatch qualifier.
    const fixed = getFunctionCallFixedInputs(target, language);
    if (fixed !== undefined) reading.inputs = fixed;
  }
  return isFunctionCallNarrativeChunk({ calls: [reading], limitations: [] }, [target.callId], false) ? reading : undefined;
}
