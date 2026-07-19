/**
 * Canonical project-module boundary detection and nearest-root ownership.
 *
 * Explicit package and framework evidence is merged before conservative source
 * areas are inferred. Nested boundaries remain distinct, and every ancestor walk
 * is iterative with a visited set so malformed paths cannot loop indefinitely.
 */

import {
  createPortableProjectPathNormalizer,
  findNearestPortableAncestor,
  getPortableProjectBaseName,
  getPortableProjectParentKey,
  type PortableProjectPathNormalizer
} from "../../shared/portableProjectPath";
import type { EdgeConfidence, ProjectGraph } from "../../shared/types";
import type {
  CreateProjectModuleIndexOptions,
  ProjectModuleBasis,
  ProjectModuleBoundaryEvidence
} from "./types";

/** Conventional containers receive one additional child segment as an area. */
const TWO_SEGMENT_SOURCE_CONTAINERS = new Set([
  "app",
  "apps",
  "lib",
  "packages",
  "services",
  "src"
]);

/** Stronger evidence wins the primary basis without discarding weaker evidence. */
const MODULE_BASIS_ORDER: Record<Exclude<ProjectModuleBasis, "externalBoundary">, number> = {
  workspacePackage: 0,
  frameworkRoot: 1,
  sourceArea: 2,
  workspaceRoot: 3
};

/** Internal immutable boundary used by ownership and module metric aggregation. */
export type ProjectModuleBoundary = {
  id: string;
  key: string;
  name: string;
  displayPath: string;
  basis: Exclude<ProjectModuleBasis, "externalBoundary">;
  confidence: Exclude<EdgeConfidence, "unresolved">;
  parentModuleId?: string;
  evidence: ProjectModuleBoundaryEvidence[];
  manifestPaths: string[];
  ecosystems: string[];
  frameworks: string[];
};

/** Full boundary lookup retained inside the host-only project-module index. */
export type ProjectModuleBoundaryIndex = {
  workspaceRootKey: string;
  normalizer: PortableProjectPathNormalizer;
  boundaries: ProjectModuleBoundary[];
  boundariesByKey: ReadonlyMap<string, ProjectModuleBoundary>;
};

type MutableBoundary = {
  key: string;
  name?: string;
  displayPath: string;
  basis: Exclude<ProjectModuleBasis, "externalBoundary">;
  confidence: Exclude<EdgeConfidence, "unresolved">;
  evidenceByKey: Map<string, ProjectModuleBoundaryEvidence>;
  manifestPaths: Set<string>;
  ecosystems: Set<string>;
  frameworks: Set<string>;
};

type AddBoundaryInput = {
  rootPath: string;
  name?: string;
  basis: Exclude<ProjectModuleBasis, "externalBoundary">;
  confidence: Exclude<EdgeConfidence, "unresolved">;
  evidence: ProjectModuleBoundaryEvidence;
  manifestPaths?: readonly string[];
  ecosystems?: readonly string[];
  framework?: string;
};

/**
 * Builds deterministic module roots from graph metadata plus optional adapter
 * evidence. Files are only used to add unambiguous structural fallback areas.
 */
export function createProjectModuleBoundaryIndex(
  graph: ProjectGraph,
  options: CreateProjectModuleIndexOptions = {}
): ProjectModuleBoundaryIndex {
  const normalizer = createPortableProjectPathNormalizer(graph.workspaceRoot);
  const workspace = normalizer.normalize(graph.workspaceRoot);
  const mutableByKey = new Map<string, MutableBoundary>();

  for (const projectPackage of graph.metadata.projectPackageRoots ?? []) {
    const manifestPaths = [...projectPackage.manifestPaths]
      .map((manifestPath) => manifestPath.trim())
      .filter(Boolean)
      .sort(compareText);
    addBoundary(mutableByKey, normalizer, workspace.key, {
      rootPath: projectPackage.rootPath,
      basis: "workspacePackage",
      confidence: "exact",
      evidence: {
        kind: "manifest",
        label: `Manifest root: ${manifestPaths.join(", ") || projectPackage.rootPath}`
      },
      manifestPaths,
      ecosystems: projectPackage.ecosystems
    });
  }

  for (const root of options.roots ?? []) {
    addBoundary(mutableByKey, normalizer, workspace.key, {
      rootPath: root.rootPath,
      name: root.name,
      basis: root.basis,
      confidence: root.confidence ?? (root.basis === "workspacePackage" ? "exact" : "resolved"),
      evidence: {
        kind: "explicitRoot",
        label: root.label ?? `Explicit ${root.basis}: ${root.rootPath}`
      },
      manifestPaths: root.manifestPaths,
      ecosystems: root.ecosystems,
      framework: root.framework
    });
  }

  for (const framework of graph.metadata.frameworks ?? []) {
    const rootPath = framework.rootPath ?? graph.workspaceRoot;
    addBoundary(mutableByKey, normalizer, workspace.key, {
      rootPath,
      basis: "frameworkRoot",
      confidence: "resolved",
      evidence: {
        kind: "framework",
        label: `${framework.name} root: ${rootPath}`
      },
      framework: framework.name
    });
  }

  for (const unit of graph.metadata.frameworkUnits ?? []) {
    addBoundary(mutableByKey, normalizer, workspace.key, {
      rootPath: unit.rootPath,
      basis: "frameworkRoot",
      confidence: "resolved",
      evidence: {
        kind: "frameworkUnit",
        label: `${unit.framework} ${unit.kind} root: ${unit.rootPath}`
      },
      framework: unit.framework
    });
  }

  // The workspace root guarantees ownership for direct root files and provides
  // a parent for nested package roots without pretending to be a package.
  addBoundary(mutableByKey, normalizer, workspace.key, {
    rootPath: graph.workspaceRoot,
    basis: "workspaceRoot",
    confidence: "inferred",
    evidence: { kind: "workspace", label: "Analyzed workspace root" }
  });

  addSourceAreaFallbacks(graph, mutableByKey, workspace.key, normalizer);

  const preliminary = new Map<string, ProjectModuleBoundary>();
  for (const mutable of mutableByKey.values()) {
    const boundary = finalizeBoundary(mutable, graph.workspaceRoot);
    preliminary.set(boundary.key, boundary);
  }

  const boundaries = [...preliminary.values()]
    .map((boundary) => attachParentModule(boundary, preliminary))
    .sort(compareBoundaries);
  const boundariesByKey = new Map(boundaries.map((boundary) => [boundary.key, boundary]));

  return {
    workspaceRootKey: workspace.key,
    normalizer,
    boundaries,
    boundariesByKey
  };
}

