/** Bounded syntax evidence from exact parser blocks preserves catch returns without granting CFG, value, or execution proof. */
import type { SourceRange, SymbolNode } from "../../shared/types";
import type { FunctionCallReturnRegion, FunctionCallReturnSyntax } from "../../shared/functionCallNarratives";
import { analyzeFunctionLogic, findFunctionAtPosition, type FunctionLogicBlock } from "../functionLogic";
import { readFunctionCallSourceRange } from "./sourceSyntax";

/** Read lexical returns owned by the selected declaration, excluding nested callable/embedded boundaries and retaining explicit limits. */
export function readFunctionCallReturnSyntax(callee: SymbolNode, source: string,
  options: { maxDepth?: number; maxSites?: number } = {}): FunctionCallReturnSyntax | undefined {
  if (!["function", "method"].includes(callee.kind) || !["typescript", "javascript", "kotlin", "python"].includes(callee.language)) return;
  const selected = readFunctionCallSourceRange(source, callee.selectionRange);
  // A same-named declaration elsewhere must never lend this symbol its syntax.
  if (!selected || selected.replace(/^`|`$/gu, "") !== callee.name) return;
  const declarationOwner = findFunctionAtPosition({ filePath: callee.filePath, languageId: callee.language, sourceText: source,
    position: { line: callee.selectionRange.startLine, character: callee.selectionRange.startCharacter } });
  // The general graph analyzer may recover by name from a stale position. This
  // stricter syntax API accepts only the actual authored declaration selection.
  if (!declarationOwner || declarationOwner.name !== callee.name || !sameRange(declarationOwner.selectionRange, callee.selectionRange)) return;
  const depth = bound(options.maxDepth, 32, 32), maxSites = bound(options.maxSites, 8, 8);
  const logic = analyzeFunctionLogic({ functionNode: callee, sourceText: source, maxBlocks: 128 });
  if (!logic.sourceRange || logic.gaps.some(g => ["sourceUnavailable", "functionNotFound", "languageUnsupported"].includes(g.code))) return;
  const blocks = new Map(logic.blocks.map(block => [block.id, block]));
  const result: FunctionCallReturnSyntax = { sites: [], limited: logic.gaps.some(g => !["parseLimited", "dynamicBehavior"].includes(g.code)
    || g.presentation?.key.endsWith("-limit")), syntaxOnly: true };
  // The common Python graph merges try-else into the normal try lane. Do not
  // advertise that lowered lane as complete lexical containment evidence.
  const declaration = readFunctionCallSourceRange(source, logic.sourceRange);
  if (callee.language === "python" && logic.blocks.some(block => block.kind === "try")
    && /^\s*else\s*:/mu.test(declaration ?? "")) result.limited = true;
  for (const block of logic.blocks) {
    if (block.kind === "unknown") result.limited = true;
    // Kotlin inline lambdas can contain a non-local return. A separate callable
    // region cannot establish which function a bare/labeled return completes.
    if (callee.language === "kotlin" && block.kind === "callable") result.limited = true;
    if (block.kind !== "return") continue;
    if (block.confidence !== "exact" || block.embeddedBoundaryId || !contains(logic.sourceRange, block.range)) {
      result.limited = true; continue;
    }
    const visited = new Set<string>();
    const regions: FunctionCallReturnRegion[] = [];
    let child = block, parent = block.parentBlockId, owned = true;
    while (parent) {
      if (visited.has(parent) || visited.size >= depth) { result.limited = true; owned = false; break; }
      visited.add(parent);
      const owner = blocks.get(parent);
      if (!owner) { result.limited = true; owned = false; break; }
      if (owner.kind === "callable" || owner.kind === "embedded" || owner.embeddedBoundaryId) { owned = false; break; }
      if ((owner.condition?.expression.length ?? 0) > 160 || (child.branchLabel?.length ?? 0) > 160) result.limited = true;
      if (owner.kind === "try" && child.branchPresentation?.key === "logic-edge-with") result.limited = true;
      const region = describeRegion(owner, child);
      if (region) regions.unshift(region);
      child = owner; parent = owner.parentBlockId;
    }
    if (!owned) continue;
    const code = readFunctionCallSourceRange(source, block.range)?.trim();
    if (!code || code.length > 160 || !/^return(?:\s|;|$)/u.test(code)) { result.limited = true; continue; }
    if (result.sites.length >= maxSites) { result.limited = true; continue; }
    // Keep authored operands and parentheses; no normalization, numeric example,
    // evaluation or inference about which abrupt return wins through finally.
    const expression = code.replace(/^return\b\s*/u, "").replace(/;\s*$/u, "").trim();
    result.sites.push({ code, ...(expression ? { expression } : {}), range: { ...block.range }, regions });
  }
  return result;
}

/** Control labels identify lexical containment only; an exception edge can stay inferred while its return statement is exact syntax. */
function describeRegion(owner: FunctionLogicBlock, child: FunctionLogicBlock): FunctionCallReturnRegion | undefined {
  const key = child.branchPresentation?.key;
  // Python except and elif use their own presentation keys. In particular an
  // elif label must not acquire the first if's predicate as its own expression.
  if (owner.kind === "condition" && ["logic-edge-elif", "logic-edge-else-if"].includes(key ?? "")) {
    return { kind: "control", ...(child.branchLabel && child.branchLabel.length <= 160 ? { label: child.branchLabel } : {}) };
  }
  const kind = owner.kind === "try" ? key === "logic-edge-catch" || key === "logic-edge-except" ? "catch"
    : key === "logic-edge-finally" ? "finally" : key === "logic-edge-with" ? "control" : "try"
    : owner.kind === "condition" ? key === "logic-edge-false" || key === "logic-edge-else-if" ? "else" : "then"
      : owner.kind === "loop" ? "loop" : owner.kind === "switch" ? "case" : undefined;
  if (!kind) return;
  const expression = owner.condition?.expression;
  const label = child.branchLabel;
  return { kind, ...(expression && expression.length <= 160 ? { expression } : {}), ...(label && label.length <= 160 ? { label } : {}) };
}

/** All bounds are counts; callers may reduce the closed evidence budget but cannot raise it. */
function bound(value: number | undefined, fallback: number, maximum: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.min(maximum, Math.floor(value)));
}
function contains(owner: SourceRange, site: SourceRange): boolean {
  return (owner.startLine < site.startLine || owner.startLine === site.startLine && owner.startCharacter <= site.startCharacter)
    && (owner.endLine > site.endLine || owner.endLine === site.endLine && owner.endCharacter >= site.endCharacter);
}
function sameRange(left: SourceRange, right: SourceRange): boolean {
  return left.startLine === right.startLine && left.startCharacter === right.startCharacter
    && left.endLine === right.endLine && left.endCharacter === right.endCharacter;
}
