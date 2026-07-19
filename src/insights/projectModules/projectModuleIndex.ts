/**
 * ProjectGraph-to-module index orchestration.
 *
 * This pure host-side projector joins canonical module boundaries, nearest file
 * ownership, direct/descendant exposure metrics, and bounded cross-module edges.
 * It never mutates the analyzer graph and does not depend on VS Code or Webview.
 */

import { findNearestPortableAncestor } from "../../shared/portableProjectPath";
import type { FrameworkUnitKind, ProjectGraph, SymbolNode } from "../../shared/types";
import {
  createProjectModuleBoundaryIndex,
  type ProjectModuleBoundary
} from "./moduleBoundaries";
import {
  createEmptyRelationCounts,
  createProjectModuleRelations
} from "./moduleRelations";
import {
  PROJECT_MODULE_REPRESENTATIVE_FILE_LIMIT,
  type CreateProjectModuleIndexOptions,
  type ProjectModule,
  type ProjectModuleIndex
} from "./types";

/** Stable aggregate target for unresolved calls and external dependencies. */
const EXTERNAL_MODULE_ID = "project-module:external-boundary";

/** Framework units that represent executable project entry boundaries. */
const ENTRYPOINT_UNIT_KINDS = new Set<FrameworkUnitKind>([
  "app",
  "route",
  "operation",
  "controller",
  "view",
  "command"
]);

type MutableModuleExposure = {
  boundary: ProjectModuleBoundary;
  filePathKeys: Set<string>;
  fileDisplayPaths: Set<string>;
  callableIds: Set<string>;
  frameworkUnitIds: Set<string>;
  entrypointUnitIds: Set<string>;
  descendantFileCount: number;
  descendantCallableCount: number;
};

/**
 * Creates one deterministic module index for an immutable graph snapshot.
 * Ownership uses canonical path ancestors, so nested packages stay non-overlapping.
 */
export function createProjectModuleIndex(
  graph: ProjectGraph,
  options: CreateProjectModuleIndexOptions = {}
): ProjectModuleIndex {
  const boundaryIndex = createProjectModuleBoundaryIndex(graph, options);
  const exposuresByModuleId = new Map<string, MutableModuleExposure>();
  for (const boundary of boundaryIndex.boundaries) {
    exposuresByModuleId.set(boundary.id, createMutableExposure(boundary));
  }

  const moduleIdByPathKey = new Map<string, string>();
  const moduleIdByNodeId = new Map<string, string>();
  const distinctAnalyzedFileKeys = new Set<string>();

  for (const node of graph.nodes) {
    if (node.kind === "external") {
      continue;
    }

    const normalized = boundaryIndex.normalizer.normalize(node.filePath);
    if (node.kind === "file") {
      distinctAnalyzedFileKeys.add(normalized.key);
    }
    const owner = findNearestPortableAncestor(normalized.key, boundaryIndex.boundariesByKey);
    if (!owner) {
      continue;
    }

    moduleIdByPathKey.set(normalized.key, owner.id);
    moduleIdByNodeId.set(node.id, owner.id);
    const exposure = exposuresByModuleId.get(owner.id);
    if (!exposure) {
      continue;
    }

    if (node.kind === "file") {
      exposure.filePathKeys.add(normalized.key);
      exposure.fileDisplayPaths.add(normalized.displayPath);
    } else if (isCallable(node)) {
      exposure.callableIds.add(node.id);
    }
  }

  for (const unit of graph.metadata.frameworkUnits ?? []) {
    const normalized = boundaryIndex.normalizer.normalize(unit.filePath);
    const owner = findNearestPortableAncestor(normalized.key, boundaryIndex.boundariesByKey);
    if (!owner) {
      continue;
    }

    const exposure = exposuresByModuleId.get(owner.id);
    exposure?.frameworkUnitIds.add(unit.id);
    if (ENTRYPOINT_UNIT_KINDS.has(unit.kind)) {
      exposure?.entrypointUnitIds.add(unit.id);
    }
  }

  accumulateDescendantExposure(exposuresByModuleId);

  const relations = createProjectModuleRelations(graph, {
    moduleIdByNodeId,
    findModuleIdByFilePath(filePath): string | undefined {
      if (!filePath) {
        return undefined;
      }
      const normalized = boundaryIndex.normalizer.normalize(filePath);
      return findNearestPortableAncestor(normalized.key, boundaryIndex.boundariesByKey)?.id;
    },
    externalModuleId: EXTERNAL_MODULE_ID
  });

  const modules = boundaryIndex.boundaries.map((boundary) =>
    finalizeModule(exposuresByModuleId.get(boundary.id) ?? createMutableExposure(boundary))
  );
  if (relations.usesExternalBoundary) {
    modules.push(createExternalBoundaryModule());
  }

  const modulesById = new Map(modules.map((module) => [module.id, module]));
  for (const [moduleId, internalCounts] of relations.internalCountsByModuleId) {
    const module = modulesById.get(moduleId);
    if (module) {
      module.internalRelationCounts = { ...internalCounts };
    }
  }
  for (const relation of relations.relations) {
    const source = modulesById.get(relation.sourceModuleId);
    const target = modulesById.get(relation.targetModuleId);
    if (source) {
      source.outgoingEvidenceCount += relation.evidenceCount;
    }
    if (target) {
      target.incomingEvidenceCount += relation.evidenceCount;
    }
  }

  const ownedFileCount = [...moduleIdByPathKey.keys()]
    .filter((pathKey) => distinctAnalyzedFileKeys.has(pathKey))
    .length;

  return {
    graphVersion: graph.version,
    workspaceRoot: graph.workspaceRoot,
    modules,
    relations: relations.relations,
    modulesById,
    moduleIdByPathKey,
    moduleIdByNodeId,
    summary: {
      graphVersion: graph.version,
      analyzedFileCount: distinctAnalyzedFileKeys.size,
      ownedFileCount,
      moduleCount: modules.length,
      internalModuleCount: boundaryIndex.boundaries.length,
      crossModuleRelationCount: relations.relations.length,
      crossModuleEvidenceCount: relations.coverage.crossModuleEvidenceCount,
      internalRelationEvidenceCount: relations.coverage.internalRelationEvidenceCount,
      externalRelationEvidenceCount: relations.coverage.externalRelationEvidenceCount,
      unownedRelationEvidenceCount: relations.coverage.unownedRelationEvidenceCount
    }
  };
}

