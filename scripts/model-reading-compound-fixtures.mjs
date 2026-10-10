/** Offline compound-control supervision sources. Runtime inference never imports these synthetic fixtures or labels. */

const comparisons = Object.freeze(['<', '<=', '>', '>=']);
const operators = Object.freeze(['+', '-', '*', '/']);
const pools = Object.freeze({
  training: Object.freeze({
    names: Object.freeze([
      Object.freeze({ parent: 'relayN', callee: 'reshapeN', arg: 'sentN', parameter: 'pN', side: 'visitN' }),
      Object.freeze({ parent: 'forwardQ', callee: 'deriveQ', arg: 'inQ', parameter: 'qX', side: 'examineQ' })
    ]),
    thresholds: Object.freeze([-17, 0, 23, -29]),
    early: Object.freeze([-11, 19, 31, -37]),
    caught: Object.freeze([-23, 41, -47, 53]),
    operands: Object.freeze([7, 13])
  }),
  valid: Object.freeze({
    names: Object.freeze([
      Object.freeze({ parent: 'carryS', callee: 'adaptS', arg: 'atS', parameter: 'rV', side: 'touchS' })
    ]),
    thresholds: Object.freeze([-43, 0, 47, -59]),
    early: Object.freeze([-13, 29, 61, -67]),
    caught: Object.freeze([-19, 71, -73, 79]),
    operands: Object.freeze([11, 17])
  })
});
const kinds = Object.freeze(['combined', 'partial', 'missing']);

/** OA(16,5,4,2): every pair of semantic factors covers all 16 level pairs.
 * GF(4) multiplication by 2/3 supplies distinct slopes. This is pairwise
 * coverage, not the 4^5 Cartesian product. Names and operands cross every row.
 */
function factorLevels(matrixRow) {
  const a = matrixRow >>> 2, b = matrixRow & 3;
  const twice = [0, 2, 3, 1], thrice = [0, 3, 1, 2];
  return Object.freeze({
    comparison: a, threshold: b, operator: a ^ b,
    early: a ^ twice[b], caught: a ^ thrice[b]
  });
}

/** Reject unsupported or noncanonical recipes instead of creating repeated unavailable-source examples. */
function assertDescriptor(kind, descriptor) {
  const { split, nameFamily, operandLevel, matrixRow } = descriptor ?? {};
  const pool = pools[split];
  if (!kinds.includes(kind) || !pool || !Number.isInteger(nameFamily)
    || nameFamily < 0 || nameFamily >= pool.names.length
    || !Number.isInteger(operandLevel) || operandLevel < 0 || operandLevel >= pool.operands.length
    || !Number.isInteger(matrixRow) || matrixRow < 0 || matrixRow >= 16
    || (kind !== 'combined' && operandLevel !== 0) || (kind === 'missing' && matrixRow !== 0)) {
    throw new TypeError('Unknown canonical compound fixture');
  }
  return pool;
}

/** Enumerate each distinct source once. Partial sources omit the unused operand dimension; missing sources omit both. */
export function compoundCases(split, kind = 'combined') {
  const pool = pools[split];
  if (!pool || !kinds.includes(kind)) throw new TypeError('Unknown compound fixture group');
  const result = [];
  for (let nameFamily = 0; nameFamily < pool.names.length; nameFamily++) {
    for (let operandLevel = 0; operandLevel < (kind === 'combined' ? pool.operands.length : 1); operandLevel++) {
      for (let matrixRow = 0; matrixRow < (kind === 'missing' ? 1 : 16); matrixRow++) {
        result.push(Object.freeze({ split, nameFamily, operandLevel, matrixRow }));
      }
    }
  }
  return Object.freeze(result);
}

/** Render valid complete sources or explicitly unavailable counterparts with the same names.
 * The partial counterpart is a visibly unfinished direct if/return declaration,
 * not a claimed prefix of the complete try body. Numeric expressions remain
 * symbolic; parser-owned source facts do not prove runtime effects or completion.
 */
export function compoundSpec(kind, language, descriptor) {
  const pool = assertDescriptor(kind, descriptor);
  if (!['typescript', 'kotlin'].includes(language)) throw new TypeError('Unsupported compound source language');
  const levels = factorLevels(descriptor.matrixRow), names = pool.names[descriptor.nameFamily];
  const { parent, callee, arg, parameter, side } = names;
  const kt = language === 'kotlin', semi = kt ? '' : ';';
  const predicate = `${parameter} ${comparisons[levels.comparison]} ${pool.thresholds[levels.threshold]}`;
  const calculation = `${parameter} ${operators[levels.operator]} ${pool.operands[descriptor.operandLevel]}`;
  const early = String(pool.early[levels.early]), alternative = String(pool.caught[levels.caught]);
  const cleanup = `${side}(${parameter})`;
  const caller = kt ? `fun ${parent}(${arg}: Int): Int { return ${callee}(${arg}) }`
    : `function ${parent}(${arg}: number): number { return ${callee}(${arg}); }`;
  const header = kt ? `fun ${callee}(${parameter}: Int): Int {` : `function ${callee}(${parameter}: number): number {`;
  // Keep the newline after the closed if block: Kotlin's next return requires
  // a real statement boundary; parser recovery must never become supervision.
  const body = `if (${predicate}) { return ${early}${semi} }`;
  const helper = kind === 'missing' ? undefined : kind === 'partial' ? `${header} ${body}`
    : `${header}\ntry { ${body}\nreturn ${calculation}${semi} } catch (${kt ? 'error: Exception' : 'error'}) { return ${alternative}${semi} } finally { ${cleanup}${semi} }\n}`;
  return Object.freeze({ kind, language, ...names, predicate, calculation, early, alternative, cleanup, caller, helper, levels });
}
