/** Shared exact declaration and iterative lexical owners; syntax grants neither CFG completion nor runtime effects. */
import type { SourceRange, SymbolNode } from "../../shared/types";
import type { FunctionCallReturnRegion } from "../../shared/functionCallNarratives";
import { analyzeFunctionLogic, findFunctionAtPosition, type FunctionLogicAnalysis, type FunctionLogicBlock } from "../functionLogic";
import { readFunctionCallSourceRange } from "./sourceSyntax";

/** Internal parsed snapshot reused by return/effect collectors, with closed count/depth budgets. */
export type FunctionCallSyntaxEvidence = { logic: FunctionLogicAnalysis; limited: boolean;
  regions(block: FunctionLogicBlock): { owned: boolean; limited: boolean; regions: FunctionCallReturnRegion[] } };

/** Exact authored declaration identity prevents the general analyzer's name recovery from lending another occurrence its syntax. */
export function readFunctionCallSyntaxEvidence(callee: SymbolNode, source: string, maxDepth?: number): FunctionCallSyntaxEvidence | undefined {
  if (!["function", "method"].includes(callee.kind) || !["typescript", "javascript", "kotlin", "python"].includes(callee.language)) return;
  const selected = readFunctionCallSourceRange(source, callee.selectionRange);
  if (!selected || selected.replace(/^`|`$/gu, "") !== callee.name) return;
  const declarationOwner = findFunctionAtPosition({ filePath: callee.filePath, languageId: callee.language, sourceText: source,
    position: { line: callee.selectionRange.startLine, character: callee.selectionRange.startCharacter } });
  if (!declarationOwner || declarationOwner.name !== callee.name || !sameSourceRange(declarationOwner.selectionRange, callee.selectionRange)) return;
  const logic = analyzeFunctionLogic({ functionNode: callee, sourceText: source, maxBlocks: 128 });
  if (!logic.sourceRange || logic.gaps.some(g => ["sourceUnavailable", "functionNotFound", "languageUnsupported"].includes(g.code))) return;
  const blocks = new Map(logic.blocks.map(block => [block.id, block])), depth = boundSyntaxCount(maxDepth, 32, 32);
  const declaration = readFunctionCallSourceRange(source, logic.sourceRange);
  const limited = logic.gaps.some(g => !["parseLimited", "dynamicBehavior"].includes(g.code) || g.presentation?.key.endsWith("-limit"))
    || logic.blocks.some(block => block.kind === "unknown" || callee.language === "kotlin" && block.kind === "callable")
    // Python's common graph merges try-else into the normal try lane.
    || callee.language === "python" && logic.blocks.some(block => block.kind === "try") && /^\s*else\s*:/mu.test(declaration ?? "");
  return { logic, limited, regions(block) {
    let child = block, parent = block.parentBlockId, partial = false;
    const visited = new Set<string>(), regions: FunctionCallReturnRegion[] = [];
    if (block.embeddedBoundaryId || !containsSourceRange(logic.sourceRange!, block.range)) return { owned: false, limited: true, regions };
    while (parent) {
      if (visited.has(parent) || visited.size >= depth) return { owned: false, limited: true, regions };
      visited.add(parent);
      const owner = blocks.get(parent);
      if (!owner) return { owned: false, limited: true, regions };
      if (owner.kind === "callable" || owner.kind === "embedded" || owner.embeddedBoundaryId) return { owned: false, limited: partial, regions };
      if ((owner.condition?.expression.length ?? 0) > 160 || (child.branchLabel?.length ?? 0) > 160
        || owner.kind === "try" && child.branchPresentation?.key === "logic-edge-with") partial = true;
      const region = describeRegion(owner, child);
      if (region) regions.unshift(region);
      child = owner; parent = owner.parentBlockId;
    }
    return { owned: true, limited: partial, regions };
  } };
}

/** Language-specific branch keys identify lexical containment, not selected execution or another branch's predicate. */
function describeRegion(owner: FunctionLogicBlock, child: FunctionLogicBlock): FunctionCallReturnRegion | undefined {
  const key = child.branchPresentation?.key;
  if (owner.kind === "condition" && ["logic-edge-elif", "logic-edge-else-if"].includes(key ?? "")) {
    return { kind: "control", ...(child.branchLabel && child.branchLabel.length <= 160 ? { label: child.branchLabel } : {}) };
  }
  const kind = owner.kind === "try" ? key === "logic-edge-catch" || key === "logic-edge-except" ? "catch"
    : key === "logic-edge-finally" ? "finally" : key === "logic-edge-with" ? "control" : "try"
    : owner.kind === "condition" ? key === "logic-edge-false" ? "else" : "then"
      : owner.kind === "loop" ? "loop" : owner.kind === "switch" ? "case" : undefined;
  if (!kind) return;
  const expression = owner.condition?.expression, label = child.branchLabel;
  return { kind, ...(expression && expression.length <= 160 ? { expression } : {}), ...(label && label.length <= 160 ? { label } : {}) };
}

/** Callers may reduce budgets, never increase them beyond the evidence contract. */
export function boundSyntaxCount(value: number | undefined, fallback: number, maximum: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.min(maximum, Math.floor(value)));
}
export function containsSourceRange(owner: SourceRange, site: SourceRange): boolean {
  return (owner.startLine < site.startLine || owner.startLine === site.startLine && owner.startCharacter <= site.startCharacter)
    && (owner.endLine > site.endLine || owner.endLine === site.endLine && owner.endCharacter >= site.endCharacter);
}
export function sameSourceRange(left: SourceRange, right: SourceRange): boolean {
  return left.startLine === right.startLine && left.startCharacter === right.startCharacter
    && left.endLine === right.endLine && left.endCharacter === right.endCharacter;
}