/** Adds or merges one candidate only when it remains inside the workspace. */
function addBoundary(
  boundariesByKey: Map<string, MutableBoundary>,
  normalizer: PortableProjectPathNormalizer,
  workspaceRootKey: string,
  input: AddBoundaryInput
): void {
  const normalized = normalizer.normalize(input.rootPath);
  if (!normalizer.contains(workspaceRootKey, normalized.key)) {
    return;
  }

  const existing = boundariesByKey.get(normalized.key);
  const boundary = existing ?? {
    key: normalized.key,
    name: input.name?.trim() || undefined,
    displayPath: normalized.displayPath,
    basis: input.basis,
    confidence: input.confidence,
    evidenceByKey: new Map<string, ProjectModuleBoundaryEvidence>(),
    manifestPaths: new Set<string>(),
    ecosystems: new Set<string>(),
    frameworks: new Set<string>()
  };

  if (!existing) {
    boundariesByKey.set(boundary.key, boundary);
  } else {
    mergePrimaryBoundary(boundary, input);
    boundary.displayPath = minText(boundary.displayPath, normalized.displayPath);
    if (input.name?.trim()) {
      boundary.name = boundary.name
        ? minText(boundary.name, input.name.trim())
        : input.name.trim();
    }
  }

  boundary.evidenceByKey.set(
    `${input.evidence.kind}\u001f${input.evidence.label}`,
    input.evidence
  );
  addNonEmptyValues(boundary.manifestPaths, input.manifestPaths);
  addNonEmptyValues(boundary.ecosystems, input.ecosystems);
  if (input.framework?.trim()) {
    boundary.frameworks.add(input.framework.trim());
  }
}

/** Keeps the strongest primary classification while preserving all evidence. */
function mergePrimaryBoundary(boundary: MutableBoundary, input: AddBoundaryInput): void {
  const currentRank = MODULE_BASIS_ORDER[boundary.basis];
  const incomingRank = MODULE_BASIS_ORDER[input.basis];
  if (
    incomingRank < currentRank
    || (incomingRank === currentRank
      && confidenceRank(input.confidence) > confidenceRank(boundary.confidence))
  ) {
    boundary.basis = input.basis;
    boundary.confidence = input.confidence;
  }
}

/** Adds conservative areas only for files otherwise owned by the broad root. */
function addSourceAreaFallbacks(
  graph: ProjectGraph,
  boundariesByKey: Map<string, MutableBoundary>,
  workspaceRootKey: string,
  normalizer: PortableProjectPathNormalizer
): void {
  const distinctFileKeys = new Set<string>();
  // Inferred areas must not affect later files in this same scan. Ownership is
  // checked only against the explicit roots captured before fallback discovery.
  const explicitBoundariesByKey = new Map(boundariesByKey);

  for (const node of graph.nodes) {
    if (node.kind !== "file") {
      continue;
    }

    const source = normalizer.normalize(node.filePath);
    if (!normalizer.contains(workspaceRootKey, source.key) || distinctFileKeys.has(source.key)) {
      continue;
    }
    distinctFileKeys.add(source.key);

    const explicitOwner = findNearestPortableAncestor(source.key, explicitBoundariesByKey);
    if (explicitOwner && explicitOwner.key !== workspaceRootKey) {
      continue;
    }

    const areaKey = findSourceAreaKey(workspaceRootKey, source.key, normalizer);
    if (areaKey === workspaceRootKey) {
      continue;
    }

    const displayPath = normalizer.normalize(areaKey).displayPath;
    addBoundary(boundariesByKey, normalizer, workspaceRootKey, {
      rootPath: areaKey,
      basis: "sourceArea",
      confidence: "inferred",
      evidence: {
        kind: "sourceArea",
        label: `Inferred source area: ${displayPath}`
      }
    });
  }
}

