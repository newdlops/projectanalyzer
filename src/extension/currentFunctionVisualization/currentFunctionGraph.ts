/**
 * Pure graph adaptation for editor-originated function visualization. It reuses
 * an analyzed callable when possible and adds one exact AST-backed node when the
 * low-level analyzer did not model the selected declaration or callback.
 */

import type { FunctionCursorTarget } from "../../analyzer/functionLogic";
import { createEdgeId, createNodeId } from "../../shared/ids";
import type { GraphEdge, ProjectGraph, SymbolNode } from "../../shared/types";

/** Graph and callable identity ready for the existing CodeFlow delivery path. */
export type CurrentFunctionGraphResolution = {
  graph: ProjectGraph;
  node: SymbolNode;
  augmented: boolean;
};

/** Resolves the cursor target against analysis or appends an exact local node. */
export function resolveCurrentFunctionGraph(
  graph: ProjectGraph,
  target: FunctionCursorTarget
): CurrentFunctionGraphResolution {
  const analyzedNode = findAnalyzedCallable(graph, target);
  if (analyzedNode) {
    return { graph, node: analyzedNode, augmented: false };
  }

  const fileNode = graph.nodes.find((node) =>
    node.kind === "file" && sameFilePath(node.filePath, target.filePath)
  );
  const node = createCursorFunctionNode(target, fileNode?.id);
  const containsEdge = fileNode ? createContainsEdge(fileNode.id, node) : undefined;
  const edges = containsEdge ? [...graph.edges, containsEdge] : graph.edges;
  const augmentedGraph: ProjectGraph = {
    ...graph,
    nodes: [...graph.nodes, node],
    edges,
    metadata: {
      ...graph.metadata,
      symbolCount: graph.metadata.symbolCount + 1,
      edgeCount: edges.length
    }
  };
  return { graph: augmentedGraph, node, augmented: true };
}

/** Finds only concrete callable symbols tied to the same source declaration. */
function findAnalyzedCallable(
  graph: ProjectGraph,
  target: FunctionCursorTarget
): SymbolNode | undefined {
  const candidates = graph.nodes.filter((node) =>
    isConcreteCallable(node)
    && sameFilePath(node.filePath, target.filePath)
    && (
      sameRangeStart(node.selectionRange, target.selectionRange)
      || (
        node.name === target.name
        && node.selectionRange.startLine === target.selectionRange.startLine
      )
    )
  );

  candidates.sort((left, right) =>
    Number(sameRangeStart(right.selectionRange, target.selectionRange))
      - Number(sameRangeStart(left.selectionRange, target.selectionRange))
    || Number(right.name === target.name) - Number(left.name === target.name)
    || Math.abs(left.selectionRange.startCharacter - target.selectionRange.startCharacter)
      - Math.abs(right.selectionRange.startCharacter - target.selectionRange.startCharacter)
  );
  return candidates[0];
}

/** Creates a stable symbol explicitly marked as current-source AST evidence. */
function createCursorFunctionNode(
  target: FunctionCursorTarget,
  parentId: string | undefined
): SymbolNode {
  return {
    id: createNodeId([
      "cursor-function",
      target.filePath,
      target.kind,
      target.qualifiedName,
      String(target.selectionRange.startLine),
      String(target.selectionRange.startCharacter)
    ]),
    kind: target.kind,
    name: target.name,
    qualifiedName: target.qualifiedName,
    filePath: target.filePath,
    range: target.range,
    selectionRange: target.selectionRange,
    language: target.language,
    parentId,
    metadata: {
      cursorResolved: true,
      anonymous: target.anonymous,
      syntaxEvidence: "typescriptCompilerAst"
    }
  };
}

/** Adds normal graph containment without claiming a call relationship. */
function createContainsEdge(parentId: string, node: SymbolNode): GraphEdge {
  return {
    id: createEdgeId("contains", parentId, node.id),
    kind: "contains",
    sourceId: parentId,
    targetId: node.id,
    filePath: node.filePath,
    range: node.range,
    confidence: "exact"
  };
}

/** Restricts direct visualization to source-backed callable node kinds. */
function isConcreteCallable(node: SymbolNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Compares analyzer and editor paths after separator normalization. */
function sameFilePath(left: string, right: string): boolean {
  const normalizedLeft = left.replace(/\\/gu, "/");
  const normalizedRight = right.replace(/\\/gu, "/");
  return normalizedLeft === normalizedRight;
}

/** Tests the source identity anchor without requiring equal declaration ends. */
function sameRangeStart(
  left: SymbolNode["selectionRange"],
  right: FunctionCursorTarget["selectionRange"]
): boolean {
  return left.startLine === right.startLine && left.startCharacter === right.startCharacter;
}
