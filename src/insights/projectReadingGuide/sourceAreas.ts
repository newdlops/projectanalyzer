/**
 * Bounded source-area projection for one selected Project Reading Guide scope.
 *
 * Areas are the scope root, direct source-directory children, or one extra
 * child below common source containers such as apps, packages, services, src,
 * app, and lib. Files, callables, and entrypoints therefore contribute to
 * exactly one area. Ancestors use an iterative parent walk and a cycle guard.
 */

import type { SemanticFlow } from "../semanticFlow";
import { getPortableProjectBaseName } from "../../shared/portableProjectPath";
import type { PortableProjectPathNormalizer } from "./portableRootPath";
import {
  getPortableParentKey,
  selectDeterministicTopK,
  type IndexedProjectReadingScope
} from "./scopeIndex";
import {
  PROJECT_READING_AREA_LIMIT,
  type ProjectReadingAreaBasis,
  type ProjectReadingSourceArea
} from "./types";

/** Number of example file paths retained behind one area summary. */
const REPRESENTATIVE_FILE_LIMIT = 3;

/** Conventional source containers receive one additional structural segment. */
const TWO_SEGMENT_AREA_CONTAINERS = new Set([
  "app",
  "apps",
  "lib",
  "packages",
  "services",
  "src"
]);

/** Bounded area result with an exact candidate and omission count. */
export type ProjectReadingSourceAreaProjection = {
  areas: ProjectReadingSourceArea[];
  totalAreaCount: number;
  omittedAreaCount: number;
};

type MutableSourceArea = {
  key: string;
  displayPaths: Set<string>;
  filePaths: Set<string>;
  callableIds: Set<string>;
  entrypointUnitIds: Set<string>;
};

/** Projects no more than five deterministic, non-overlapping source areas. */
export function createProjectReadingSourceAreas(
  scope: IndexedProjectReadingScope,
  workspaceRootKey: string,
  normalizer: PortableProjectPathNormalizer
): ProjectReadingSourceAreaProjection {
  const areasByKey = new Map<string, MutableSourceArea>();

  for (const file of scope.files) {
    const areaKey = findSourceAreaKey(scope.key, file.key, normalizer);
    const area = ensureArea(
      areasByKey,
      areaKey,
      getAreaDisplayPath(
        areaKey,
        file.key,
        file.displayPath,
        workspaceRootKey,
        normalizer
      )
    );
    area.filePaths.add(file.displayPath);
  }

  for (const callable of scope.callables) {
    const normalized = normalizer.normalize(callable.filePath);
    const areaKey = findSourceAreaKey(scope.key, callable.pathKey, normalizer);
    const area = ensureArea(
      areasByKey,
      areaKey,
      getAreaDisplayPath(
        areaKey,
        callable.pathKey,
        normalized.displayPath,
        workspaceRootKey,
        normalizer
      )
    );
    area.callableIds.add(callable.id);
  }

  for (const flow of scope.flows) {
    const entrypointPath = getEntrypointFilePath(flow);
    const normalized = entrypointPath
      ? normalizer.normalize(entrypointPath)
      : { key: scope.key, displayPath: scope.summary.displayPath };
    const pathKey = normalized.key;
    const areaKey = findSourceAreaKey(scope.key, pathKey, normalizer);
    const area = ensureArea(
      areasByKey,
      areaKey,
      getAreaDisplayPath(
        areaKey,
        pathKey,
        entrypointPath ? normalized.displayPath : scope.summary.displayPath,
        workspaceRootKey,
        normalizer
      )
    );
    area.entrypointUnitIds.add(flow.entrypointUnitId);
  }

  // A detected empty scope still needs one honest navigation target instead of
  // disappearing from its own second-stage guide.
  if (areasByKey.size === 0) {
    ensureArea(areasByKey, scope.key, scope.summary.displayPath);
  }

  const selectedAreas = selectDeterministicTopK(
    areasByKey.values(),
    PROJECT_READING_AREA_LIMIT,
    (left, right) => compareText(left.key, right.key)
  );
  const areas = selectedAreas.map((area) =>
    finalizeArea(area, scope, workspaceRootKey)
  );

  return {
    areas,
    totalAreaCount: areasByKey.size,
    omittedAreaCount: areasByKey.size - areas.length
  };
}

/** Creates or returns one non-overlapping direct-child area accumulator. */
function ensureArea(
  areasByKey: Map<string, MutableSourceArea>,
  key: string,
  displayPath: string
): MutableSourceArea {
  const existing = areasByKey.get(key);
  if (existing) {
    existing.displayPaths.add(displayPath);
    return existing;
  }

  const area: MutableSourceArea = {
    key,
    displayPaths: new Set([displayPath]),
    filePaths: new Set<string>(),
    callableIds: new Set<string>(),
    entrypointUnitIds: new Set<string>()
  };
  areasByKey.set(key, area);
  return area;
}

/**
 * Finds a bounded structural directory below a scope with an iterative walk.
 * A file directly inside the scope belongs to the scope-root area itself.
 */