/**
 * Selects the first directory below the workspace, or one extra segment below a
 * conventional source container. The walk is bounded by ancestry and visited.
 */
function findSourceAreaKey(
  workspaceRootKey: string,
  sourcePathKey: string,
  normalizer: PortableProjectPathNormalizer
): string {
  if (!normalizer.contains(workspaceRootKey, sourcePathKey)) {
    return workspaceRootKey;
  }

  const sourceDirectory = getPortableProjectParentKey(sourcePathKey);
  if (!sourceDirectory || !normalizer.contains(workspaceRootKey, sourceDirectory)) {
    return workspaceRootKey;
  }

  const visited = new Set<string>();
  const ancestors: string[] = [];
  let currentKey = sourceDirectory;

  while (!visited.has(currentKey)) {
    visited.add(currentKey);
    if (currentKey === workspaceRootKey) {
      break;
    }
    ancestors.push(currentKey);

    const parentKey = getPortableProjectParentKey(currentKey);
    if (!parentKey || !normalizer.contains(workspaceRootKey, parentKey)) {
      return workspaceRootKey;
    }
    if (parentKey === workspaceRootKey) {
      break;
    }
    if (parentKey === currentKey) {
      return workspaceRootKey;
    }
    currentKey = parentKey;
  }

  const directChildKey = ancestors.at(-1);
  if (!directChildKey) {
    return workspaceRootKey;
  }
  if (!TWO_SEGMENT_SOURCE_CONTAINERS.has(getPortableProjectBaseName(directChildKey).toLowerCase())) {
    return directChildKey;
  }

  const desiredDepth = normalizer.depth(workspaceRootKey) + 2;
  return ancestors.find((key) => normalizer.depth(key) === desiredDepth) ?? directChildKey;
}

/** Converts mutable evidence into one stable canonical boundary record. */
function finalizeBoundary(
  boundary: MutableBoundary,
  workspaceRoot: string
): ProjectModuleBoundary {
  const defaultName = boundary.displayPath === "."
    ? getPortableProjectBaseName(workspaceRoot)
    : getPortableProjectBaseName(boundary.displayPath);

  return {
    id: createProjectModuleId(boundary.key),
    key: boundary.key,
    name: boundary.name ?? defaultName,
    displayPath: boundary.displayPath,
    basis: boundary.basis,
    confidence: boundary.confidence,
    evidence: [...boundary.evidenceByKey.values()].sort(compareBoundaryEvidence),
    manifestPaths: [...boundary.manifestPaths].sort(compareText),
    ecosystems: [...boundary.ecosystems].sort(compareText),
    frameworks: [...boundary.frameworks].sort(compareText)
  };
}

/** Finds the nearest strict boundary ancestor without recursive tree traversal. */
function attachParentModule(
  boundary: ProjectModuleBoundary,
  boundariesByKey: ReadonlyMap<string, ProjectModuleBoundary>
): ProjectModuleBoundary {
  const parentKey = getPortableProjectParentKey(boundary.key);
  const parent = parentKey
    ? findNearestPortableAncestor(parentKey, boundariesByKey)
    : undefined;
  return parent ? { ...boundary, parentModuleId: parent.id } : boundary;
}

/** Stable module identity contains the complete normalized path key. */
function createProjectModuleId(rootKey: string): string {
  return `project-module:${encodeURIComponent(rootKey)}`;
}

/** Adds trimmed evidence values without allowing empty identities. */
function addNonEmptyValues(target: Set<string>, values?: readonly string[]): void {
  for (const value of values ?? []) {
    if (value.trim()) {
      target.add(value.trim());
    }
  }
}

/** Comparable confidence rank used only when primary bases are identical. */
function confidenceRank(confidence: Exclude<EdgeConfidence, "unresolved">): number {
  switch (confidence) {
    case "exact":
      return 3;
    case "resolved":
      return 2;
    case "inferred":
      return 1;
  }
}

/** Parent-first stable ordering supports iterative descendant accumulation. */
function compareBoundaries(left: ProjectModuleBoundary, right: ProjectModuleBoundary): number {
  return left.key.split("/").length - right.key.split("/").length
    || compareText(left.key, right.key)
    || compareText(left.id, right.id);
}

/** Stable evidence ordering prevents graph input order from affecting payloads. */
function compareBoundaryEvidence(
  left: ProjectModuleBoundaryEvidence,
  right: ProjectModuleBoundaryEvidence
): number {
  return compareText(left.kind, right.kind) || compareText(left.label, right.label);
}

/** Returns the lexically smaller presentation string. */
function minText(left: string, right: string): string {
  return compareText(left, right) <= 0 ? left : right;
}

/** Locale-independent comparison for reproducible projections. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
