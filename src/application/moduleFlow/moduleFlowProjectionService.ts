/**
 * Bounded Host-to-Webview projection for project-level Module Flow.
 *
 * The service retains the complete module index and raw graph only in Host
 * memory. Browser payloads contain display-safe text, exact omitted counts, and
 * snapshot-local opaque identities. All graph walks are iterative and bounded.
 */

import { createSourceDisplayFormatter } from "../sourcePresentation";
import {
  createProjectModuleIndex,
  type ProjectModule,
  type ProjectModuleIndex
} from "../../insights/projectModules";
import type {
  ModuleFlowDetailRequest,
  ModuleFlowDetailPayload,
  ModuleFlowEdgeDetailPayload,
  ModuleFlowEdgeId,
  ModuleFlowEdgePayload,
  ModuleFlowEvidencePayload,
  ModuleFlowEvidenceToken,
  ModuleFlowExpandPayload,
  ModuleFlowExpandRequest,
  ModuleFlowFunctionId,
  ModuleFlowFunctionNodePayload,
  ModuleFlowListPayload,
  ModuleFlowListRequest,
  ModuleFlowModuleDetailPayload,
  ModuleFlowModuleId,
  ModuleFlowModuleNodePayload,
  ModuleFlowRelationKind,
  ModuleFlowSourcePayload
} from "../../protocol/moduleFlow";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import type {
  GraphEdge,
  ProjectGraph,
  SourceRange,
  SymbolNode
} from "../../shared/types";
import {
  createModuleFlowEdgeId,
  createModuleFlowFunctionId,
  createModuleFlowModuleId
} from "./moduleFlowIdentity";
import {
  addConfidenceCounts,
  clampLimit,
  compareModules,
  compareNodes,
  compareNumbers,
  compareProjectedEdges,
  compareRelationCounts,
  createBoundedDisplayLabels,
  compareText,
  createConfidenceCounts,
  createContainmentEdgePayload,
  createContainmentEdges,
  createRelationAggregates,
  describeModule,
  formatBoundaryFunctionDetail,
  isCallable,
  isExternalModule,
  projectBoundaryEvidence,
  safeLabel,
  safeLocationLabel,
  selectBoundaryExpansionEdges,
  selectModules,
  strongestConfidence,
  toRelationCounts,
  type BoundaryFunction,
  type RelationAggregate
} from "./moduleFlowProjectionSupport";

/** Token authorities stay outside the pure projection and expire per panel snapshot. */
export type ModuleFlowProjectionTokenFactories = {
  createSourceToken(nodeId: string): SourceNodeToken | undefined;
  createEvidenceToken(
    filePath: string,
    range: SourceRange
  ): ModuleFlowEvidenceToken | undefined;
};

/** Builds initial scenes, detail panes, and same-canvas expansion deltas. */
export class ModuleFlowProjectionService {
  private graphVersion: string | undefined;
  private graph: ProjectGraph | undefined;
  private index: ProjectModuleIndex | undefined;
  private moduleIdsByDomainId = new Map<string, ModuleFlowModuleId>();
  private domainIdsByModuleId = new Map<ModuleFlowModuleId, string>();
  /** Backing exists only for the bounded aggregate edges on the active canvas. */
  private sceneEdgeBackingById = new Map<ModuleFlowEdgeId, RelationAggregate>();

  /** The current detail rail replaces this bounded set on every module click. */
  private detailEdgeBackingById = new Map<ModuleFlowEdgeId, RelationAggregate>();

  private visibleDomainModuleIds = new Set<string>();

  /** Only function cards issued into the active scene may request local logic. */
  private functionNodeIdsByCanvasId = new Map<ModuleFlowFunctionId, string>();

  /** Avoids repeated full-graph scans when an issued function card is expanded. */
  private graphNodesById = new Map<string, SymbolNode>();

  /** Avoids scanning every module for every projected card. */
  private moduleIdsWithChildren = new Set<string>();

  public constructor(
    private readonly tokenFactories: ModuleFlowProjectionTokenFactories
  ) {}

