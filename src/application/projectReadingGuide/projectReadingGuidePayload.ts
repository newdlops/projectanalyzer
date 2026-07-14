/**
 * Presentation adapter for the two-stage Project Reading Guide.
 *
 * The domain projector keeps host-side lookup state. This adapter emits only
 * JSON data needed by the first three scope cards or one explicitly requested
 * scope, and never forwards opaque unresolved targets as source buttons.
 */

import type {
  ProjectReadingGuideIndex,
  ProjectReadingPath,
  ProjectReadingScopeSummary,
  ProjectReadingStep,
  ProjectScopeReadingGuide
} from "../../insights/projectReadingGuide";
import type { SemanticFlowIndex } from "../../insights/semanticFlow";
import type {
  ProjectReadingAreaPayload,
  ProjectReadingFlowPayload,
  ProjectReadingGuidePayload,
  ProjectReadingScopePayload,
  ProjectReadingScopePayloadId,
  ProjectReadingStepPayload,
  ProjectScopeReadingGuidePayload
} from "../../protocol/projectReadingGuide";
import type { ProjectGraph } from "../../shared/types";
import { createContentHash } from "../../shared/hash";

/** Maximum stack identities retained in the one-line first-read headline. */
const HEADLINE_NAME_LIMIT = 3;

/** Independent Webview budgets defend the protocol even if domain limits grow. */
const VISIBLE_SCOPE_LIMIT = 3;
const VISIBLE_AREA_LIMIT = 5;
const VISIBLE_FLOW_LIMIT = 3;
const VISIBLE_STEP_LIMIT = 5;

/** Converts a bounded domain index into the initial no-symbol Webview payload. */
export function createProjectReadingGuidePayload(
  graph: ProjectGraph,
  semanticFlows: SemanticFlowIndex,
  index: ProjectReadingGuideIndex
): ProjectReadingGuidePayload {
  const frameworks = uniqueSortedStrings(index.scopes.flatMap((scope) => scope.frameworks));
  const languages = getPrimaryLanguages(graph);
  const headlineNames = (frameworks.length > 0 ? frameworks : languages)
    .slice(0, HEADLINE_NAME_LIMIT);
  const headline = headlineNames.length > 0
    ? headlineNames.join(" + ")
    : "Analyzed source structure";
  const entrypointCount = semanticFlows.summary.entrypointCount;
  const scopeLabel = index.totalScopeCount === 1 ? "scope" : "scopes";
  const executionLabel = entrypointCount > 0
    ? `${entrypointCount} HTTP/GraphQL entrypoints`
    : "no HTTP/GraphQL entrypoints detected";

  return {
    graphVersion: index.graphVersion,
    headline,
    detail:
      `${graph.metadata.fileCount} analyzed files · ${executionLabel} · `
      + `${index.totalScopeCount} ${scopeLabel}`,
    scopes: index.scopes.slice(0, VISIBLE_SCOPE_LIMIT).map(createScopePayload),
    candidateScopeCount: index.totalScopeCount,
    omittedScopeCount: Math.max(0, index.totalScopeCount - Math.min(
      index.scopes.length,
      VISIBLE_SCOPE_LIMIT
    ))
  };
}

/** Converts one selected scope without leaking the projector's maps or full flow set. */
export function createProjectScopeReadingGuidePayload(
  guide: ProjectScopeReadingGuide
): ProjectScopeReadingGuidePayload {
  return {
    graphVersion: guide.graphVersion,
    scope: createScopePayload(guide.scope),
    areas: guide.areas.slice(0, VISIBLE_AREA_LIMIT).map(createAreaPayload),
    candidateAreaCount: guide.totalAreaCount,
    omittedAreaCount: Math.max(0, guide.totalAreaCount - Math.min(
      guide.areas.length,
      VISIBLE_AREA_LIMIT
    )),
    representativeFlows: guide.readingPaths.slice(0, VISIBLE_FLOW_LIMIT).map(createFlowPayload),
    eligibleFlowCount: guide.mappedFlowCount,
    omittedFlowCount: Math.max(0, guide.mappedFlowCount - Math.min(
      guide.readingPaths.length,
      VISIBLE_FLOW_LIMIT
    )),
    unmappedEntrypointCount: guide.unmappedEntrypointCount
  };
}