/** Initializes exact direct exposure sets for one canonical boundary. */
function createMutableExposure(boundary: ProjectModuleBoundary): MutableModuleExposure {
  return {
    boundary,
    filePathKeys: new Set<string>(),
    fileDisplayPaths: new Set<string>(),
    callableIds: new Set<string>(),
    frameworkUnitIds: new Set<string>(),
    entrypointUnitIds: new Set<string>(),
    descendantFileCount: 0,
    descendantCallableCount: 0
  };
}

/**
 * Propagates each module's direct counts through parent identities iteratively.
 * Direct ownership remains unique; descendants are presentation rollups only.
 */
function accumulateDescendantExposure(
  exposuresByModuleId: ReadonlyMap<string, MutableModuleExposure>
): void {
  for (const exposure of exposuresByModuleId.values()) {
    exposure.descendantFileCount += exposure.filePathKeys.size;
    exposure.descendantCallableCount += exposure.callableIds.size;

    const visited = new Set<string>([exposure.boundary.id]);
    let parentModuleId = exposure.boundary.parentModuleId;
    while (parentModuleId && !visited.has(parentModuleId)) {
      visited.add(parentModuleId);
      const parent = exposuresByModuleId.get(parentModuleId);
      if (!parent) {
        break;
      }
      parent.descendantFileCount += exposure.filePathKeys.size;
      parent.descendantCallableCount += exposure.callableIds.size;
      parentModuleId = parent.boundary.parentModuleId;
    }
  }
}

/** Converts direct sets and descendant rollups into the public module summary. */
function finalizeModule(exposure: MutableModuleExposure): ProjectModule {
  const representativeFilePaths = [...exposure.fileDisplayPaths]
    .sort(compareText)
    .slice(0, PROJECT_MODULE_REPRESENTATIVE_FILE_LIMIT);
  const boundary = exposure.boundary;

  return {
    id: boundary.id,
    name: boundary.name,
    rootPath: boundary.key,
    displayPath: boundary.displayPath,
    basis: boundary.basis,
    confidence: boundary.confidence,
    parentModuleId: boundary.parentModuleId,
    evidence: boundary.evidence.map((entry) => ({ ...entry })),
    manifestPaths: [...boundary.manifestPaths],
    ecosystems: [...boundary.ecosystems],
    frameworks: [...boundary.frameworks],
    analyzedFileCount: exposure.filePathKeys.size,
    descendantFileCount: exposure.descendantFileCount,
    callableCount: exposure.callableIds.size,
    descendantCallableCount: exposure.descendantCallableCount,
    frameworkUnitCount: exposure.frameworkUnitIds.size,
    entrypointCount: exposure.entrypointUnitIds.size,
    representativeFilePaths,
    omittedFileCount: exposure.fileDisplayPaths.size - representativeFilePaths.length,
    internalRelationCounts: createEmptyRelationCounts(),
    incomingEvidenceCount: 0,
    outgoingEvidenceCount: 0
  };
}

/** Creates the single honest sink used for unresolved and external evidence. */
function createExternalBoundaryModule(): ProjectModule {
  return {
    id: EXTERNAL_MODULE_ID,
    name: "External / unresolved",
    displayPath: "External / unresolved",
    basis: "externalBoundary",
    confidence: "unresolved",
    evidence: [{ kind: "external", label: "External or statically unresolved target" }],
    manifestPaths: [],
    ecosystems: [],
    frameworks: [],
    analyzedFileCount: 0,
    descendantFileCount: 0,
    callableCount: 0,
    descendantCallableCount: 0,
    frameworkUnitCount: 0,
    entrypointCount: 0,
    representativeFilePaths: [],
    omittedFileCount: 0,
    internalRelationCounts: createEmptyRelationCounts(),
    incomingEvidenceCount: 0,
    outgoingEvidenceCount: 0
  };
}

/** Callable kinds share source ownership and module exposure semantics. */
function isCallable(node: SymbolNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Locale-independent comparison for reproducible source samples. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