  /** Replaces all Host-side projection state for one immutable panel snapshot. */
  public activate(graphVersion: string, graph: ProjectGraph): void {
    this.clear();
    this.graphVersion = graphVersion;
    this.graph = graph;
    this.graphNodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    this.index = createProjectModuleIndex(graph);
    for (const module of this.index.modules) {
      const id = createModuleFlowModuleId(graphVersion, module.id);
      this.moduleIdsByDomainId.set(module.id, id);
      this.domainIdsByModuleId.set(id, module.id);
      if (module.parentModuleId) {
        this.moduleIdsWithChildren.add(module.parentModuleId);
      }
    }
  }

  /** Drops the complete module index and every issued identity mapping. */
  public clear(): void {
    this.graphVersion = undefined;
    this.graph = undefined;
    this.index = undefined;
    this.moduleIdsByDomainId.clear();
    this.domainIdsByModuleId.clear();
    this.sceneEdgeBackingById.clear();
    this.detailEdgeBackingById.clear();
    this.visibleDomainModuleIds.clear();
    this.functionNodeIdsByCanvasId.clear();
    this.graphNodesById.clear();
    this.moduleIdsWithChildren.clear();
  }

  /** Returns whether one browser request belongs to the active projection. */
  public matches(graphVersion: string): boolean {
    return Boolean(this.graphVersion && this.graphVersion === graphVersion);
  }

  /** Projects the bounded module shell for one user-selected relation lens. */
  public projectList(request: ModuleFlowListRequest): ModuleFlowListPayload {
    const state = this.requireState(request.graphVersion);
    // A list response replaces the complete browser scene and therefore expires
    // every old base/detail edge backing immediately.
    this.sceneEdgeBackingById.clear();
    this.detailEdgeBackingById.clear();
    this.functionNodeIdsByCanvasId.clear();
    const modules = state.index.modules.filter((module) =>
      request.includeExternal !== false || !isExternalModule(module)
    );
    const availableModuleIds = new Set(modules.map((module) => module.id));
    const relationAggregates = createRelationAggregates(
      state.index.relations,
      request.mode,
      request.includeInferred !== false
    ).filter((aggregate) =>
      availableModuleIds.has(aggregate.sourceModuleId)
      && availableModuleIds.has(aggregate.targetModuleId)
    );
    const moduleLimit = clampLimit(request.moduleLimit, 1, 80);
    const selectedModules = selectModules(modules, moduleLimit, state.index.modulesById);
    const selectedIds = new Set(selectedModules.map((module) => module.id));
    this.visibleDomainModuleIds = selectedIds;

    // Project only relations whose endpoints can actually enter the bounded
    // scene. Previously every workspace aggregate allocated a payload/backing
    // before the 160-edge slice was applied.
    const aggregateByProjectedId = new Map<ModuleFlowEdgeId, RelationAggregate>();
    const eligibleRelationEdges = relationAggregates
      .filter((aggregate) =>
        selectedIds.has(aggregate.sourceModuleId)
        && selectedIds.has(aggregate.targetModuleId)
      )
      .map((aggregate) => {
        const edge = this.projectRelationAggregate(aggregate);
        aggregateByProjectedId.set(edge.id, aggregate);
        return edge;
      });
    const eligibleEdges = [
      ...eligibleRelationEdges,
      ...createContainmentEdges(
        selectedModules,
        this.graphVersion ?? "",
        this.moduleIdsByDomainId
      )
    ];
    const edgeLimit = clampLimit(request.edgeLimit, 0, 160);
    const visibleEdges = [...eligibleEdges]
      .sort(compareProjectedEdges)
      .slice(0, edgeLimit);
    for (const edge of visibleEdges) {
      const aggregate = aggregateByProjectedId.get(edge.id);
      if (aggregate) {
        this.sceneEdgeBackingById.set(edge.id, aggregate);
      }
    }
    const totalEdgeCount = relationAggregates.length + countModuleContainmentEdges(modules);

    return {
      graphVersion: request.graphVersion,
      requestId: request.requestId,
      mode: request.mode,
      nodes: selectedModules.map((module) => this.projectModule(module)),
      edges: visibleEdges,
      summary: {
        analyzedFileCount: state.index.summary.analyzedFileCount,
        ownedFileCount: state.index.summary.ownedFileCount,
        totalModuleCount: modules.length,
        visibleModuleCount: selectedModules.length,
        omittedModuleCount: modules.length - selectedModules.length,
        totalEdgeCount,
        visibleEdgeCount: visibleEdges.length,
        omittedEdgeCount: totalEdgeCount - visibleEdges.length,
        crossModuleEvidenceCount: state.index.summary.crossModuleEvidenceCount,
        internalRelationEvidenceCount: state.index.summary.internalRelationEvidenceCount,
        externalRelationEvidenceCount: state.index.summary.externalRelationEvidenceCount,
        unownedRelationEvidenceCount: state.index.summary.unownedRelationEvidenceCount
      }
    };
  }

