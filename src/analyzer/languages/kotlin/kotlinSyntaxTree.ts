/** Iterative tree queries and UTF-16 source positions shared by all Kotlin adapters. */
import type { SourceRange } from "../../../shared/types";
import type { KotlinSource, KotlinSyntaxNode } from "./kotlinSyntaxTypes";

/** Returns direct children as a caller-owned array. */
export function getKotlinChildren(node: KotlinSyntaxNode): KotlinSyntaxNode[] {
  return [...node.children];
}

/** Returns the first direct grammar-rule or terminal child with the supplied name. */
export function getKotlinChildNamed(node: KotlinSyntaxNode, name: string): KotlinSyntaxNode | undefined {
  return node.children.find((child) => child.name === name);
}

/** Finds descendants in source order using bounded, cycle-safe scope pruning. */
export function findKotlinDescendants(
  root: KotlinSyntaxNode,
  accept: (node: KotlinSyntaxNode) => boolean,
  prune?: (node: KotlinSyntaxNode) => boolean,
  maxDepth = 4096
): KotlinSyntaxNode[] {
  const matches: KotlinSyntaxNode[] = [];
  const pending = root.children.map((node) => ({ node, depth: 1 })).reverse();
  const visited = new Set<KotlinSyntaxNode>([root]);
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry || entry.depth > maxDepth || visited.has(entry.node)) continue;
    visited.add(entry.node);
    if (accept(entry.node)) matches.push(entry.node);
    if (prune?.(entry.node)) continue;
    for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: entry.node.children[index], depth: entry.depth + 1 });
    }
  }
  return matches;
}

/** Converts one grammar node's half-open UTF-16 span into a VS Code source range. */
export function kotlinNodeRange(source: KotlinSource, node: KotlinSyntaxNode): SourceRange {
  return kotlinOffsetsRange(source, node.from, node.to);
}

/** Converts arbitrary UTF-16 offsets, clamping malformed parser recovery spans. */
export function kotlinOffsetsRange(source: KotlinSource, from: number, to: number): SourceRange {
  const start = offsetPosition(source, from);
  const end = offsetPosition(source, to);
  return { startLine: start.line, startCharacter: start.character,
    endLine: end.line, endCharacter: end.character };
}

/** Converts a cursor position into the original source, excluding newline characters. */
export function kotlinPositionOffset(source: KotlinSource, position: { line: number; character: number }): number {
  const line = Math.max(0, Math.min(source.lineStarts.length - 1, finiteFloor(position.line)));
  const start = source.lineStarts[line] ?? 0;
  let end = source.lineStarts[line + 1] ?? source.text.length;
  while (end > start && (source.text[end - 1] === "\n" || source.text[end - 1] === "\r")) end -= 1;
  return Math.min(end, start + Math.max(0, finiteFloor(position.character)));
}

/** Returns the exact original text for one syntax fact, preserving comments and spacing. */
export function kotlinNodeText(source: KotlinSource, node: KotlinSyntaxNode): string {
  return source.text.slice(node.from, node.to);
}

/** Indexes LF, CRLF, and CR line starts once per source snapshot. */
export function collectKotlinLineStarts(text: string): readonly number[] {
  const starts = [0];
  for (let offset = 0; offset < text.length; offset += 1) {
    if (text[offset] === "\r") {
      if (text[offset + 1] === "\n") offset += 1;
      starts.push(offset + 1);
    } else if (text[offset] === "\n") {
      starts.push(offset + 1);
    }
  }
  return Object.freeze(starts);
}

/** Locates one offset with binary search over the immutable line-start index. */
function offsetPosition(source: KotlinSource, rawOffset: number): { line: number; character: number } {
  const offset = Math.max(0, Math.min(source.text.length, finiteFloor(rawOffset)));
  let low = 0;
  let high = source.lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (source.lineStarts[middle] > offset) high = middle - 1;
    else low = middle + 1;
  }
  const line = Math.max(0, high);
  return { line, character: offset - source.lineStarts[line] };
}

/** Keeps public range utilities deterministic for non-finite caller input. */
function finiteFloor(value: number): number {
  return Number.isFinite(value) ? Math.floor(value) : 0;
}
