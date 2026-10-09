/** Independent necessary semantic checks for the public arithmetic/catch corpus; never a general proof of model truth. */

/** Check model-authored role/summary/flow separately from Host-owned syntax so fixed fields cannot manufacture a pass. */
export function checkPublicModelReading(reading, names) {
  const failures = [], call = reading.calls[0];
  const authored = [reading.summary, reading.flow, call.role, ...(reading.limitations ?? [])].filter(text => typeof text === 'string');
  const text = authored.join(' ');
  const role = call.role.trim().replace(/^`([^`]+)`$/u, '$1');
  if (/^(?:role|caller|callee|call|parent|child|호출|콜러|주문\s*처리)$/iu.test(role)
    || role === names.callee || role === names.parent) failures.push('generic-or-unsupported-call-role');
  // These fixtures contain arithmetic and unimplemented audit/observe calls,
  // with no orders, business rules or observed I/O. Identifier addFee itself is
  // allowed: a word-boundary check rejects the invented business noun instead.
  if (/\b(?:fees?|orders?|checkout\s+process|payment|discount|logging|storage)\b|주문|수수료|추가\s*요금|결제|할인/iu.test(text)) failures.push('invented-business-purpose');
  if (/\b(?:audits?|auditing|observes?|observing|observation|logs?|logging|stores?|storing|monitors?|monitoring)\s+(?:the|a|an|value|data|result)\b|\bobservation\s+(?:side\s+)?effect\b|final observation|감시|관찰(?:이|을|합니다| 수행)|정보를 추적|감사\s*기록|로그|데이터를 저장/iu.test(text)) {
    failures.push('unproved-inner-call-behavior');
  }
  if (/조건에\s*따라[^.!?]*호출|conditional(?:ly)?[^.!?]*call/iu.test(text)) failures.push('invented-parent-call-guard');
  if (/값이\s*없|missing\s+(?:input|value)|no\s+value/iu.test(text)) failures.push('invented-missing-input-branch');
  if (/구현이\s*(?:제공되지|없)|implementation\s+is\s+missing/iu.test(call.role)) failures.push('invented-missing-callee');
  if (new RegExp('\\b(?:parent0|callee0|unknown0)\\b', 'iu').test(text)) failures.push('unrestored-callable-alias');
  // Finally may override/throw before a function's return completes. The public
  // fixture has no post-return hook or write to value. Check authored sentences
  // independently; a correct immutable output/effects field cannot repair them.
  // Include the named function: "after addFee completes" is just as wrong as
  // "after the function returns", even if all source-owned fields are correct.
  const functionName = [names.parent, names.callee].map(name => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|');
  const namedCompletion = new RegExp('(?:finally|audit|observe)[^.!?\\n]{0,100}after\\s+(?:`?(?:' + functionName
    + ')`?(?:\\([^\\n)]{0,60}\\))?\\s+)(?:returns?|complet(?:es|ion))', 'iu');
  if (/감사\s*호출은\s*완료\s*후|(?:finally|audit|observe)[^.!?\n]{0,100}(?:after\s+(?:the\s+)?(?:function\s+)?(?:returns?|complet(?:es|ion))|반환\s*(?:완료)?\s*후)|(?:returns?|completes)[^.!?\n]{0,50}before[^.!?\n]{0,50}(?:finally|audit|observe)/iu.test(text)
    || namedCompletion.test(text)) {
    failures.push('incorrect-finally-completion-order');
  }
  if (/(?:changes?|updates?|mutates?)\s+(?:the\s+)?(?:input\s+)?value\b|입력값을\s*(?:변경|갱신)|value\s*(?:를|을)\s*(?:변경|갱신)/iu.test(text)) failures.push('invented-input-write');
  if (typeof reading.flow === 'string' && (!/\b(?:0|zero)\b/u.test(reading.flow) || !/catch|exception|error|예외|오류/iu.test(reading.flow))) {
    failures.push('missing-authored-catch-return');
  }
  // This corpus always returns value + 5 in try. The immutable output may
  // preserve it while the model's complete flow omits the actual calculation.
  if (typeof reading.flow === 'string' && !/value\s*\+\s*5|(?:5\s*(?:를|을)\s*더|add(?:s|ing)?\s+5)/iu.test(reading.flow)) {
    failures.push('missing-authored-return-calculation');
  }
  if (typeof reading.flow === 'string' && !reading.flow.includes(`${names.effect}(value)`)) failures.push('missing-authored-cleanup-argument');
  if (authored.some(value => (value.match(/`/gu)?.length ?? 0) % 2)) failures.push('unclosed-authored-source-expression');
  if (names.locale === 'en' && authored.some(value => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value.replace(/`[^`]*`/gu, '')))) {
    failures.push('non-english-authored-prose');
  }
  if (typeof names.source === 'string') {
    // Only quoted standalone numeric literals are compared: calculated prose,
    // line numbers and source identifiers are not treated as runtime values.
    const literals = new Set((names.source.match(/(?<![\p{L}\p{N}_])[+-]?\d+(?:\.\d+)?/gu) ?? []).map(Number));
    if (authored.some(value => [...value.matchAll(/`([+-]?\d+(?:\.\d+)?)`/gu)].some(match => !literals.has(Number(match[1]))))) {
      failures.push('invented-authored-numeric-literal');
    }
  }
  if (typeof reading.flow === 'string') {
    const sentences = reading.flow.split(/(?<=[.!?。！？])\s*/u).map(sentence => sentence.trim()).filter(sentence => sentence.length >= 24);
    if (new Set(sentences).size !== sentences.length) failures.push('repeated-authored-flow-sentence');
  }
  return failures;
}