  /** Projects a selected module or aggregate relation into the detail rail. */
  public projectDetail(request: ModuleFlowDetailRequest): ModuleFlowDetailPayload | undefined {
    const state = this.requireState(request.graphVersion);
    if (request.target.kind === "module") {
      const domainId = this.domainIdsByModuleId.get(request.target.id);
      const module = domainId ? state.index.modulesById.get(domainId) : undefined;
      if (!module) {
        return undefined;
      }
      return {
        graphVersion: request.graphVersion,
        requestId: request.requestId,
        detail: this.projectModuleDetail(
          module,
          clampLimit(request.relationLimit, 0, 40),
          clampLimit(request.evidenceLimit, 0, 5)
        )
      };
    }

    const aggregate = this.detailEdgeBackingById.get(request.target.id)
      ?? this.sceneEdgeBackingById.get(request.target.id);
    if (!aggregate) {
      return undefined;
    }
    return {
      graphVersion: request.graphVersion,
      requestId: request.requestId,
      detail: this.projectEdgeDetail(
        request.target.id,
        aggregate,
        clampLimit(request.evidenceLimit, 0, 5)
      )
    };
  }

  /** Projects child boundaries or cross-module functions around one anchor. */
  public projectExpansion(request: ModuleFlowExpandRequest): ModuleFlowExpandPayload | undefined {
    const state = this.requireState(request.graphVersion);
    const domainId = this.domainIdsByModuleId.get(request.moduleId);
    const module = domainId ? state.index.modulesById.get(domainId) : undefined;
    if (!domainId || !module || isExternalModule(module)) {
      return undefined;
    }

    return request.expansion === "childModules"
      ? this.projectChildModules(request, module)
      : this.projectBoundaryFunctions(request, module);
  }

  /** Resolves only a function identity previously issued by the active scene. */
  public resolveFunctionNode(functionId: ModuleFlowFunctionId): SymbolNode | undefined {
    const nodeId = this.functionNodeIdsByCanvasId.get(functionId);
    const node = nodeId ? this.graphNodesById.get(nodeId) : undefined;
    return node && isCallable(node) ? node : undefined;
  }

  /** Creates one browser-safe module card with exact direct metrics. */
  private projectModule(module: ProjectModule): ModuleFlowModuleNodePayload {
    const parentId = module.parentModuleId
      ? this.moduleIdsByDomainId.get(module.parentModuleId)
      : undefined;
    const hasChildren = this.moduleIdsWithChildren.has(module.id);

    return {
      id: this.requireModuleToken(module.id),
      kind: "module",
      label: safeLabel(module.name, "Unnamed module"),
      detail: describeModule(module),
      locationLabel: safeLocationLabel(module.displayPath),
      parentId,
      basis: module.basis,
      confidence: module.confidence,
      external: isExternalModule(module),
      ecosystems: createBoundedDisplayLabels(module.ecosystems, "ecosystems"),
      frameworks: createBoundedDisplayLabels(module.frameworks, "frameworks"),
      metrics: {
        analyzedFileCount: module.analyzedFileCount,
        descendantFileCount: module.descendantFileCount,
        callableCount: module.callableCount,
        descendantCallableCount: module.descendantCallableCount,
        frameworkUnitCount: module.frameworkUnitCount,
        entrypointCount: module.entrypointCount,
        incomingEvidenceCount: module.incomingEvidenceCount,
        outgoingEvidenceCount: module.outgoingEvidenceCount
      },
      expandable: {
        childModules: hasChildren,
        boundaryFunctions: module.callableCount > 0
      }
    };
  }