/** Keeps the domain's normalized scope counters structured on the wire. */
function createScopePayload(scope: ProjectReadingScopeSummary): ProjectReadingScopePayload {
  return {
    id: createProjectReadingScopePayloadId(scope.id),
    displayPath: scope.displayPath,
    basis: scope.basis,
    frameworks: [...scope.frameworks],
    frameworkCount: scope.frameworkCount,
    omittedFrameworkCount: scope.omittedFrameworkCount,
    analyzedFileCount: scope.analyzedFileCount,
    callableCount: scope.callableCount,
    execution: { ...scope.execution }
  };
}

/** Copies one already-bounded source area into its JSON-only protocol shape. */
function createAreaPayload(
  area: ProjectScopeReadingGuide["areas"][number]
): ProjectReadingAreaPayload {
  return {
    id: `reading-area:${createContentHash(area.id).slice(0, 24)}`,
    displayPath: area.displayPath,
    basis: area.basis,
    analyzedFileCount: area.analyzedFileCount,
    callableCount: area.callableCount,
    entrypointCount: area.entrypointCount
  };
}

/** Projects one representative path and derives display-only boundary stages. */
function createFlowPayload(path: ProjectReadingPath): ProjectReadingFlowPayload {
  const visibleSteps = path.steps.slice(0, VISIBLE_STEP_LIMIT);

  return {
    id: `reading-flow:${createContentHash(path.id).slice(0, 24)}`,
    transport: path.transport,
    framework: path.framework,
    name: path.name,
    confidence: path.confidence,
    traceStatus: path.traceStatus,
    steps: visibleSteps.map((step, index) =>
      createStepPayload(step, index === visibleSteps.length - 1)
    ),
    omittedStepCount: Math.max(0, path.totalStepCount - visibleSteps.length),
    depthLimitReached: path.depthLimitReached,
    stepLimitReached: path.stepLimitReached,
    unresolvedCallCount: path.unresolvedCallCount
  };
}

/** Adds presentation stages without strengthening the analyzer's resolution. */
function createStepPayload(
  step: ProjectReadingStep,
  isLastStep: boolean
): ProjectReadingStepPayload {
  const boundaryKind = step.boundaryKind ?? getBoundaryKind(step, isLastStep);
  const stages: ProjectReadingStepPayload["stages"] = [];

  if (step.kind === "route" || step.kind === "operation") {
    stages.push("entrypoint");
  } else if (step.kind === "handler") {
    stages.push("handler");
  } else {
    stages.push("intermediate");
  }
  if (boundaryKind) {
    stages.push("boundary");
  }

  return {
    stages,
    role: step.role,
    label: step.qualifiedName ?? step.name,
    functionId: step.resolution === "concrete" ? step.functionId : undefined,
    boundaryKind
  };
}

/** Converts a canonical host scope identity into a short opaque Webview token. */
export function createProjectReadingScopePayloadId(
  domainScopeId: string
): ProjectReadingScopePayloadId {
  return `reading-scope:${createContentHash(domainScopeId).slice(0, 24)}`;
}

/** Classifies only explicit semantic roles, resolution, or the observed path end. */
function getBoundaryKind(
  step: ProjectReadingStep,
  isLastStep: boolean
): ProjectReadingStepPayload["boundaryKind"] {
  if (step.role === "repository") {
    return "repository";
  }
  if (step.role === "model") {
    return "model";
  }
  if (step.role === "sideEffect") {
    return "sideEffect";
  }
  if (step.kind === "call" && step.resolution === "external") {
    return "externalCall";
  }
  if (step.kind === "call" && step.resolution === "unresolved") {
    return "unresolvedCall";
  }

  return isLastStep && step.kind === "call" ? "observedTerminal" : undefined;
}

/** Uses analyzer-provided proportions when available, then stable declared names. */
function getPrimaryLanguages(graph: ProjectGraph): string[] {
  const summaries = graph.metadata.languageSummary;

  if (summaries && summaries.length > 0) {
    return [...summaries]
      .sort((left, right) =>
        right.fileCount - left.fileCount || compareText(left.language, right.language)
      )
      .map((summary) => summary.language);
  }

  return uniqueSortedStrings(graph.metadata.languages);
}

/** Stable distinct identity projection for compact labels. */
function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort(compareText);
}

/** Locale-independent comparison for reproducible Webview payloads. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
