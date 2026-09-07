/** Scenario field-path fixture: exact own-data writes without alias propagation. */
export function scenarioObjectFields(payload, key, index) {
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