  /** Aggregates relation kinds for one routed module pair. */
  private projectRelationAggregate(aggregate: RelationAggregate): ModuleFlowEdgePayload {
    const id = createModuleFlowEdgeId(this.graphVersion ?? "", aggregate.key);
    const confidenceCounts = createConfidenceCounts();
    const relationCounts = new Map<ModuleFlowRelationKind, number>();
    let evidenceCount = 0;
    for (const relation of aggregate.relations) {
      evidenceCount += relation.evidenceCount;
      relationCounts.set(
        relation.kind,
        (relationCounts.get(relation.kind) ?? 0) + relation.evidenceCount
      );
      addConfidenceCounts(confidenceCounts, relation.confidenceCounts);
    }

    return {
      id,
      sourceId: this.requireModuleToken(aggregate.sourceModuleId),
      targetId: this.requireModuleToken(aggregate.targetModuleId),
      presentationKind: "aggregate",
      relations: toRelationCounts(relationCounts),
      confidenceCounts,
      evidenceCount,
      // List payloads carry no source rows; details issue approved tokens lazily.
      omittedEvidenceCount: evidenceCount,
      hasDetails: evidenceCount > 0
    };
  }

  /** Builds bounded module evidence and its incoming/outgoing neighborhoods. */
  private projectModuleDetail(
    module: ProjectModule,
    relationLimit: number,
    sourceLimit: number
  ): ModuleFlowModuleDetailPayload {
    const index = this.index;
    const graph = this.graph;
    if (!index || !graph) {
      throw new Error("Module Flow projection is not active.");
    }
    const aggregates = createRelationAggregates(index.relations, "boundary", true);
    const incomingCandidates = aggregates
      .filter((aggregate) => aggregate.targetModuleId === module.id)
      .map((aggregate) => ({ aggregate, edge: this.projectRelationAggregate(aggregate) }))
      .sort((left, right) => compareProjectedEdges(left.edge, right.edge));
    const outgoingCandidates = aggregates
      .filter((aggregate) => aggregate.sourceModuleId === module.id)
      .map((aggregate) => ({ aggregate, edge: this.projectRelationAggregate(aggregate) }))
      .sort((left, right) => compareProjectedEdges(left.edge, right.edge));
    const incoming = incomingCandidates.slice(0, relationLimit);
    const outgoing = outgoingCandidates.slice(0, relationLimit);
    this.detailEdgeBackingById.clear();
    for (const candidate of [...incoming, ...outgoing]) {
      this.detailEdgeBackingById.set(candidate.edge.id, candidate.aggregate);
    }
    const sourceDisplay = createSourceDisplayFormatter(graph.workspaceRoot, {
      preserveFullText: true
    });
    const directFiles = selectRepresentativeModuleFiles(
      graph.nodes,
      index.moduleIdByNodeId,
      module.id,
      sourceLimit
    );
    const representativeSources: ModuleFlowSourcePayload[] = directFiles.map((node) => ({
      label: sourceDisplay.path(node.filePath) ?? "Source file",
      sourceToken: this.tokenFactories.createSourceToken(node.id)
    }));

    return {
      kind: "module",
      module: this.projectModule(module),
      // Detail explains each evidence category once; the vocabulary has seven
      // finite kinds even when many framework units support the same boundary.
      boundaryEvidence: [...new Set(module.evidence.map((entry) => entry.kind))]
        .sort(compareText)
        .map((kind) => projectBoundaryEvidence(kind, module)),
      internalRelations: Object.entries(module.internalRelationCounts)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => ({ kind: kind as ModuleFlowRelationKind, count }))
        .sort(compareRelationCounts),
      representativeSources,
      omittedSourceCount: Math.max(0, module.analyzedFileCount - representativeSources.length),
      incomingEdges: incoming.map((candidate) => candidate.edge),
      outgoingEdges: outgoing.map((candidate) => candidate.edge),
      omittedIncomingEdgeCount: Math.max(0, incomingCandidates.length - incoming.length),
      omittedOutgoingEdgeCount: Math.max(0, outgoingCandidates.length - outgoing.length)
    };
  }

  /** Creates source-backed rows only after a selected aggregate requests detail. */
  private projectEdgeDetail(
    edgeId: ModuleFlowEdgeId,
    aggregate: RelationAggregate,
    evidenceLimit: number
  ): ModuleFlowEdgeDetailPayload {
    const edge = this.projectRelationAggregate(aggregate);
    const sourceDisplay = createSourceDisplayFormatter(this.graph?.workspaceRoot ?? ".", {
      preserveFullText: true
    });
    const retained = aggregate.relations
      .flatMap((relation) => relation.evidence)
      .sort((left, right) =>
        compareText(left.filePath ?? "", right.filePath ?? "")
        || compareNumbers(left.range?.startLine ?? -1, right.range?.startLine ?? -1)
        || compareText(left.edgeId, right.edgeId)
      )
      .slice(0, evidenceLimit);
    const evidence: ModuleFlowEvidencePayload[] = retained.map((entry) => ({
      label: entry.filePath
        ? sourceDisplay.location(entry.filePath, entry.range) ?? "Source evidence"
        : "Source evidence",
      source: entry.source,
      confidence: entry.confidence,
      evidenceToken: entry.filePath && entry.range
        ? this.tokenFactories.createEvidenceToken(entry.filePath, entry.range)
        : undefined
    }));
    const evidenceCount = aggregate.relations.reduce(
      (sum, relation) => sum + relation.evidenceCount,
      0
    );

    return {
      kind: "edge",
      edge: { ...edge, id: edgeId },
      evidence,
      omittedEvidenceCount: Math.max(0, evidenceCount - evidence.length)
    };
  }

  /** Adds direct child module cards and containment routes around the anchor. */
  private projectChildModules(
    request: ModuleFlowExpandRequest,
    module: ProjectModule
  ): ModuleFlowExpandPayload {
    const children = (this.index?.modules ?? [])
      .filter((candidate) => candidate.parentModuleId === module.id)
      .sort(compareModules);
    const nodeLimit = clampLimit(request.nodeLimit, 0, 48);
    const visibleChildren = children.slice(0, nodeLimit);
    const candidateEdges = visibleChildren.map((child) =>
      this.projectContainmentEdge(module.id, child.id)
    );
    const edgeLimit = clampLimit(request.edgeLimit, 0, 96);
    const visibleEdges = candidateEdges.slice(0, edgeLimit);

    return {
      graphVersion: request.graphVersion,
      requestId: request.requestId,
      anchorModuleId: request.moduleId,
      expansion: request.expansion,
      nodes: visibleChildren.map((child) => this.projectModule(child)),
      edges: visibleEdges,
      replacedEdgeIds: [],
      summary: {
        candidateNodeCount: children.length,
        visibleNodeCount: visibleChildren.length,
        omittedNodeCount: children.length - visibleChildren.length,
        candidateEdgeCount: candidateEdges.length,
        visibleEdgeCount: visibleEdges.length,
        omittedEdgeCount: candidateEdges.length - visibleEdges.length
      }
    };
  }

  /** Adds boundary callables and concrete cross-module call routes in-place. */
  private projectBoundaryFunctions(
    request: ModuleFlowExpandRequest,
    module: ProjectModule
  ): ModuleFlowExpandPayload {
    const candidates = this.collectBoundaryFunctions(module.id, request.direction);
    const nodeLimit = clampLimit(request.nodeLimit, 0, 48);
    const visibleCandidates = candidates.slice(0, nodeLimit);
    const visibleNodeIds = new Set(visibleCandidates.map((candidate) => candidate.node.id));
    const nodes = visibleCandidates.map((candidate) => this.projectBoundaryFunction(candidate));
    const containmentEdges = visibleCandidates.map((candidate) =>
      this.projectFunctionContainmentEdge(module.id, candidate.node.id)
    );
    const concreteEdges = this.projectConcreteBoundaryEdges(
      module.id,
      visibleCandidates,
      visibleNodeIds,
      request.direction
    );
    const edgeCandidates = [...containmentEdges, ...concreteEdges];
    const edgeLimit = clampLimit(request.edgeLimit, 0, 96);
    const edges = selectBoundaryExpansionEdges(containmentEdges, concreteEdges, edgeLimit);

    return {
      graphVersion: request.graphVersion,
      requestId: request.requestId,
      anchorModuleId: request.moduleId,
      expansion: request.expansion,
      nodes,
      edges,
      replacedEdgeIds: [],
      summary: {
        candidateNodeCount: candidates.length,
        visibleNodeCount: nodes.length,
        omittedNodeCount: candidates.length - nodes.length,
        candidateEdgeCount: edgeCandidates.length,
        visibleEdgeCount: edges.length,
        omittedEdgeCount: edgeCandidates.length - edges.length
      }
    };
  }

  /** Collects direct callables participating in cross-module calls, with fallback. */
  private collectBoundaryFunctions(
    moduleId: string,
    direction: ModuleFlowExpandRequest["direction"]
  ): BoundaryFunction[] {
    const graph = this.graph;
    const index = this.index;
    if (!graph || !index) {
      return [];
    }
    const callables = graph.nodes.filter((node) =>
      isCallable(node) && index.moduleIdByNodeId.get(node.id) === moduleId
    );
    const byNodeId = new Map(callables.map((node) => [node.id, {
      node,
      incoming: [] as GraphEdge[],
      outgoing: [] as GraphEdge[]
    }]));
    for (const edge of graph.edges) {
      if (edge.kind !== "calls") {
        continue;
      }
      const sourceModuleId = index.moduleIdByNodeId.get(edge.sourceId);
      const targetModuleId = index.moduleIdByNodeId.get(edge.targetId);
      if (!sourceModuleId || !targetModuleId || sourceModuleId === targetModuleId) {
        continue;
      }
      if (sourceModuleId === moduleId) {
        byNodeId.get(edge.sourceId)?.outgoing.push(edge);
      }
      if (targetModuleId === moduleId) {
        byNodeId.get(edge.targetId)?.incoming.push(edge);
      }
    }
    const boundary = [...byNodeId.values()].filter((candidate) =>
      direction === "incoming"
        ? candidate.incoming.length > 0
        : direction === "outgoing"
          ? candidate.outgoing.length > 0
          : candidate.incoming.length + candidate.outgoing.length > 0
    );
    const candidates = boundary.length > 0
      ? boundary
      : [...byNodeId.values()];
    return candidates.sort((left, right) =>
      (right.incoming.length + right.outgoing.length)
      - (left.incoming.length + left.outgoing.length)
      || compareNodes(left.node, right.node)
    );
  }

  /** Projects one callable while retaining its full label and safe location. */
  private projectBoundaryFunction(candidate: BoundaryFunction): ModuleFlowFunctionNodePayload {
    const graphVersion = this.graphVersion ?? "";
    const id = createModuleFlowFunctionId(graphVersion, candidate.node.id);
    this.functionNodeIdsByCanvasId.set(id, candidate.node.id);
    const sourceDisplay = createSourceDisplayFormatter(this.graph?.workspaceRoot ?? ".", {
      preserveFullText: true
    });
    const incoming = candidate.incoming.length;
    const outgoing = candidate.outgoing.length;
    return {
      id,
      kind: "function",
      label: safeLabel(candidate.node.qualifiedName || candidate.node.name, "Anonymous callable"),
      detail: formatBoundaryFunctionDetail(incoming, outgoing),
      locationLabel: sourceDisplay.location(candidate.node.filePath, candidate.node.selectionRange),
      sourceToken: this.tokenFactories.createSourceToken(candidate.node.id),
      confidence: strongestConfidence([...candidate.incoming, ...candidate.outgoing]),
      incomingBoundaryCount: incoming,
      outgoingBoundaryCount: outgoing,
      expandable: {
        functionLogic: true
      }
    };
  }

  /** Routes concrete calls between an expanded function and visible module cards. */
  private projectConcreteBoundaryEdges(
    anchorModuleId: string,
    candidates: readonly BoundaryFunction[],
    visibleNodeIds: ReadonlySet<string>,
    direction: ModuleFlowExpandRequest["direction"]
  ): ModuleFlowEdgePayload[] {
    const index = this.index;
    if (!index) {
      return [];
    }
    const aggregates = new Map<string, { sourceId: string; targetId: string; edges: GraphEdge[] }>();
    for (const candidate of candidates) {
      const relevant = [
        ...(direction === "incoming" ? [] : candidate.outgoing),
        ...(direction === "outgoing" ? [] : candidate.incoming)
      ];
      for (const edge of relevant) {
        const outgoing = edge.sourceId === candidate.node.id;
        const otherModuleId = index.moduleIdByNodeId.get(outgoing ? edge.targetId : edge.sourceId);
        if (!otherModuleId || !this.visibleDomainModuleIds.has(otherModuleId)) {
          continue;
        }
        const sourceId = outgoing ? candidate.node.id : otherModuleId;
        const targetId = outgoing ? otherModuleId : candidate.node.id;
        const key = `${sourceId}\0${targetId}`;
        const aggregate = aggregates.get(key) ?? { sourceId, targetId, edges: [] };
        aggregate.edges.push(edge);
        aggregates.set(key, aggregate);
      }
    }
    return [...aggregates.values()].map((aggregate) => {
      const sourceIsFunction = visibleNodeIds.has(aggregate.sourceId);
      const targetIsFunction = visibleNodeIds.has(aggregate.targetId);
      const sourceId = sourceIsFunction
        ? createModuleFlowFunctionId(this.graphVersion ?? "", aggregate.sourceId)
        : this.requireModuleToken(aggregate.sourceId);
      const targetId = targetIsFunction
        ? createModuleFlowFunctionId(this.graphVersion ?? "", aggregate.targetId)
        : this.requireModuleToken(aggregate.targetId);
      const confidenceCounts = createConfidenceCounts();
      for (const edge of aggregate.edges) {
        confidenceCounts[edge.confidence] += 1;
      }
      return {
        id: createModuleFlowEdgeId(
          this.graphVersion ?? "",
          `concrete\0${anchorModuleId}\0${aggregate.sourceId}\0${aggregate.targetId}`
        ),
        sourceId,
        targetId,
        presentationKind: "concreteCall",
        relations: [{ kind: "calls", count: aggregate.edges.length }],
        confidenceCounts,
        evidenceCount: aggregate.edges.length,
        omittedEvidenceCount: aggregate.edges.length,
        hasDetails: false
      } satisfies ModuleFlowEdgePayload;
    });
  }

  /** Issues a synthetic containment edge between two module boundaries. */
  private projectContainmentEdge(parentDomainId: string, childDomainId: string): ModuleFlowEdgePayload {
    const id = createModuleFlowEdgeId(
      this.graphVersion ?? "",
      `contains\0${parentDomainId}\0${childDomainId}`
    );
    return createContainmentEdgePayload(
      id,
      this.requireModuleToken(parentDomainId),
      this.requireModuleToken(childDomainId)
    );
  }

  /** Issues a synthetic module-to-function ownership edge for same-canvas drill. */
  private projectFunctionContainmentEdge(
    moduleDomainId: string,
    functionNodeId: string
  ): ModuleFlowEdgePayload {
    const id = createModuleFlowEdgeId(
      this.graphVersion ?? "",
      `owns\0${moduleDomainId}\0${functionNodeId}`
    );
    return createContainmentEdgePayload(
      id,
      this.requireModuleToken(moduleDomainId),
      createModuleFlowFunctionId(this.graphVersion ?? "", functionNodeId)
    );
  }

  /** Returns an already issued opaque token for a known domain module. */
  private requireModuleToken(domainId: string): ModuleFlowModuleId {
    const token = this.moduleIdsByDomainId.get(domainId);
    if (!token) {
      throw new Error("Module identity is not available in the active snapshot.");
    }
    return token;
  }

  /** Narrows active state and rejects accidental cross-snapshot projection. */
  private requireState(graphVersion: string): {
    graph: ProjectGraph;
    index: ProjectModuleIndex;
  } {
    if (!this.matches(graphVersion) || !this.graph || !this.index) {
      throw new Error("Module Flow graph snapshot is stale or unavailable.");
    }
    return { graph: this.graph, index: this.index };
  }
}

/** Counts hierarchy routes without allocating one payload per workspace module. */
function countModuleContainmentEdges(modules: readonly ProjectModule[]): number {
  const moduleIds = new Set(modules.map((module) => module.id));
  let count = 0;
  for (const module of modules) {
    if (module.parentModuleId && moduleIds.has(module.parentModuleId)) {
      count += 1;
    }
  }
  return count;
}

/** Retains only the smallest bounded source rows instead of sorting all files. */
function selectRepresentativeModuleFiles(
  nodes: readonly SymbolNode[],
  moduleIdByNodeId: ReadonlyMap<string, string>,
  moduleId: string,
  limit: number
): SymbolNode[] {
  if (limit <= 0) {
    return [];
  }
  const retained: SymbolNode[] = [];
  for (const node of nodes) {
    if (node.kind !== "file" || moduleIdByNodeId.get(node.id) !== moduleId) {
      continue;
    }
    let insertionIndex = retained.findIndex((candidate) => compareNodes(node, candidate) < 0);
    if (insertionIndex < 0) {
      insertionIndex = retained.length;
    }
    retained.splice(insertionIndex, 0, node);
    if (retained.length > limit) {
      retained.pop();
    }
  }
  return retained;
}
