/** Preflight for complete synthetic model fixtures; never weakens production source/confidence handling. */

/** Reject recovered declarations and unavailable lexical inventories before benchmarking or training.
 * Intentional missing/truncated examples must not call this complete-source check.
 * Valid declarations may retain conservative inventory limits; exact-fixture comparisons can explicitly refuse them.
 * Parser-owned syntax proves fixture shape only, not compiler types, effects or runtime outcomes.
 */
export function assertCompleteModelFixtureSyntax(callee, syntax, label = 'complete model fixture', options = {}) {
  let reason;
  if (!callee || !['function', 'method'].includes(callee.kind)) reason = 'missing-declaration';
  else if (callee.metadata?.partial === true || (callee.metadata?.kotlinDiagnosticCount ?? 0) > 0) reason = 'recovered-declaration';
  else if (['returns', 'effects'].some(field => !syntax?.[field] || syntax[field].syntaxOnly !== true
    || typeof syntax[field].limited !== 'boolean' || !Array.isArray(syntax[field].sites))) reason = 'missing-source-inventory';
  else if (options.requireCompleteInventories && ['returns', 'effects'].some(field => syntax[field].limited)) reason = 'limited-source-inventory';
  if (reason) throw new Error(`Invalid ${label}: ${reason}`);
}
