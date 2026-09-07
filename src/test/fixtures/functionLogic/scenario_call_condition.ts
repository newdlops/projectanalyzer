/** Small Development Host fixture for opaque direct-call Scenario branching. */
function helper(value: boolean): boolean {
  return value;
}

export function scenarioCallCondition(input: boolean): "yes" | "no" {
  if (helper(input)) return "yes";
  return "no";
}

/** Development Host fixture for consecutive exact same-binding flow playback. */
export function scenarioMotion(input: boolean): number {
  let score = input ? 1 : 0;
  score = score + 2;
  score = score * 3;
  return score;
}
