/** Locale prose for independently proved callee paths; retains every symbolic step and condition without evaluating values. */
import type { FunctionCallSourceFacts, FunctionCallSourceBodyStep } from "../../analyzer/functionCalls";

const condition = (step: FunctionCallSourceBodyStep) => "`" + step.source + "` = " + step.outcome;
const code = (source: string) => "`" + source + "`";

/** Factor only identical source-owned prefix steps; every alternative's remaining steps stay explicit and ordered. */
export function renderFunctionCallSourceBody(facts: FunctionCallSourceFacts, ko: boolean): string {
  const paths = facts.bodyPaths;
  if (!paths) return code(facts.returnExpression);
  let common = 0;
  while (common < paths[0].length && paths.every(path => path[common]?.key === paths[0][common].key
    && path[common]?.outcome === paths[0][common].outcome)) common++;
  const render = (steps: FunctionCallSourceBodyStep[]) => steps.map(step => step.kind === "condition" ? condition(step)
    : step.kind === "return" ? (ko ? "반환 " : "return ") + code(step.source) : code(step.source)).join(" → ");
  const prefix = render(paths[0].slice(0, common));
  return paths.length === 1 ? prefix : (prefix ? prefix + " → " : "") + "[" + paths.map(path => render(path.slice(common))).join("; ") + "]";
}

/** Return alternatives keep their own callee guards, independent of the caller's reaching conditions. */
export function renderFunctionCallSourceReturns(facts: FunctionCallSourceFacts): string {
  return facts.bodyPaths!.map(path => {
    const guards = path.filter(step => step.kind === "condition").map(condition).join(" & ");
    return (guards ? guards + " → " : "") + code(path.find(step => step.kind === "return")!.source);
  }).join("; ");
}

/** Keep conditional local changes and duplicate statement occurrences; a source key prevents accidental text deduplication. */
export function renderFunctionCallSourceEffects(facts: FunctionCallSourceFacts, ko: boolean): string | undefined {
  if (!facts.bodyPaths) return;
  const seen = new Set<string>(), changes: string[] = [];
  for (const path of facts.bodyPaths) {
    const guards: string[] = [];
    for (const step of path) {
      if (step.kind === "condition") guards.push(condition(step));
      if (step.kind !== "change") continue;
      const key = JSON.stringify([step.key, guards]); if (seen.has(key)) continue;
      seen.add(key); changes.push((guards.length ? guards.join(" & ") + ": " : "") + code(step.source));
    }
  }
  return changes.length ? (ko ? "지역 변경: " : "Local changes: ") + changes.join("; ")
    + (ko ? ". 명시적 외부 쓰기·다른 호출 없음; 실제 효과 미관찰." : ". No explicit external writes/calls; effects unobserved.") : undefined;
}
