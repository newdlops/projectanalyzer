/** Matches parser expressions to source-owned CFG predicates, preserving short-circuit groups. */
import * as ts from "typescript";
import type { SourceRange } from "../../shared/types";
import type { FunctionLogicBlock } from "../functionLogic";
import { toSourceRange } from "../functionLogic/typescriptFunctionLogicSyntax";

/** Maps each expanded predicate to its original AST leaf, never a parsed display label. */
export function findTutorPredicateBlocks(sourceFile: ts.SourceFile, expression: ts.Expression, blocks: FunctionLogicBlock[]): Array<{ block: FunctionLogicBlock; expression: ts.Expression }> {
  const range = toSourceRange(sourceFile, expression);
  const normalize = (text: string): string => text.replace(/\s+/gu, " ").trim();
  const text = normalize(expression.getText(sourceFile));
  const root = blocks.filter((block) => block.condition?.root && rangeOverlaps(range, block.range)
    && normalize(block.condition.groupExpression ?? block.condition.expression) === text)
    .sort((a, b) => rangeArea(a.range) - rangeArea(b.range))[0];
  if (!root?.condition) return [];
  const expressions: ts.Expression[] = [];
  const queue: ts.Node[] = [expression]; const visited = new Set<ts.Node>();
  for (let cursor = 0; cursor < queue.length && cursor < 256; cursor += 1) {
    const node = queue[cursor];
    if (visited.has(node)) continue;
    visited.add(node);
    if (ts.isExpression(node)) expressions.push(node);
    if (node !== expression && ts.isFunctionLike(node)) continue;
    ts.forEachChild(node, (child) => { queue.push(child); });
  }
  return blocks.filter((block) => block.condition?.groupId === root.condition!.groupId).flatMap((block) => {
    const matches = expressions.filter((node) => normalize(node.getText(sourceFile)) === normalize(block.condition!.expression)
      && rangeOverlaps(toSourceRange(sourceFile, node), block.range));
    // Repeated equal predicates are resolved by their original source positions.
    matches.sort((a, b) => Math.abs(position(toSourceRange(sourceFile, a)) - position(block.range))
      - Math.abs(position(toSourceRange(sourceFile, b)) - position(block.range)));
    return matches[0] ? [{ block, expression: matches[0] }] : [];
  });
}

export function findMatchingLogicBlock(sourceFile: ts.SourceFile, node: ts.Node, blocks: FunctionLogicBlock[], kind: string): FunctionLogicBlock | undefined {
  const range = toSourceRange(sourceFile, node);
  return blocks.filter((block) => block.kind === kind && rangeOverlaps(range, block.range))
    .sort((a, b) => rangeArea(a.range) - rangeArea(b.range) || a.id.localeCompare(b.id))[0];
}
export function rangeOverlaps(left: SourceRange, right: SourceRange | undefined): boolean {
  return !right || position(left) <= right.endLine * 1_000_000 + right.endCharacter
    && position(right) <= left.endLine * 1_000_000 + left.endCharacter;
}
export function rangeArea(range: SourceRange): number { return (range.endLine - range.startLine) * 1_000_000 + range.endCharacter - range.startCharacter; }
function position(range: SourceRange): number { return range.startLine * 1_000_000 + range.startCharacter; }
