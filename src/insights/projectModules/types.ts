/**
 * Public host-independent contracts for the project-module insight.
 *
 * A project module is an aggregate responsibility boundary inferred from neutral
 * package manifests, framework roots, or conservative source-directory shapes.
 * It deliberately remains separate from language `module` symbols and framework
 * `module` units. Relations preserve their source confidence and bounded evidence.
 */

import type { EdgeConfidence, SourceRange } from "../../shared/types";

/** Maximum source anchors retained on one aggregated module relation. */
export const PROJECT_MODULE_RELATION_EVIDENCE_LIMIT = 5;

/** Maximum representative source files retained on one module summary. */
export const PROJECT_MODULE_REPRESENTATIVE_FILE_LIMIT = 3;

/** Evidence priority used to choose one module's primary boundary classification. */
export type ProjectModuleBasis =
  | "workspacePackage"
  | "frameworkRoot"
  | "sourceArea"
  | "workspaceRoot"
  | "externalBoundary";

/** One retained reason that a canonical directory is treated as a module root. */
export type ProjectModuleBoundaryEvidence = {
  kind:
    | "manifest"
    | "explicitRoot"
    | "framework"
    | "frameworkUnit"
    | "sourceArea"
    | "workspace"
    | "external";
  label: string;
};

/** Additional root evidence accepted without coupling this insight to an adapter. */
export type ProjectModuleRootEvidence = {
  rootPath: string;
  name?: string;
  basis: "workspacePackage" | "frameworkRoot";
  confidence?: "exact" | "resolved";
  manifestPaths?: readonly string[];
  ecosystems?: readonly string[];
  framework?: string;
  label?: string;
};

/** Optional construction inputs for adapters with extra package knowledge. */
export type CreateProjectModuleIndexOptions = {
  roots?: readonly ProjectModuleRootEvidence[];
};

/** Module-level relations produced from source graph and framework evidence. */
export type ProjectModuleRelationKind =
  | "calls"
  | "imports"
  | "exports"
  | "routesTo"
  | "usesModel"
  | "renders"
  | "injects"
  | "configures"
  | "extends";

/** Exact confidence buckets; no representative confidence overwrites evidence. */
export type ProjectModuleConfidenceCounts = Record<EdgeConfidence, number>;

/** Exact internal evidence totals retained instead of emitting self-loop edges. */
export type ProjectModuleRelationCounts = Record<ProjectModuleRelationKind, number>;

/** One bounded source anchor supporting an aggregated cross-module relation. */
export type ProjectModuleRelationEvidence = {
  source: "graphEdge" | "frameworkUnitEdge";
  edgeId: string;
  filePath?: string;
  range?: SourceRange;
  confidence: EdgeConfidence;
};

/** One non-overlapping module with direct and descendant source exposure. */
export type ProjectModule = {
  id: string;
  name: string;
  /** Canonical host-side root identity; absent only for the external boundary. */
  rootPath?: string;
  displayPath: string;
  basis: ProjectModuleBasis;
  confidence: EdgeConfidence;
  parentModuleId?: string;
  evidence: ProjectModuleBoundaryEvidence[];
  manifestPaths: string[];
  ecosystems: string[];
  frameworks: string[];
  analyzedFileCount: number;
  descendantFileCount: number;
  callableCount: number;
  descendantCallableCount: number;
  frameworkUnitCount: number;
  entrypointCount: number;
  representativeFilePaths: string[];
  omittedFileCount: number;
  internalRelationCounts: ProjectModuleRelationCounts;
  incomingEvidenceCount: number;
  outgoingEvidenceCount: number;
};

/** Directed, relation-specific aggregate between two distinct modules. */
export type ProjectModuleRelation = {
  id: string;
  sourceModuleId: string;
  targetModuleId: string;
  kind: ProjectModuleRelationKind;
  evidenceCount: number;
  confidenceCounts: ProjectModuleConfidenceCounts;
  evidence: ProjectModuleRelationEvidence[];
  omittedEvidenceCount: number;
};

/** Exact coverage counters explaining what the module index could aggregate. */
export type ProjectModuleSummary = {
  graphVersion: string;
  analyzedFileCount: number;
  ownedFileCount: number;
  moduleCount: number;
  internalModuleCount: number;
  crossModuleRelationCount: number;
  crossModuleEvidenceCount: number;
  internalRelationEvidenceCount: number;
  externalRelationEvidenceCount: number;
  unownedRelationEvidenceCount: number;
};

/** Full host-side module graph plus ownership maps for later lazy projections. */
export type ProjectModuleIndex = {
  graphVersion: string;
  workspaceRoot: string;
  modules: ProjectModule[];
  relations: ProjectModuleRelation[];
  modulesById: ReadonlyMap<string, ProjectModule>;
  /** Canonical normalized file-path key to nearest module identity. */
  moduleIdByPathKey: ReadonlyMap<string, string>;
  moduleIdByNodeId: ReadonlyMap<string, string>;
  summary: ProjectModuleSummary;
};
