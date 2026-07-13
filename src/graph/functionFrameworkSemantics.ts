/**
 * Function-to-framework semantic linker for ProjectGraph metadata.
 *
 * The module connects detected framework units to callable graph nodes using
 * source ranges and conservative name evidence. It intentionally stays
 * independent from VS Code, storage, protocol, and Webview modules so payload
 * adapters can consume the resulting indexes without pulling in UI concerns.
 */

import type {
  EdgeConfidence,
  FrameworkUnit,
  FrameworkUnitKind,
  ProjectGraph,
  SourceRange,
  SymbolNode
} from "../shared/types";

/** Callable symbol kinds that can be linked to framework semantic units. */
export type FunctionFrameworkCallableKind = "function" | "method" | "constructor";

/** Framework-aware role assigned to a callable from its matched unit. */
export type FunctionFrameworkRole =
  | "routeHandler"
  | "resolver"
  | "controller"
  | "modelOperation"
  | "serializer"
  | "schema"
  | "service"
  | "repository"
  | "component"
  | "cliCommand"
  | "adapter"
  | "lifecycle"
  | "unknown";

/** Stable semantic tags that describe why a framework-linked callable matters. */
export type FunctionFrameworkTag =
  | "frameworkDispatch"
  | "database"
  | "serialization"
  | "schema"
  | "businessLogic"
  | "persistence"
  | "ui"
  | "cli"
  | "middleware"
  | "dependencyInjection"
  | "configuration"
  | "module"
  | "lifecycle";

/** Evidence categories used to explain one function-framework link. */
export type FunctionFrameworkEvidenceKind =
  | "sameFile"
  | "rangeInside"
  | "rangeOverlap"
  | "nameMatch"
  | "qualifiedNameMatch";

/** One source-backed reason why a callable was linked to a framework unit. */
export type FunctionFrameworkEvidence = {
  kind: FunctionFrameworkEvidenceKind;
  description: string;
};

/** Per-function semantic record consumed by later payload and query layers. */
export type FunctionFrameworkSemantic = {
  functionId: string;
  frameworkUnitId: string;
  framework: string;
  unitKind: FrameworkUnitKind;
  role: FunctionFrameworkRole;
  tags: FunctionFrameworkTag[];
  evidence: FunctionFrameworkEvidence[];
  confidence?: EdgeConfidence;
};

/** Coverage counters for the framework semantic linker. */
export type FunctionFrameworkSemanticsSummary = {
  graphVersion: string;
  frameworkUnitCount: number;
  callableNodeCount: number;
  semanticLinkCount: number;
  matchedFunctionCount: number;
  matchedFrameworkUnitCount: number;
  unmatchedFrameworkUnitCount: number;
};

/** Indexed function-framework links for host-side graph consumers. */
export type FunctionFrameworkSemantics = {
  graphVersion: string;
  semantics: FunctionFrameworkSemantic[];
  semanticsByFunctionId: Map<string, FunctionFrameworkSemantic[]>;
  semanticsByFrameworkUnitId: Map<string, FunctionFrameworkSemantic[]>;
  summary: FunctionFrameworkSemanticsSummary;
};

type CallableSymbolNode = SymbolNode & { kind: FunctionFrameworkCallableKind };

type FunctionFrameworkMatch = {
  evidence: FunctionFrameworkEvidence[];
  confidence: EdgeConfidence;
};

type NameCandidate = {
  normalized: string;
  source: "name" | "qualifiedName";
};

const RANGE_ONLY_DISABLED_UNIT_KINDS = new Set<FrameworkUnitKind>(["app", "module"]);

const AMBIGUOUS_QUALIFIED_NAME_SEGMENTS = new Set([
  "app",
  "apps",
  "module",
  "modules",
  "url",
  "urls",
  "route",
  "routes",
  "view",
  "views",
  "model",
  "models",
  "serializer",
  "serializers",
  "schema",
  "schemas",
  "service",
  "services",
  "repository",
  "repositories",
  "config",
  "configuration",
  "settings",
  "index",
  "main",
  "default",
  "handler",
  "command",
  "commands",
  "middleware",
  "provider",
  "providers",
  "dependency",
  "dependencies"
]);

