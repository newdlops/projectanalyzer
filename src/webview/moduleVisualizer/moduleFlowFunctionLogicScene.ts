/**
 * Pure browser-side adapter from Function Logic payloads to Module Flow scene
 * deltas. Function blocks stay browser-local view models and therefore do not
 * broaden the Host-facing module graph protocol or expose analyzer identities.
 */

import type {
  FunctionLogicBlockPayloadKind,
  FunctionLogicPayloadConfidence,
  FunctionLogicValueAccessPayload,
  FunctionLogicValueChangePayload
} from "../../protocol/functionLogic";
import type { ModuleFlowFunctionLogicPayload } from "../../protocol/moduleFlow";

/** One function-local card rendered by the shared Module Flow graph renderer. */
export type ModuleFlowLogicBlockSceneNode = {
  id: string;
  kind: "logicBlock";
  ownerFunctionId: string;
  blockKind: FunctionLogicBlockPayloadKind;
  label: string;
  detail: string;
  locationLabel?: string;
  branchLabel?: string;
  confidence: FunctionLogicPayloadConfidence;
  evidenceToken?: string;
  valueChanges: FunctionLogicValueChangePayload[];
  valueAccesses: FunctionLogicValueAccessPayload[];
  drillTargets: Array<{ name: string; qualifiedName: string; relation?: string }>;
  entryOrder: number;
};

/** Browser-local edge shape consumed by the existing routed SVG renderer. */
export type ModuleFlowLogicSceneEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  presentationKind: "functionEntry" | "controlFlow";
  controlKind: string;
  controlLabel?: string;
  relations: [];
  confidenceCounts: {
    exact: number;
    resolved: number;
    inferred: number;
    unresolved: number;
  };
  evidenceCount: number;
  omittedEvidenceCount: number;
  hasDetails: false;
  entryOrder: number;
};

/** Expansion-store payload created around one stable function-card anchor. */
export type ModuleFlowFunctionLogicScene = {
  graphVersion: string;
  requestId: number;
  anchorFunctionId: string;
  expansion: "functionLogic";
  nodes: ModuleFlowLogicBlockSceneNode[];
  edges: ModuleFlowLogicSceneEdge[];
  replacedEdgeIds: [];
  gaps: string[];
  summary: {
    candidateNodeCount: number;
    visibleNodeCount: number;
    omittedNodeCount: number;
    candidateEdgeCount: number;
    visibleEdgeCount: number;
    omittedEdgeCount: number;
  };
};

/**
 * Converts bounded logic blocks iteratively and adds one ownership-to-entry
 * route so the function graph forms a continuous branch of the module canvas.
 */
export function createModuleFlowFunctionLogicScene(
  payload: ModuleFlowFunctionLogicPayload
): ModuleFlowFunctionLogicScene {
  const blocks = Array.isArray(payload.logic?.blocks) ? payload.logic.blocks : [];
  const knownBlockIds = new Set(blocks.map((block) => block.id));
  const nodes = blocks.map((block, index) => ({
    id: block.id,
    kind: "logicBlock" as const,
    ownerFunctionId: payload.anchorFunctionId,
    blockKind: block.kind,
    label: block.label,
    detail: block.detail,
    ...(block.sourceLocation ? { locationLabel: block.sourceLocation } : {}),
    ...(block.branchLabel ? { branchLabel: block.branchLabel } : {}),
    confidence: block.confidence,
    ...(block.evidenceToken ? { evidenceToken: block.evidenceToken } : {}),
    valueChanges: [...(block.valueChanges ?? [])],
    valueAccesses: [...(block.valueAccesses ?? [])],
    drillTargets: (block.drillTargets ?? []).map((target) => ({
      name: target.name,
      qualifiedName: target.qualifiedName,
      ...(target.relation ? { relation: target.relation } : {})
    })),
    // A short bounded stagger makes the attached branch visibly grow without
    // delaying large graphs for hundreds of milliseconds.
    entryOrder: Math.min(index, 12)
  }));
  const controlEdges: ModuleFlowLogicSceneEdge[] = [];
  for (let index = 0; index < (payload.logic?.edges?.length ?? 0); index += 1) {
    const edge = payload.logic.edges[index];
    if (!edge || !knownBlockIds.has(edge.sourceId) || !knownBlockIds.has(edge.targetId)) {
      continue;
    }
    controlEdges.push({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      presentationKind: "controlFlow",
      controlKind: edge.kind,
      ...(edge.label ? { controlLabel: edge.label } : {}),
      relations: [],
      confidenceCounts: {
        exact: edge.confidence === "exact" ? 1 : 0,
        resolved: 0,
        inferred: edge.confidence === "inferred" ? 1 : 0,
        unresolved: 0
      },
      evidenceCount: 1,
      omittedEvidenceCount: 0,
      hasDetails: false,
      entryOrder: Math.min(index + 1, 12)
    });
  }

  const entry = blocks.find((block) => block.kind === "entry") ?? blocks[0];
  const attachmentEdges: ModuleFlowLogicSceneEdge[] = entry
    ? [{
        id: `${payload.anchorFunctionId}:logic-entry:${entry.id}`,
        sourceId: payload.anchorFunctionId,
        targetId: entry.id,
        presentationKind: "functionEntry",
        controlKind: "entry",
        controlLabel: "enters",
        relations: [],
        confidenceCounts: { exact: 1, resolved: 0, inferred: 0, unresolved: 0 },
        evidenceCount: 1,
        omittedEvidenceCount: 0,
        hasDetails: false,
        entryOrder: 0
      }]
    : [];
  const edges = [...attachmentEdges, ...controlEdges];
  const omittedEdgeCount = Math.max(0, payload.summary?.omittedEdgeCount ?? 0);

  return {
    graphVersion: payload.graphVersion,
    requestId: payload.requestId,
    anchorFunctionId: payload.anchorFunctionId,
    expansion: "functionLogic",
    nodes,
    edges,
    replacedEdgeIds: [],
    gaps: [...(payload.gaps ?? [])],
    summary: {
      candidateNodeCount: nodes.length,
      visibleNodeCount: nodes.length,
      omittedNodeCount: 0,
      candidateEdgeCount: edges.length + omittedEdgeCount,
      visibleEdgeCount: edges.length,
      omittedEdgeCount
    }
  };
}

/** Serializes the dependency-free adapter into the nonce Webview program. */
export function getModuleFlowFunctionLogicSceneBrowserSource(): string {
  return createModuleFlowFunctionLogicScene.toString();
}
