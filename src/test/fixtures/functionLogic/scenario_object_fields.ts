/** Scenario field-path fixture: exact own-data writes without alias propagation. */
export function scenarioObjectFields(payload: { profile: { score: number }; status?: string; items: string[] } & Record<string, unknown>, key: string, index: number) {
  /** Repeated direct writes retain one canonical owner-plus-leaf identity. */
  payload.profile.score += 2;
  payload["profile"]["score"]++;
  payload[key] = "ready";
  payload.items[index] = "selected";
  delete payload.status;
  const alias = payload;
  alias.profile.score++;
  return payload.profile.score;
}
