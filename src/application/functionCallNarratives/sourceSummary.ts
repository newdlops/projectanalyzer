/** Symbolic source summaries for an isolated call or complete acyclic call routes; no source execution or guessed values. */
import { analyzeFunctionLogic, type FunctionLogicBlock } from "../../analyzer/functionLogic";
import { analyzeFunctionTutorDeclaration } from "../../analyzer/functionTutor";
import { readFunctionCallSourceObjectExpression, readFunctionCallSourceRange, readFunctionCallSourceDeclaredParameters, type FunctionCallSourceFacts } from "../../analyzer/functionCalls";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import type { FunctionCallNarrativeTarget, FunctionCallReading } from "../../shared/functionCallNarratives";
import { formatFunctionCallDeclaredType } from "../../shared/functionCallNarratives";
import type { SourceRange, SymbolNode } from "../../shared/types";
import { renderFunctionCallSourceBody } from "./sourceBodyReading";

/** Proofs refer to the same source-owned caller location as their unchanged five detail fields. */
export type SourceCallSummaryProof = {
  target: FunctionCallNarrativeTarget; facts: FunctionCallSourceFacts; callerRange: SourceRange; reading: FunctionCallReading;
};
type Step = { key: string; short: string; full: string };
type Route = { current: string; visited: Set<string>; names: Set<string>; mutable: Set<string>;
  calls: number[]; decisions: number; steps: Step[]; returned: boolean };
const identifier = "[\\p{L}_$][\\p{L}\\p{N}_$]*";

/** Every selected argument, source calculation, local use and reaching guard remains explicit. */
function callStep(proof: SourceCallSummaryProof, ko: boolean): Step {
  const { target, facts } = proof, expression = "`" + target.expression + "`", result = renderFunctionCallSourceBody(facts, ko);
  const transfers = facts.parameters.map((name, index) => "`" + target.arguments![index] + "` → `" + name + "` (" + formatFunctionCallDeclaredType(facts.parameterTypes[index]) + ")").join(", ");
  const use = facts.use.kind === "return" ? ko ? "부모 반환값" : "parent return"
    : facts.use.kind === "binding" ? ko ? "지역 `" + facts.use.name + "`" : "local `" + facts.use.name + "`"
      : ko ? "저장·반환 없이 버림" : "discarded without storage or return";
  return { key: "call:" + target.callId, short: expression + ": " + result + " → " + use,
    full: (ko ? "호출 " : "Call ") + expression + ": " + (transfers || (ko ? "전달 인자 없음" : "no arguments")) + "; " + result + " → " + use };
}

/** Factor only the same source-owned prefix; equal text at different statements remains a distinct operation. */
function renderRoutes(routes: Route[], field: "short" | "full"): string {
  let common = 0;
  while (common < routes[0].steps.length && routes.every(route => route.steps[common]?.key === routes[0].steps[common].key
    && route.steps[common]?.[field] === routes[0].steps[common][field])) common++;
  const separator = field === "short" ? " → " : ". ";
  const prefix = routes[0].steps.slice(0, common).map(step => step[field]).join(separator);
  if (routes.length === 1 || routes.every(route => route.steps.length === common)) return prefix;
  const alternatives = routes.map(route => route.steps.slice(common).map(step => step[field]).join(separator)).join("; ");
  return common ? prefix + separator + "[" + alternatives + "]" : alternatives;
}

/** Uncertain dispatch qualifies both the overview and the connected flow, never just a hidden detail. */
function qualifier(proofs: SourceCallSummaryProof[], ko: boolean): string {
  return proofs.some(proof => proof.target.confidence === "inferred")
    ? ko ? "추정 후보가 실제 대상이라면, " : "If the inferred candidates are selected, " : "";
}

/** An isolated call's summary describes that callsite only, not unproved preceding or subsequent parent work. */
function isolated(proof: SourceCallSummaryProof, ko: boolean): { summary: string; flow: string } {
  const step = callStep(proof, ko), assumed = qualifier([proof], ko);
  return { summary: assumed + (ko ? "선택한 호출부: " : "Selected callsite: ") + step.short + ".",
    flow: assumed + proof.reading.reason + " " + step.full + ". " + proof.reading.effects };
}

