/**
 * Fallback declaration construction for static Tutor analysis.
 *
 * This module keeps parser-unavailable handling separate from the TypeScript
 * adapter so the public analyzer router stays small and failures retain the
 * source-backed Function Logic structure already available to the product.
 */

import type { SymbolNode } from "../../shared/types";
import type { FunctionLogicAnalysis, FunctionLogicBlock } from "../functionLogic";
import type {
  FunctionTutorDeclarationAnalysis,
  FunctionTutorGap,
  FunctionTutorProgramBlock
} from "./types";

/** Creates a bounded, explainable declaration result when source parsing is unavailable. */
export function createUnavailableFunctionTutorDeclaration(
  functionNode: SymbolNode,
  functionLogic: FunctionLogicAnalysis,
  summary: string
): FunctionTutorDeclarationAnalysis {
  const gap: FunctionTutorGap = { kind: "language-support", summary };
  const entry = functionLogic.blocks.find((block) => block.kind === "entry");
  return {
    functionNode,
    language: functionLogic.language,
    executionKind: "sync",
    parameters: [],
    constraints: [],
    program: {
      entryBlockId: entry?.id ?? functionLogic.blocks[0]?.id ?? "tutor-entry:unavailable",
      blocks: functionLogic.blocks.map(createEmptyFunctionTutorProgramBlock),
      edges: functionLogic.edges.map((edge) => ({
        edgeId: edge.id,
        sourceBlockId: edge.sourceId,
        targetBlockId: edge.targetId,
        kind: edge.kind,
        label: edge.label,
        certainty: edge.confidence
      })),
      bindings: [],
      gaps: [gap]
    },
    gaps: [gap]
  };
}

/** Preserves visible source identity for a graph block with no interpreter operation. */
function createEmptyFunctionTutorProgramBlock(block: FunctionLogicBlock): FunctionTutorProgramBlock {
  return {
    blockId: block.id,
    kind: block.kind,
    label: block.label,
    operations: [],
    embeddedRelation: block.kind === "embedded" ? "immediate" : undefined,
    evidence: [{
      kind: "fallback",
      certainty: block.confidence,
      filePath: block.filePath,
      range: block.range,
      summary: "Function Logic source block."
    }]
  };
}
