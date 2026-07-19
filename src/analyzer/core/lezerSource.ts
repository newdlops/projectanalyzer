/**
 * Shared Lezer source adapter. It converts parser offsets to the UTF-16
 * line/character ranges used by VS Code and exposes only iterative tree helpers.
 */

import type { Parser, SyntaxNode, Tree } from "@lezer/common";
import type { SourceRange } from "../../shared/types";

/** Zero-based source position shared by cursor and range adapters. */
export type LezerSourcePosition = {
  line: number;
  character: number;
};

/** Immutable parsed source snapshot used by Python and Java adapters. */
export type LezerSource = {
  text: string;
  tree: Tree;
  lineStarts: number[];
};

/** Parses one source string and indexes every line start once. */
export function createLezerSource(parser: Parser, text: string): LezerSource {
  return {
    text,
    tree: parser.parse(text),
    lineStarts: collectLineStarts(text)
  };
}

/** Converts a syntax-node span into the shared zero-based source range. */
export function lezerNodeRange(source: LezerSource, node: SyntaxNode): SourceRange {
  return lezerOffsetsRange(source, node.from, node.to);
}

/** Converts an arbitrary parser-offset span into a shared source range. */
export function lezerOffsetsRange(
  source: LezerSource,
  from: number,
  to: number
): SourceRange {
  const start = offsetToPosition(source.lineStarts, from);
  const end = offsetToPosition(source.lineStarts, to);
  return {
    startLine: start.line,
    startCharacter: start.character,
    endLine: end.line,
    endCharacter: end.character
  };
}

/** Converts an editor position to a clamped Lezer/JavaScript string offset. */
export function lezerPositionOffset(
  source: LezerSource,
  position: LezerSourcePosition
): number {
  const line = Math.min(
    Math.max(0, Math.floor(position.line)),
    Math.max(0, source.lineStarts.length - 1)
  );
  const lineStart = source.lineStarts[line] ?? 0;
  const nextLineStart = source.lineStarts[line + 1] ?? source.text.length;
  return Math.min(
    nextLineStart,
    lineStart + Math.max(0, Math.floor(position.character))
  );
}

/** Returns one exact source slice for a parser node. */
export function lezerNodeText(source: LezerSource, node: SyntaxNode): string {
  return source.text.slice(node.from, node.to);
}

/** Returns immediate syntax children without recursive cursor traversal. */
export function getLezerChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  let child = node.firstChild;
  while (child) {
    children.push(child);
    child = child.nextSibling;
  }
  return children;
}

/** Returns all immediate children with one grammar node name. */
export function getLezerChildrenNamed(
  node: SyntaxNode,
  name: string
): SyntaxNode[] {
  return getLezerChildren(node).filter((child) => child.name === name);
}

/** Returns the first immediate child with one grammar node name. */
export function getLezerChildNamed(
  node: SyntaxNode,
  name: string
): SyntaxNode | undefined {
  let child = node.firstChild;
  while (child) {
    if (child.name === name) {
      return child;
    }
    child = child.nextSibling;
  }
  return undefined;
}

/**
 * Finds descendants using an explicit stack. A prune predicate prevents calls
 * or symbols inside nested callables from leaking into the selected function.
 */
export function findLezerDescendants(
  root: SyntaxNode,
  accept: (node: SyntaxNode) => boolean,
  prune?: (node: SyntaxNode) => boolean
): SyntaxNode[] {
  const matches: SyntaxNode[] = [];
  const pending = getLezerChildren(root).reverse();

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (accept(node)) {
      matches.push(node);
    }
    if (prune?.(node)) {
      continue;
    }
    const children = getLezerChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return matches;
}

/** Reports whether error recovery occurred inside one selected source span. */
export function hasLezerError(root: SyntaxNode): boolean {
  const pending: SyntaxNode[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (node.type.isError) {
      return true;
    }
    const children = getLezerChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return false;
}

/** Normalizes multiline syntax without discarding source-owned graph text. */
export function normalizeLezerText(
  value: string,
  fallback: string
): string {
  return value.replace(/\s+/gu, " ").trim() || fallback;
}

/** Normalizes multiline syntax into a bounded non-graph display label. */
export function compactLezerText(
  value: string,
  fallback: string,
  limit = 180
): string {
  const normalized = normalizeLezerText(value, fallback);
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

/** Indexes CRLF and LF source without changing UTF-16 character semantics. */
function collectLineStarts(text: string): number[] {
  const starts = [0];
  for (let offset = 0; offset < text.length; offset += 1) {
    if (text.charCodeAt(offset) === 10) {
      starts.push(offset + 1);
    }
  }
  return starts;
}

/** Locates an offset with binary search over monotonically increasing lines. */
function offsetToPosition(
  lineStarts: readonly number[],
  rawOffset: number
): LezerSourcePosition {
  const offset = Math.max(0, Math.floor(rawOffset));
  let low = 0;
  let high = Math.max(0, lineStarts.length - 1);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const start = lineStarts[middle] ?? 0;
    const next = lineStarts[middle + 1] ?? Number.MAX_SAFE_INTEGER;
    if (offset < start) {
      high = middle - 1;
    } else if (offset >= next) {
      low = middle + 1;
    } else {
      return { line: middle, character: offset - start };
    }
  }
  const line = Math.max(0, Math.min(high, lineStarts.length - 1));
  return { line, character: offset - (lineStarts[line] ?? 0) };
}