function findSourceAreaKey(
  scopeKey: string,
  sourcePathKey: string,
  normalizer: PortableProjectPathNormalizer
): string {
  if (!normalizer.contains(scopeKey, sourcePathKey)) {
    return scopeKey;
  }

  const firstParent = getPortableParentKey(sourcePathKey);
  if (!firstParent || !normalizer.contains(scopeKey, firstParent)) {
    return scopeKey;
  }

  const visited = new Set<string>();
  const ancestors: string[] = [];
  let currentKey = firstParent;

  while (!visited.has(currentKey)) {
    visited.add(currentKey);
    if (currentKey === scopeKey) {
      break;
    }
    ancestors.push(currentKey);

    const parentKey = getPortableParentKey(currentKey);
    if (!parentKey || !normalizer.contains(scopeKey, parentKey)) {
      return scopeKey;
    }
    if (parentKey === scopeKey) {
      break;
    }
    if (parentKey === currentKey) {
      return scopeKey;
    }

    currentKey = parentKey;
  }

  const directChildKey = ancestors.at(-1);
  if (!directChildKey) {
    return scopeKey;
  }

  const directChildName = getPortableProjectBaseName(directChildKey);
  if (!TWO_SEGMENT_AREA_CONTAINERS.has(directChildName.toLowerCase())) {
    return directChildKey;
  }

  const desiredDepth = normalizer.depth(scopeKey) + 2;
  return ancestors.find((key) => normalizer.depth(key) === desiredDepth)
    ?? directChildKey;
}

/** Converts one accumulator into a bounded public source-area fact. */
function finalizeArea(
  area: MutableSourceArea,
  scope: IndexedProjectReadingScope,
  workspaceRootKey: string
): ProjectReadingSourceArea {
  const representativeFilePaths = selectDeterministicTopK(
    area.filePaths,
    REPRESENTATIVE_FILE_LIMIT,
    compareText
  );
  const displayPath = selectDeterministicTopK(
    area.displayPaths,
    1,
    compareText
  )[0] ?? createWorkspaceDisplayPath(area.key, workspaceRootKey);

  return {
    id: createAreaId(scope.summary.id, area.key),
    rootPath: area.key,
    displayPath,
    basis: getAreaBasis(area.key, scope, workspaceRootKey),
    analyzedFileCount: area.filePaths.size,
    callableCount: area.callableIds.size,
    entrypointCount: area.entrypointUnitIds.size,
    representativeFilePaths,
    omittedFileCount: area.filePaths.size - representativeFilePaths.length
  };
}

/** Classifies an area only from explicit workspace and framework-root evidence. */
function getAreaBasis(
  areaKey: string,
  scope: IndexedProjectReadingScope,
  workspaceRootKey: string
): ProjectReadingAreaBasis {
  if (areaKey === workspaceRootKey) {
    return "workspaceRoot";
  }
  if (scope.frameworkRootKeys.has(areaKey)) {
    return "frameworkRoot";
  }

  return "sourceDirectory";
}

/** Returns the route or operation source file without guessing from names. */
function getEntrypointFilePath(flow: SemanticFlow): string | undefined {
  return flow.steps.find((step) => step.kind === "route" || step.kind === "operation")?.filePath;
}

/** Stable identity preserves both selected scope and normalized area root. */
function createAreaId(scopeId: string, areaKey: string): string {
  return `${scopeId}:area:${encodeURIComponent(areaKey)}`;
}

/** Formats a canonical area key relative to its canonical workspace key. */
function createWorkspaceDisplayPath(areaKey: string, workspaceRootKey: string): string {
  if (areaKey === workspaceRootKey) {
    return ".";
  }

  const prefix = workspaceRootKey.endsWith("/")
    ? workspaceRootKey
    : `${workspaceRootKey}/`;
  return areaKey.startsWith(prefix) ? areaKey.slice(prefix.length) : areaKey;
}

/** Retains source casing while truncating a source path to its area depth. */
function getAreaDisplayPath(
  areaKey: string,
  sourceKey: string,
  sourceDisplayPath: string,
  workspaceRootKey: string,
  normalizer: PortableProjectPathNormalizer
): string {
  if (areaKey === workspaceRootKey) {
    return ".";
  }
  if (!normalizer.contains(workspaceRootKey, areaKey)) {
    return createWorkspaceDisplayPath(areaKey, workspaceRootKey);
  }

  const relativeAreaDepth = normalizer.depth(areaKey) - normalizer.depth(workspaceRootKey);
  const relativeSourceSegments = sourceDisplayPath.split("/").filter(Boolean);

  if (
    normalizer.contains(areaKey, sourceKey)
    && relativeAreaDepth > 0
    && relativeSourceSegments.length >= relativeAreaDepth
  ) {
    return relativeSourceSegments.slice(0, relativeAreaDepth).join("/");
  }

  return createWorkspaceDisplayPath(areaKey, workspaceRootKey);
}

/** Locale-independent comparison for reproducible persisted projections. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
