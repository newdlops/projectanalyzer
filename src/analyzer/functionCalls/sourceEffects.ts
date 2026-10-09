/** Explicit write/call syntax from one exact callee snapshot, with source occurrence and lexical-region ownership. */
import type { SourceRange, SymbolNode } from "../../shared/types";
import type { FunctionCallEffectSyntax, FunctionCallReturnSyntax } from "../../shared/functionCallNarratives";
import type { FunctionLogicBlock } from "../functionLogic";
import { readFunctionCallSourceRange } from "./sourceSyntax";
import { boundSyntaxCount, containsSourceRange, readFunctionCallSyntaxEvidence, type FunctionCallSyntaxEvidence } from "./sourceEvidence";
import { collectFunctionCallReturns } from "./sourceReturns";

/** Public combined API parses the declaration once; neither inventory evaluates source or grants completion/effect proof. */
export function readFunctionCallSourceSyntax(callee: SymbolNode, source: string,
  options: { maxDepth?: number; maxReturnSites?: number; maxEffectSites?: number } = {}):
  { returns: FunctionCallReturnSyntax; effects: FunctionCallEffectSyntax } | undefined {
  const evidence = readFunctionCallSyntaxEvidence(callee, source, options.maxDepth);
  if (!evidence) return;
  return { returns: collectFunctionCallReturns(evidence, source, options.maxReturnSites),
    effects: collectFunctionCallEffects(evidence, source, options.maxEffectSites) };
}

/** Immediate authored syntax only; callable/embedded/dynamic omissions preserve the original model field. */
function collectFunctionCallEffects(evidence: FunctionCallSyntaxEvidence, source: string, maxSites?: number): FunctionCallEffectSyntax {
  const { logic } = evidence;
  const result: FunctionCallEffectSyntax = { sites: [], limited: evidence.limited
    || logic.blocks.some(block => ["callable", "embedded"].includes(block.kind)
      // Writes inside predicates/returns/arguments are not standalone mutation
      // blocks. Their incomplete ranges must not become a no-write inventory.
      || block.kind !== "mutation" && block.valueChanges?.some(change => change.confidence === "exact")), syntaxOnly: true };
  const maximum = boundSyntaxCount(maxSites, 8, 8), occurrences = new Set<string>();
  const add = (kind: "write" | "call", range: SourceRange, block: FunctionLogicBlock) => {
    const ownership = evidence.regions(block);
    if (!ownership.owned || ownership.limited || block.confidence !== "exact") { result.limited = true; return; }
    const code = readFunctionCallSourceRange(source, range)?.trim();
    if (!code || code.length > 160 || !containsSourceRange(logic.sourceRange!, range)) { result.limited = true; return; }
    const key = [kind, range.startLine, range.startCharacter, range.endLine, range.endCharacter].join(":");
    if (occurrences.has(key)) return;
    occurrences.add(key);
    if (result.sites.length >= maximum) { result.limited = true; return; }
    result.sites.push({ kind, code, range: { ...range }, regions: ownership.regions });
  };
  for (const block of logic.blocks) if (block.kind === "mutation") add("write", block.range, block);
  for (const site of logic.callsites) {
    if (site.relation && site.relation !== "call" || site.confidence && site.confidence !== "exact") { result.limited = true; continue; }
    const owner = logic.blocks.filter(block => !["entry", "exit"].includes(block.kind) && containsSourceRange(block.range, site.range))
      .sort((left, right) => right.depth - left.depth || span(left.range) - span(right.range))[0];
    if (!owner) { result.limited = true; continue; }
    add("call", site.range, owner);
  }
  // Declaration starts can precede an embedded call's position. This sort is
  // lexical source order, never an invented evaluation/execution sequence.
  result.sites.sort((left, right) => left.range.startLine - right.range.startLine || left.range.startCharacter - right.range.startCharacter
    || left.range.endLine - right.range.endLine || left.range.endCharacter - right.range.endCharacter || left.kind.localeCompare(right.kind));
  return result;
}
function span(range: SourceRange): number { return (range.endLine - range.startLine) * 100000 + range.endCharacter - range.startCharacter; }