/**
 * Builds conservative framework semantics for callable nodes in a ProjectGraph.
 *
 * Matching is iterative and file-indexed: a framework unit must share a source
 * file with a callable, then provide range evidence or name/qualified-name
 * evidence. External graph nodes and unresolved edge targets are never linked.
 */
export function createFunctionFrameworkSemantics(graph: ProjectGraph): FunctionFrameworkSemantics {
  const frameworkUnits = graph.metadata.frameworkUnits ?? [];
  const callablesByFilePath = createCallableIndexByFilePath(graph.nodes);
  const semantics: FunctionFrameworkSemantic[] = [];
  const semanticsByFunctionId = new Map<string, FunctionFrameworkSemantic[]>();
  const semanticsByFrameworkUnitId = new Map<string, FunctionFrameworkSemantic[]>();
  const matchedFunctionIds = new Set<string>();
  const matchedFrameworkUnitIds = new Set<string>();

  for (const unit of frameworkUnits) {
    const callables = callablesByFilePath.get(normalizeFilePath(unit.filePath)) ?? [];

    for (const callable of callables) {
      const match = matchFrameworkUnitToCallable(unit, callable);

      if (!match) {
        continue;
      }

      const semantic: FunctionFrameworkSemantic = {
        functionId: callable.id,
        frameworkUnitId: unit.id,
        framework: unit.framework,
        unitKind: unit.kind,
        role: inferFunctionFrameworkRole(unit.kind),
        tags: inferFunctionFrameworkTags(unit.kind),
        evidence: match.evidence,
        confidence: match.confidence
      };

      semantics.push(semantic);
      appendSemantic(semanticsByFunctionId, callable.id, semantic);
      appendSemantic(semanticsByFrameworkUnitId, unit.id, semantic);
      matchedFunctionIds.add(callable.id);
      matchedFrameworkUnitIds.add(unit.id);
    }
  }

  return {
    graphVersion: graph.version,
    semantics,
    semanticsByFunctionId,
    semanticsByFrameworkUnitId,
    summary: {
      graphVersion: graph.version,
      frameworkUnitCount: frameworkUnits.length,
      callableNodeCount: countCallableNodes(callablesByFilePath),
      semanticLinkCount: semantics.length,
      matchedFunctionCount: matchedFunctionIds.size,
      matchedFrameworkUnitCount: matchedFrameworkUnitIds.size,
      unmatchedFrameworkUnitCount: frameworkUnits.length - matchedFrameworkUnitIds.size
    }
  };
}

/** Assigns the framework role represented by a matched semantic unit kind. */
export function inferFunctionFrameworkRole(unitKind: FrameworkUnitKind): FunctionFrameworkRole {
  switch (unitKind) {
    case "operation":
      return "resolver";
    case "route":
    case "view":
      return "routeHandler";
    case "controller":
      return "controller";
    case "model":
    case "entity":
      return "modelOperation";
    case "serializer":
      return "serializer";
    case "schema":
      return "schema";
    case "service":
      return "service";
    case "repository":
      return "repository";
    case "component":
      return "component";
    case "command":
      return "cliCommand";
    case "middleware":
    case "provider":
      return "adapter";
    case "configuration":
      return "lifecycle";
    default:
      return "unknown";
  }
}

/** Returns stable semantic tags for the matched framework unit kind. */
export function inferFunctionFrameworkTags(unitKind: FrameworkUnitKind): FunctionFrameworkTag[] {
  switch (unitKind) {
    case "operation":
      return ["frameworkDispatch", "schema"];
    case "route":
    case "view":
    case "controller":
      return ["frameworkDispatch"];
    case "model":
    case "entity":
      return ["database"];
    case "serializer":
      return ["serialization"];
    case "schema":
      return ["schema"];
    case "service":
      return ["businessLogic"];
    case "repository":
      return ["persistence", "database"];
    case "component":
      return ["ui"];
    case "command":
      return ["cli"];
    case "middleware":
      return ["frameworkDispatch", "middleware"];
    case "provider":
      return ["dependencyInjection"];
    case "configuration":
      return ["configuration", "lifecycle"];
    case "module":
      return ["module"];
    default:
      return [];
  }
}

