/** Bounded lexical returns preserve catch operands without proving values, selected paths or finally completion. */
import type { SymbolNode } from "../../shared/types";
import type { FunctionCallReturnSyntax } from "../../shared/functionCallNarratives";
import { readFunctionCallSourceRange } from "./sourceSyntax";
import { boundSyntaxCount, readFunctionCallSyntaxEvidence, type FunctionCallSyntaxEvidence } from "./sourceEvidence";

/** Standalone public reader; contexts also needing effects use the combined source-syntax API. */
export function readFunctionCallReturnSyntax(callee: SymbolNode, source: string,
  options: { maxDepth?: number; maxSites?: number } = {}): FunctionCallReturnSyntax | undefined {
  const evidence = readFunctionCallSyntaxEvidence(callee, source, options.maxDepth);
  return evidence && collectFunctionCallReturns(evidence, source, options.maxSites);
}

/** Internal collector shares one parsed snapshot and retains each identical-text source occurrence. */
export function collectFunctionCallReturns(evidence: FunctionCallSyntaxEvidence, source: string, maxSites?: number): FunctionCallReturnSyntax {
  const result: FunctionCallReturnSyntax = { sites: [], limited: evidence.limited, syntaxOnly: true };
  const maximum = boundSyntaxCount(maxSites, 8, 8);
  for (const block of evidence.logic.blocks) {
    if (block.kind !== "return") continue;
    if (block.confidence !== "exact") { result.limited = true; continue; }
    const ownership = evidence.regions(block);
    result.limited ||= ownership.limited;
    if (!ownership.owned) continue;
    const code = readFunctionCallSourceRange(source, block.range)?.trim();
    if (!code || code.length > 160 || !/^return(?:\s|;|$)/u.test(code)) { result.limited = true; continue; }
    if (result.sites.length >= maximum) { result.limited = true; continue; }
    const expression = code.replace(/^return\b\s*/u, "").replace(/;\s*$/u, "").trim();
    result.sites.push({ code, ...(expression ? { expression } : {}), range: { ...block.range }, regions: ownership.regions });
  }
  return result;
}
