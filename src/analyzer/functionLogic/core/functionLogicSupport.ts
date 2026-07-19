/**
 * Parser-independent helpers shared by Python and Java Function Logic adapters.
 * They own bounded identities, summary counts, synthetic blocks, and effect cues.
 */

import { createContentHash } from "../../../shared/hash";
import type { SourceRange, SymbolNode } from "../../../shared/types";
import type {
  FunctionLogicAnalysis,
  FunctionLogicBlock,
  FunctionLogicBlockKind,
  FunctionLogicGap,
  FunctionLogicLanguage,
  FunctionLogicSummary
} from "../types";

const DEFAULT_MAX_BLOCKS = 120;
const ALLOWED_MAX_BLOCKS = 300;

/** Bounds caller configuration to the documented Function Logic budget. */
export function normalizeFunctionLogicMaxBlocks(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_BLOCKS;
  }
  return Math.min(ALLOWED_MAX_BLOCKS, Math.max(1, Math.floor(value ?? DEFAULT_MAX_BLOCKS)));
}

/** Creates a stable syntax-backed block identity. */
export function createFunctionLogicBlockId(
  filePath: string,
  kind: FunctionLogicBlockKind,
  range: SourceRange,
  label: string
): string {
  const key = [
    filePath,
    kind,
    range.startLine,
    range.startCharacter,
    range.endLine,
    range.endCharacter,
    label
  ].join("\0");
  return `logic-block:${createContentHash(key).slice(0, 32)}`;
}

/** Creates an exact synthetic entry or exit anchored to source evidence. */
export function createSyntheticFunctionLogicBlock(
  node: SymbolNode,
  kind: "entry" | "exit",
  label: string,
  detail: string,
  range: SourceRange
): FunctionLogicBlock {
  return {
    id: createFunctionLogicBlockId(node.filePath, kind, range, label),
    kind,
    label,
    detail,
    depth: 0,
    confidence: "exact",
    filePath: node.filePath,
    range
  };
}

/** Returns a zero-width location at the end of a callable body. */
export function createFunctionLogicEndRange(range: SourceRange): SourceRange {
  return {
    startLine: range.endLine,
    startCharacter: range.endCharacter,
    endLine: range.endLine,
    endCharacter: range.endCharacter
  };
}

/** Derives visible counts without implying omitted runtime behavior. */
export function createFunctionLogicSummary(
  blocks: FunctionLogicBlock[],
  callsiteCount?: number
): FunctionLogicSummary {
  return {
    blockCount: blocks.length,
    branchCount: blocks.filter((block) =>
      block.kind === "condition" || block.kind === "switch"
    ).length,
    loopCount: blocks.filter((block) => block.kind === "loop").length,
    callCount: callsiteCount
      ?? blocks.filter((block) => block.kind === "call" || block.kind === "effect").length,
    effectCount: blocks.filter((block) => block.kind === "effect").length,
    mutationCount: blocks.filter((block) => block.kind === "mutation").length,
    exitCount: blocks.filter((block) =>
      block.kind === "return" || block.kind === "throw"
    ).length
  };
}

/** Creates a truthful unavailable result instead of a relationship-only graph. */
export function createUnavailableFunctionLogicAnalysis(
  functionNode: SymbolNode,
  language: FunctionLogicLanguage,
  code: FunctionLogicGap["code"],
  message: string
): FunctionLogicAnalysis {
  return {
    functionNode,
    language,
    signature: functionNode.qualifiedName || functionNode.name,
    blocks: [],
    edges: [],
    callsites: [],
    gaps: [{ code, message }],
    summary: createFunctionLogicSummary([])
  };
}

/** Conservative naming cue used only to style possible external/state effects. */
export function isPotentialFunctionEffectCall(value: string): boolean {
  const segment = value.split(".").at(-1)?.toLowerCase() ?? value.toLowerCase();
  return /^(?:add|append|apply|commit|create|delete|dispatch|emit|enqueue|execute|insert|log|notify|persist|post|publish|put|remove|save|send|set|store|update|write)/u
    .test(segment);
}