/** Groups real callable nodes by normalized source file path. */
function createCallableIndexByFilePath(nodes: SymbolNode[]): Map<string, CallableSymbolNode[]> {
  const callablesByFilePath = new Map<string, CallableSymbolNode[]>();

  for (const node of nodes) {
    if (!isCallableSymbolNode(node)) {
      continue;
    }

    const filePath = normalizeFilePath(node.filePath);

    if (!filePath) {
      continue;
    }

    const callables = callablesByFilePath.get(filePath) ?? [];
    callables.push(node);
    callablesByFilePath.set(filePath, callables);
  }

  for (const callables of callablesByFilePath.values()) {
    callables.sort(compareCallablePosition);
  }

  return callablesByFilePath;
}

/** Returns true only for concrete callable symbols, excluding external nodes. */
function isCallableSymbolNode(node: SymbolNode): node is CallableSymbolNode {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Evaluates range and name evidence for one same-file unit/callable pair. */
function matchFrameworkUnitToCallable(
  unit: FrameworkUnit,
  callable: CallableSymbolNode
): FunctionFrameworkMatch | undefined {
  if (normalizeFilePath(unit.filePath) !== normalizeFilePath(callable.filePath)) {
    return undefined;
  }

  const evidence: FunctionFrameworkEvidence[] = [{
    kind: "sameFile",
    description: `Framework unit and callable share ${unit.filePath}`
  }];
  const rangeEvidence = getRangeEvidence(unit, callable);
  const nameEvidence = getNameEvidence(unit, callable);

  if (rangeEvidence) {
    evidence.push(rangeEvidence);
  }

  if (nameEvidence) {
    evidence.push(nameEvidence);
  }

  if (evidence.length === 1) {
    return undefined;
  }

  return {
    evidence,
    confidence: rangeEvidence ? "exact" : "resolved"
  };
}

/** Returns precise source-range evidence when the unit kind can safely use it. */
function getRangeEvidence(
  unit: FrameworkUnit,
  callable: CallableSymbolNode
): FunctionFrameworkEvidence | undefined {
  if (!unit.range || RANGE_ONLY_DISABLED_UNIT_KINDS.has(unit.kind)) {
    return undefined;
  }

  if (rangeContainsRange(unit.range, callable.range)) {
    return {
      kind: "rangeInside",
      description: "Callable source range is inside the framework unit range"
    };
  }

  if (rangesOverlap(unit.range, callable.range)) {
    return {
      kind: "rangeOverlap",
      description: "Callable source range overlaps the framework unit range"
    };
  }

  return undefined;
}

/** Returns conservative name or qualified-name evidence for same-file matches. */
function getNameEvidence(
  unit: FrameworkUnit,
  callable: CallableSymbolNode
): FunctionFrameworkEvidence | undefined {
  const unitCandidates = createNameCandidates(unit.name, unit.qualifiedName);
  const callableCandidates = createNameCandidates(callable.name, callable.qualifiedName);

  for (const unitCandidate of unitCandidates) {
    for (const callableCandidate of callableCandidates) {
      if (unitCandidate.normalized !== callableCandidate.normalized) {
        continue;
      }

      return {
        kind: unitCandidate.source === "qualifiedName" || callableCandidate.source === "qualifiedName"
          ? "qualifiedNameMatch"
          : "nameMatch",
        description: `Framework unit ${unitCandidate.source} matches callable ${callableCandidate.source}`
      };
    }
  }

  if (RANGE_ONLY_DISABLED_UNIT_KINDS.has(unit.kind)) {
    return undefined;
  }

  const unitSegments = createSpecificUnitSegments(unitCandidates);
  const callableSegments = createQualifiedNameSegments(callable.qualifiedName);

  for (const unitSegment of unitSegments) {
    if (callableSegments.has(unitSegment)) {
      return {
        kind: "qualifiedNameMatch",
        description: "Framework unit name matches a callable qualified-name segment"
      };
    }
  }

  return undefined;
}

/** Creates exact-name candidates from simple and qualified names. */
function createNameCandidates(name: string, qualifiedName?: string): NameCandidate[] {
  const candidates: NameCandidate[] = [];

  appendNameCandidate(candidates, name, "name");

  if (qualifiedName) {
    appendNameCandidate(candidates, qualifiedName, "qualifiedName");

    const qualifiedNameSegments = splitQualifiedName(qualifiedName);
    const terminalSegment = qualifiedNameSegments[qualifiedNameSegments.length - 1];

    if (terminalSegment) {
      appendNameCandidate(candidates, terminalSegment, "qualifiedName");
    }
  }

  return candidates;
}

/** Adds a normalized candidate when it contains a meaningful identifier value. */
function appendNameCandidate(
  candidates: NameCandidate[],
  value: string,
  source: NameCandidate["source"]
): void {
  const normalized = normalizeIdentifier(value);

  if (!normalized || candidates.some((candidate) => candidate.normalized === normalized)) {
    return;
  }

  candidates.push({ normalized, source });
}

/** Selects non-generic unit name segments that can match callable containers. */
function createSpecificUnitSegments(candidates: NameCandidate[]): Set<string> {
  const segments = new Set<string>();

  for (const candidate of candidates) {
    if (!isSpecificName(candidate.normalized)) {
      continue;
    }

    segments.add(candidate.normalized);
  }

  return segments;
}

/** Splits a qualified name into normalized container/member segments. */
function createQualifiedNameSegments(qualifiedName: string): Set<string> {
  const segments = new Set<string>();

  for (const segment of splitQualifiedName(qualifiedName)) {
    const normalized = normalizeIdentifier(segment);

    if (normalized) {
      segments.add(normalized);
    }
  }

  return segments;
}

/** Returns true when a unit segment is unlikely to be only a file or module label. */
function isSpecificName(normalizedName: string): boolean {
  return normalizedName.length >= 3 && !AMBIGUOUS_QUALIFIED_NAME_SEGMENTS.has(normalizedName);
}

/** Breaks common qualified-name separators without interpreting language syntax. */
function splitQualifiedName(value: string): string[] {
  return value
    .split(/[.#:/\\]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/** Normalizes source paths for same-file indexing while preserving case. */
function normalizeFilePath(filePath: string): string {
  return filePath.trim().replace(/\\/gu, "/");
}

/** Normalizes names for conservative equality across snake/camel separators. */
function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

/** Returns true when the outer range fully contains the inner range. */
function rangeContainsRange(outer: SourceRange, inner: SourceRange): boolean {
  return comparePosition(outer.startLine, outer.startCharacter, inner.startLine, inner.startCharacter) <= 0
    && comparePosition(outer.endLine, outer.endCharacter, inner.endLine, inner.endCharacter) >= 0;
}

/** Returns true when two source ranges overlap on line/character coordinates. */
function rangesOverlap(left: SourceRange, right: SourceRange): boolean {
  return comparePosition(left.startLine, left.startCharacter, right.endLine, right.endCharacter) <= 0
    && comparePosition(right.startLine, right.startCharacter, left.endLine, left.endCharacter) <= 0;
}

/** Compares two source positions using zero-based line and character values. */
function comparePosition(
  leftLine: number,
  leftCharacter: number,
  rightLine: number,
  rightCharacter: number
): number {
  if (leftLine !== rightLine) {
    return leftLine - rightLine;
  }

  return leftCharacter - rightCharacter;
}

/** Sorts callables by source position, then by stable graph identity. */
function compareCallablePosition(left: CallableSymbolNode, right: CallableSymbolNode): number {
  const position = comparePosition(
    left.range.startLine,
    left.range.startCharacter,
    right.range.startLine,
    right.range.startCharacter
  );

  if (position !== 0) {
    return position;
  }

  return left.id.localeCompare(right.id);
}

/** Appends one semantic record into a Map-backed multi-value index. */
function appendSemantic(
  index: Map<string, FunctionFrameworkSemantic[]>,
  key: string,
  semantic: FunctionFrameworkSemantic
): void {
  const records = index.get(key) ?? [];
  records.push(semantic);
  index.set(key, records);
}

/** Counts callable entries from a file-path index without re-scanning graph nodes. */
function countCallableNodes(callablesByFilePath: Map<string, CallableSymbolNode[]>): number {
  let count = 0;

  for (const callables of callablesByFilePath.values()) {
    count += callables.length;
  }

  return count;
}
