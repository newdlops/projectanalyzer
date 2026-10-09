/** Offline model supervision helpers. These labels never replace inference or enter the extension runtime. */

/** Preserve the original label template while reading each return expression from its own source site.
 * The complete declaration must contain only an if/return and a later return;
 * lexical inventory alone cannot prove an otherwise clause across intervening code.
 */
export function createTwoReturnBranchSupervision(target, locale, sourceText) {
  if (!['ko', 'en'].includes(locale)) throw new TypeError('Unsupported supervision locale');
  const inventory = target?.returnSyntax;
  if (!inventory || inventory.limited !== false || inventory.syntaxOnly !== true
    || !Array.isArray(inventory.sites) || inventory.sites.length !== 2) return undefined;
  const [branch, later] = inventory.sites;
  if (!Array.isArray(branch.regions) || branch.regions.length !== 1 || branch.regions[0].kind !== 'then'
    || !Array.isArray(later.regions) || later.regions.length !== 0) return undefined;
  const expressions = [branch.regions[0].expression, branch.expression, later.expression];
  if (expressions.some(value => typeof value !== 'string' || !value.trim() || /[`\r\n\x00-\x1f]/u.test(value))) return undefined;
  const [predicate, selected, subsequent] = expressions.map(value => value.trim());
  if (typeof sourceText !== 'string' || target.sourceLimited) return undefined;
  const opening = sourceText.indexOf('{'), closing = sourceText.lastIndexOf('}');
  if (opening < 0 || closing <= opening || sourceText.slice(closing+1).trim()) return undefined;
  const quote = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const braced = '\\{\\s*return\\s+' + quote(selected) + '\\s*;?\\s*\\}\\s*;?\\s*';
  // Kotlin permits a single return without braces. A statement separator is
  // still required, so two expressions cannot merge into a fabricated branch.
  const unbraced = 'return\\s+' + quote(selected) + '\\s*(?:;|[\\r\\n])\\s*';
  const exactBody = new RegExp('^\\s*if\\s*\\(\\s*' + quote(predicate) + '\\s*\\)\\s*(?:' + braced + '|' + unbraced
    + ')return\\s+' + quote(subsequent) + '\\s*;?\\s*$', 'u');
  if (!exactBody.test(sourceText.slice(opening+1, closing))) return undefined;
  const candidate = target.confidence === 'inferred';
  const role = locale === 'ko'
    ? `${candidate ? '후보 본문에서는 ' : ''}조건 \`${predicate}\`에 따라 \`${selected}\` 또는 \`${subsequent}\`를 반환합니다.`
    : `${candidate ? 'In the candidate body, ' : ''}Return \`${selected}\` when \`${predicate}\`, otherwise \`${subsequent}\`.`;
  // The production role field allows 160 characters. Refuse clipping a source
  // expression or silently falling back to a label with one missing branch.
  return role.length <= 160 ? role : undefined;
}

/** Restore the original partial-source label only for an owned, visibly unfinished if/return body.
 * The unseen remainder has no known otherwise result, even if the visible return is a negative literal.
 */
export function createTruncatedReturnBranchSupervision(target, locale, snippet) {
  if (!['ko', 'en'].includes(locale)) throw new TypeError('Unsupported supervision locale');
  if (target?.sourceLimited !== true || !['exact', 'inferred'].includes(target.confidence)
    || !target.calleeSnippet || snippet?.id !== target.calleeSnippet || snippet.role !== 'helper'
    || snippet.truncated !== true || typeof snippet.text !== 'string') return undefined;
  const opening = snippet.text.indexOf('{');
  if (opening < 0) return undefined;
  // Accept only the one visible branch. An outer closing brace, later statement
  // or nested block would invalidate the evidence for this bounded label repair.
  const body = snippet.text.slice(opening+1).trim();
  if (!/^if\s*\([^{};\r\n]+\)\s*(?:\{\s*return\s+[^{};\r\n]+\s*;?\s*\}|return\s+[^{};\r\n]+\s*;?)\s*$/u.test(body)) return undefined;
  const candidate = target.confidence === 'inferred';
  return locale === 'ko'
    ? `${candidate ? '후보 본문 기준으로, ' : ''}제공된 부분은 조건부 반환이며 잘린 나머지 작업은 미확인입니다.`
    : `${candidate ? 'For this candidate body, ' : ''}The supplied part conditionally returns; the truncated remaining work is unknown.`;
}
