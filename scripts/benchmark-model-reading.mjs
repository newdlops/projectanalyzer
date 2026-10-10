/** Independent necessary source-ownership and bounded arithmetic/catch checks; never a general proof of model truth. */

/** Collect every generated prose slot from its actual wire schema, excluding Host-restored constant fields. */
export function collectModelAuthoredCallReadingTexts(reading, wireSchema) {
  const properties = wireSchema?.properties, items = properties?.calls?.items;
  if (!properties || !items || !Array.isArray(reading.calls)
    || Array.isArray(items) && items.length !== reading.calls.length) throw new TypeError('Call reading schema mismatch');
  const result = [];
  for (const field of ['summary', 'flow', 'limitations']) {
    if (!isGeneratedProperty(properties[field])) continue;
    const values = Array.isArray(reading[field]) ? reading[field] : [reading[field]];
    result.push(...values.filter(value => typeof value === 'string'));
  }
  for (const [index, call] of reading.calls.entries()) {
    const schema = Array.isArray(items) ? items[index] : items;
    for (const field of ['role', 'inputs', 'output', 'effects', 'reason']) {
      if (isGeneratedProperty(schema.properties?.[field]) && typeof call[field] === 'string') result.push(call[field]);
    }
  }
  return result;
}

/** Required const/singleton values are source evidence, not model-authored interpretation. */
function isGeneratedProperty(property) {
  return property && !Object.hasOwn(property, 'const') && !(Array.isArray(property.enum) && property.enum.length === 1);
}

/** Find explicit body-work claims when a single callee has no supplied body.
 * A caller's source cannot prove work inside an unavailable callee. Check the
 * positive claim's own sentence: an unrelated "unknown" sentence cannot repair
 * it. This deliberately narrow offline check skips multi-call flows, provided
 * or truncated helper bodies, modal/unknown claims and Host-restored fields.
 */
