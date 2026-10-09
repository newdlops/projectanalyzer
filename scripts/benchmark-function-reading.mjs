/** Necessary checks for public full-function measurements; source prose and timings do not prove general semantic correctness. */

/** Known graph shape can refute an invented repeated calculation or a source branch in the model's purpose. */
export function checkPublicFunctionPurpose(summary, shape) {
  const failures = [];
  if (shape.hasLoop === false && /반복적으로\s*(?:곱|계산|변경)|\b(?:repeatedly|iteratively)\s+(?:multipl|calculat|chang)/iu.test(summary)) {
    failures.push('invented-purpose-loop');
  }
  if (shape.hasBranch === false && /조건에\s*따라\s*(?:결과|값)를\s*(?:조정|변경)|adjusts?\s+(?:the\s+)?(?:result|value)\s+(?:depending\s+on|based\s+on)\s+(?:a\s+|the\s+)?conditions?/iu.test(summary)) {
    failures.push('invented-purpose-branch');
  }
  // These public effects fixtures provide only the audit call site. Naming
  // that call is valid; asserting what its absent body does is not evidence.
  if (shape.hasUnknownAudit === true && /\b(?:audits?|auditing)\s+(?:the|that|this|a|an)\s+(?:result|value|input|data)\b|감사\s*기록|로그를\s*(?:남|기록|저장)/iu.test(summary)) {
    failures.push('unproved-purpose-call-behavior');
  }
  return failures;
}

/** A source-only response, preparation failure, partial page or invalid duration cannot satisfy a fresh whole-model reading. */
export function isFreshCompleteFunctionReading(record) {
  return record.complete === true && record.coverage?.complete === true && !record.error
    && record.metrics?.length > 0 && record.score.scenarios > 0 && !record.score.failures.length
    && record.score.totalNodes > 0
    && record.score.completeNodes === record.score.totalNodes
    && Number.isFinite(record.fullExplanationMs) && record.fullExplanationMs >= 0 && record.fullExplanationMs <= 3000;
}