/** Compile complete paths from exact syntax. Bounded queue/visited sets reject cycles, ambiguous edges and missing source work. */
export function buildFunctionCallSourceSummary(context: FunctionNarrativeContext, parent: SymbolNode, source: string,
  proofs: SourceCallSummaryProof[], language: "ko" | "en"): { summary: string; flow: string } | undefined {
  const task = context.callTask!, ko = language === "ko";
  if (proofs.length > 8 || task.sequence.length !== proofs.length
    || task.sequence.some((row, index) => row.callId !== proofs[index].target.callId || row.callee !== proofs[index].target.callee
      || row.expression !== proofs[index].target.expression || row.deferred)) return;
  let parentReads = proofs.some(proof => Boolean(proof.facts.callerReads));
  // Argument syntax is source-owned. Caller facts must record member effects;
  // nested calls, computed/optional access and hidden writes remain unsupported.
  for (const proof of proofs) for (const argument of proof.target.arguments ?? []) {
    const names = new Set(argument.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu) ?? []);
    const value = readFunctionCallSourceObjectExpression(argument, names, { externalReads: true });
    if (parent.language === "kotlin" && argument.includes("$") || !value || value.accesses.length && !proof.facts.callerReads) return;
  }
  if (task.scope === "call") return proofs.length === 1 ? isolated(proofs[0], ko) : undefined;
  if (task.scope === "scenario" && task.routeStatus !== "complete" || task.scope === "overview" && task.routeStatus !== "structure") return;
  const logic = analyzeFunctionLogic({ functionNode: parent, sourceText: source, maxBlocks: 128 });
  const root = context.snippets.find(snippet => snippet.role === "function");
  const declaration = readFunctionCallSourceRange(source, logic.sourceRange ?? parent.range);
  if (!root || root.truncated || !declaration || root.text.trim() !== declaration.trim()) return;
  const tutor = analyzeFunctionTutorDeclaration({ functionNode: parent, sourceText: source, functionLogic: logic });
  const declared = readFunctionCallSourceDeclaredParameters(tutor);
  if (parent.kind === "constructor" || tutor.executionKind !== "sync" || tutor.inputSummarySafe === false
    || /\b(?:suspend|inline)\b/u.test(logic.signature)
    || tutor.parameters.some(parameter => parameter.rest || parameter.optional || parameter.defaultValue !== undefined)
    || tutor.parameters.some(parameter => parameter.declarationEvidence.some(evidence => evidence.kind === "parameter-default"))
    || tutor.gaps.some(gap => gap.kind !== "language-support") && !declared) return;
  const blocks = new Map(logic.blocks.map(block => [block.id, block]));
  const entry = logic.blocks.find(block => block.kind === "entry"); if (!entry) return;
  const readValue = (value: string, names: Set<string>) => {
    if (parent.language === "kotlin" && value.includes("$")) return false;
    const reading = readFunctionCallSourceObjectExpression(value, names, { externalReads: true });
    if (!reading) return false;
    if (reading.accesses.length || reading.externalReads?.length) parentReads = true;
    return true;
  };
  const owns = (block: FunctionLogicBlock, range: SourceRange) =>
    (block.range.startLine < range.startLine || block.range.startLine === range.startLine && block.range.startCharacter <= range.startCharacter)
    && (block.range.endLine > range.endLine || block.range.endLine === range.endLine && block.range.endCharacter >= range.endCharacter);
  const callCounts = new Map<string, number>();
  for (const site of logic.callsites) {
    // Kotlin's if range also covers its inline return arm. Attribute a call to
    // the innermost statement, so an untaken arm is not a predicate call.
    const owners = logic.blocks.filter(block => owns(block, site.range)).sort((left, right) =>
      left.range.endLine - left.range.startLine - (right.range.endLine - right.range.startLine)
      || left.range.endCharacter - left.range.startCharacter - (right.range.endCharacter - right.range.startCharacter));
    const owner = site.blockId ? blocks.get(site.blockId) : owners[0]; if (!owner) return;
    callCounts.set(owner.id, (callCounts.get(owner.id) ?? 0) + 1);
  }
  const blockProofs = new Map<string, number>();
  for (let index = 0; index < proofs.length; index++) {
    const proof = proofs[index], owner = logic.blocks.filter(block => ["return", "mutation", "call"].includes(block.kind)
      && owns(block, proof.callerRange) && readFunctionCallSourceRange(source, block.range)?.trim() === proof.facts.callerSource);
    if (owner.length !== 1 || blockProofs.has(owner[0].id)) return;
    blockProofs.set(owner[0].id, index);
  }
  const queue: Route[] = [{ current: entry.id, visited: new Set(), names: new Set(tutor.parameters.map(parameter => parameter.name)),
    mutable: new Set(), calls: [], decisions: 0, steps: [], returned: false }];
  const completed: Route[] = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    if (cursor >= 128 || queue.length > 128 || completed.length > 8) return;
    const route = queue[cursor], block = blocks.get(route.current);
    if (!block || block.confidence !== "exact" || route.visited.has(block.id) || route.visited.size >= 64) return;
    route.visited.add(block.id);
    if (block.kind === "exit") {
      if (!route.returned) route.steps.push({ key: block.id, short: ko ? "명시적 반환 없이 함수 끝" : "function end without an explicit return",
        full: ko ? "명시적 반환문 없이 함수 끝에 도달합니다" : "Reach function end without an explicit return" });
      if (task.scope === "scenario" && (route.decisions !== task.conditions.length || route.calls.length !== proofs.length
        || route.calls.some((index, position) => index !== position))) return;
      completed.push(route); continue;
    }
    const local = blockProofs.get(block.id), raw = readFunctionCallSourceRange(source, block.range)?.trim();
    if (local !== undefined) {
      const proof = proofs[local];
      if (route.calls.includes(local)) return;
      route.calls.push(local); route.steps.push(callStep(proof, ko));
      if (proof.facts.use.kind === "binding") {
        if (route.names.has(proof.facts.use.name!)) return;
        route.names.add(proof.facts.use.name!);
        if (/^(?:let|var)\s/u.test(proof.facts.callerSource)) route.mutable.add(proof.facts.use.name!);
      }
      if (proof.facts.use.kind === "return") route.returned = true;
    } else if (block.kind === "return") {
      if (!raw || !/^return\s+/u.test(raw)) return;
      const value = raw.replace(/^return\s+/u, "").replace(/;\s*$/u, "");
      if (!readValue(value, route.names)) return;
      route.steps.push({ key: block.id, short: (ko ? "반환 `" : "return `") + value + "`", full: (ko ? "반환식 `" : "Return expression `") + value + "`" });
      route.returned = true;
    } else if (block.kind === "mutation") {
      // Local declaration/assignment syntax is retained as a symbolic state change.
      // Member/captured/parameter/immutable writes remain outside this reading.
      // Read operands keep their source syntax with explicit unknown effects.
      if (!raw) return;
      const statement = raw.replace(/;\s*$/u, "");
      const declaration = new RegExp("^(const|let|val|var)\\s+(" + identifier + ")(?:\\s*:\\s*[A-Za-z]+)?\\s*=\\s*([\\s\\S]+)$", "u").exec(statement);
      const assignment = new RegExp("^(" + identifier + ")\\s*(?:[+*/%-]?=)\\s*([\\s\\S]+)$", "u").exec(statement);
      const name = declaration?.[2] ?? assignment?.[1], value = declaration?.[3] ?? assignment?.[2];
      if (!name || !value || declaration && route.names.has(name) || !declaration && !route.mutable.has(name)
        || !readValue(value, route.names)) return;
      route.steps.push({ key: block.id, short: "`" + statement + "`", full: (ko ? "지역 변경 `" : "Local change `") + statement + "`" });
      route.names.add(name);
      if (declaration && ["let", "var"].includes(declaration[1])) route.mutable.add(name);
    } else if (!["entry", "condition"].includes(block.kind)) return;
    // Every call in a visited block needs the same source proof; a missing project
    // edge or an unproved external call cannot silently disappear from the route.
    if ((callCounts.get(block.id) ?? 0) !== (local === undefined ? 0 : 1)) return;
    const outgoing = logic.edges.filter(edge => edge.sourceId === block.id);
    if (!outgoing.length || outgoing.some(edge => edge.confidence !== "exact" || !["next", "true", "false", "return"].includes(edge.kind))) return;
    if (block.kind === "condition") {
      const predicate = block.condition?.expression;
      if (!predicate || !readValue(predicate, route.names)
        || outgoing.length !== 2 || !outgoing.some(edge => edge.kind === "true") || !outgoing.some(edge => edge.kind === "false")) return;
      const decision = task.scope === "scenario" ? task.conditions[route.decisions] : undefined;
      if (task.scope === "scenario" && (!decision || decision.visit !== 1 || decision.expression !== predicate
        && decision.expression !== block.label || !["true", "false"].includes(decision.outcome))) return;
      for (const edge of outgoing.filter(edge => !decision || edge.kind === decision.outcome)) {
        const condition = (ko ? "조건 `" : "Condition `") + predicate + "` = " + edge.kind;
        queue.push({ current: edge.targetId, visited: new Set(route.visited), names: new Set(route.names), mutable: new Set(route.mutable), calls: [...route.calls],
          decisions: route.decisions + 1, steps: [...route.steps, { key: block.id + ":" + edge.kind, short: condition, full: condition }], returned: route.returned });
      }
    } else {
      if (outgoing.length !== 1) return;
      queue.push({ ...route, current: outgoing[0].targetId });
    }
  }
  if (!completed.length || task.scope === "scenario" && completed.length !== 1) return;
  if (task.scope === "overview") {
    const covered = new Set(completed.flatMap(route => route.calls));
    if (covered.size !== proofs.length || logic.callsites.length !== proofs.length) return;
  }
  const assumed = qualifier(proofs, ko), prefix = task.scope === "scenario"
    ? ko ? "선택한 소스 경로: " : "Selected source route: " : ko ? "소스 호출 구조: " : "Source call structure: ";
  // Reference inputs never acquire primitive semantics merely because the
  // caller's source route and argument transfer are complete.
  const inputAssumption = declared?.opaqueParameters.length ? ko
    ? " 입력은 선언 타입만 확인했으며 값·런타임 타입·연산자/효과는 미확인입니다."
    : " Inputs have declared types only; values/runtime types/operators/effects are unknown." : "";
  const readAssumption = parentReads ? ko ? " 부모 읽기의 값/연산자·getter·디스패치·상태/효과 미확인; 정상 완료 가정."
    : " Parent read values/operators/getters/dispatch/state/effects unknown; normal completion assumed." : "";
  return { summary: assumed + prefix + renderRoutes(completed, "short") + ".",
    flow: assumed + prefix + renderRoutes(completed, "full") + "."
      + (ko ? " 조건은 소스 경로의 가정이며 실제 실행 효과는 관찰하지 않았습니다." : " Conditions are source-route assumptions; runtime effects are unobserved.") + inputAssumption + readAssumption };
}