export function findUnavailableCalleeBodyClaims(reading, context, wireSchema) {
  if (!Array.isArray(context?.snippets) || !Array.isArray(context?.callTask?.targets)) {
    throw new TypeError('Source ownership requires a call context');
  }
  const targets = context.callTask.targets;
  if (targets.length !== 1 || reading.calls?.length !== 1) return [];
  const [target] = targets;
  const helper = context.snippets.find(snippet => snippet.id === target.calleeSnippet
    && snippet.role === 'helper' && typeof snippet.text === 'string' && snippet.text.trim());
  if (helper) return [];
  const texts = collectModelAuthoredCallReadingTexts(reading, wireSchema), claims = new Set();
  const korean = /(?:대상|피호출)(?:\s*함수)?\s*(?:의\s*)?본문에서[^.!?。！？]{0,140}(?:전달|계산|반환|초기화|갱신|수정)(?:합니다|하며)/u;
  const english = /\b(?:in|inside)\s+(?:the\s+)?callee(?:'s)?\s+body[^.!?]{0,140}\b(?:passes|forwards|returns|calculates|updates|mutates)\b/iu;
  const uncertain = /미확인|알\s*수\s*없|\b(?:unknown|unverified|whether|may|might|could)\b/iu;
  for (const text of texts) for (const sentence of text.split(/(?<=[.!?。！？])\s*/u)) {
    if (uncertain.test(sentence)) continue;
    if (korean.test(sentence) || english.test(sentence)) claims.add(sentence.trim());
  }
  return [...claims].map(text => ({ callId: target.callId, reason: 'unsupported-missing-callee-body-work', text }));
}

/** Find unsupported decimal literals in quoted source for the bounded arithmetic fixtures.
 * This checks source copying, not derived arithmetic or general program semantics.
 * Token boundaries prevent `114` or an unrelated correct field from validating `14`.
 */
export function findUnsupportedQuotedSourceLiterals(authoredTexts, source) {
  if (typeof source !== 'string') throw new TypeError('Fixture source is required');
  const decimals = text => text.match(/(?<![\p{L}\p{N}_])[+-]?\d+(?:\.\d+)?/gu) ?? [];
  const known = new Set(decimals(source).map(Number)), unsupported = new Set();
  for (const text of authoredTexts) for (const quoted of text.matchAll(/`([^`]+)`/gu)) {
    for (const literal of decimals(quoted[1])) if (!known.has(Number(literal))) unsupported.add(literal);
  }
  return [...unsupported];
}

/** Check actual model prose separately from Host syntax; legacy callers without a schema check summary/flow/role only. */
export function checkPublicModelReading(reading, names, wireSchema) {
  const failures = [], call = reading.calls[0];
  const authored = wireSchema ? collectModelAuthoredCallReadingTexts(reading, wireSchema)
    : [reading.summary, reading.flow, call.role, ...(reading.limitations ?? [])].filter(text => typeof text === 'string');
  const flow = !wireSchema || isGeneratedProperty(wireSchema.properties?.flow) ? reading.flow : undefined;
  const text = authored.join(' ');
  const role = call.role.trim().replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
  if (/^(?:role|purpose|caller|callee|call|parent|child|역할|목적|역할\s*[/·]\s*목적|role\s*[/·]\s*purpose|호출|콜러|주문\s*처리)$/iu.test(role)
    || role === names.callee || role === names.parent) failures.push('generic-or-unsupported-call-role');
  // These fixtures contain arithmetic and unimplemented audit/observe calls,
  // with no orders, business rules or observed I/O. Identifier addFee itself is
  // allowed: a word-boundary check rejects the invented business noun instead.
  if (/\b(?:fees?|orders?|checkout\s+process|payment|discount|logging|storage)\b|주문|구매|수수료|추가\s*(?:요금|비용)|결제|할인|\d+\s*원(?:을|이|의|\s|$)/iu.test(text)) failures.push('invented-business-purpose');
  if (/\b(?:audits?|auditing|observes?|observing|observation|logs?|logging|stores?|storing|monitors?|monitoring)\s+(?:the|a|an|value|data|result)\b|\bobservation\s+(?:side\s+)?effect\b|final observation|감시|관찰(?:이|을|합니다| 수행)|정보를 추적|감사\s*기록|로그|데이터를 저장|(?:금액|값|결과)(?:을|를)?\s*기록/iu.test(text)) {
    failures.push('unproved-inner-call-behavior');
  }
  if (/조건에\s*따라[^.!?]*호출|conditional(?:ly)?[^.!?]*call/iu.test(text)) failures.push('invented-parent-call-guard');
  if (/값이\s*없|missing\s+(?:input|value)|no\s+value/iu.test(text)) failures.push('invented-missing-input-branch');
  if (/구현이\s*(?:제공되지|없)|implementation\s+is\s+missing/iu.test(call.role)) failures.push('invented-missing-callee');
  if (new RegExp('\\b(?:parent0|callee0|unknown0)\\b', 'iu').test(text)) failures.push('unrestored-callable-alias');
  // These public snippets contain none of the transport's source-slot names or
  // output labels. They cannot substitute for an actual callable or a result.
  if (/\bcall-\d+-(?:caller|callee)\b|\b(?:callId|endResult)\b/u.test(text)) failures.push('leaked-internal-call-metadata');
  // A copied catch return is not an unconditional whole-function result. Keep
  // explicit exception-qualified sentences valid; this is a narrow necessary
  // check for this corpus, not a general natural-language proof of control flow.
  const sentences = authored.flatMap(value => value.split(/(?<=[.!?。！？])\s*/u));
  if (sentences.some(sentence => !/catch|exception|error|\b(?:if|when)\b|예외|오류|경우/iu.test(sentence)
    && /(?:always\s+returns?\s+`?0\b|(?:return(?:ed)?\s+value|(?:final\s+)?result)\s+(?:is|becomes|defaults?\s+to)\s+`?0\b|(?:항상|무조건)\s*`?0`?\s*(?:을|를)?\s*반환|(?:반환값|최종\s*(?:결과|값)|endResult)[^.!?]{0,16}0[^.!?]{0,10}(?:기본값|됩니다|결정))/iu.test(sentence))) {
    failures.push('unconditional-catch-result');
  }
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
  if (typeof flow === 'string' && (!/\b(?:0|zero)\b/u.test(flow) || !/catch|exception|error|예외|오류/iu.test(flow))) {
    failures.push('missing-authored-catch-return');
  }
  // This corpus always returns value + 5 in try. The immutable output may
  // preserve it while the model's complete flow omits the actual calculation.
  if (typeof flow === 'string' && !/value\s*\+\s*5|(?:5\s*(?:를|을)\s*더|add(?:s|ing)?\s+5)/iu.test(flow)) {
    failures.push('missing-authored-return-calculation');
  }
  if (typeof flow === 'string' && !flow.includes(`${names.effect}(value)`)) failures.push('missing-authored-cleanup-argument');
  if (authored.some(value => (value.match(/`/gu)?.length ?? 0) % 2)) failures.push('unclosed-authored-source-expression');
  if (names.locale === 'en' && authored.some(value => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value.replace(/`[^`]*`/gu, '')))) {
    failures.push('non-english-authored-prose');
  }
  if (typeof names.source === 'string') {
    if (findUnsupportedQuotedSourceLiterals(authored, names.source).length) {
      failures.push('invented-authored-numeric-literal');
    }
  }
  if (typeof flow === 'string') {
    const sentences = flow.split(/(?<=[.!?。！？])\s*/u).map(sentence => sentence.trim()).filter(sentence => sentence.length >= 24);
    if (new Set(sentences).size !== sentences.length) failures.push('repeated-authored-flow-sentence');
  }
  return failures;
}
