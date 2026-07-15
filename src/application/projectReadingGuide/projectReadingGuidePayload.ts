/**
 * Presentation adapter for the two-stage Project Reading Plan.
 *
 * The domain projector keeps host-side lookup state. This adapter emits only
 * JSON data needed by the first three scope cards or one explicitly requested
 * scope, and never forwards opaque unresolved targets as source buttons.
 */

import {
  type ProjectReadingGuideIndex,
  type ProjectReadingPath,
  type ProjectReadingScopeSummary,
  type ProjectReadingStep,
  type ProjectScopeReadingGuide
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
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import type { ProjectGraph } from "../../shared/types";
import { createContentHash } from "../../shared/hash";
import {
  createSourceDisplayFormatter,
  type SourceDisplayFormatter
} from "../sourcePresentation";

/** Maximum stack identities retained in the one-line first-read headline. */
const HEADLINE_NAME_LIMIT = 3;

/** Independent Webview budgets defend the protocol even if domain limits grow. */
const VISIBLE_SCOPE_LIMIT = 3;
const VISIBLE_AREA_LIMIT = 5;
const VISIBLE_FLOW_LIMIT = 3;
const VISIBLE_STEP_LIMIT = 5;

/** Maximum representative source labels retained for one visible area. */
const VISIBLE_AREA_FILE_LIMIT = 3;

/** Character cap preventing one unusual path from dominating the lazy payload. */
const SOURCE_DISPLAY_CHARACTER_LIMIT = 160;

/** Host callback that converts a concrete graph ID into a snapshot-local token. */
export type ProjectReadingSourceTokenFactory = (
  nodeId: string
) => SourceNodeToken | undefined;

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
  guide: ProjectScopeReadingGuide,
  createSourceToken?: ProjectReadingSourceTokenFactory
): ProjectScopeReadingGuidePayload {
  // The absolute root stays host-side. Only normalizer-produced relative labels
  // or filename-only fallbacks cross into the Webview.
  const sourceDisplay = createSourceDisplayFormatter(guide.workspaceRoot);

  return {
    graphVersion: guide.graphVersion,
    scope: createScopePayload(guide.scope),
    areas: guide.areas.slice(0, VISIBLE_AREA_LIMIT).map((area) =>
      createAreaPayload(area, sourceDisplay)
    ),
    candidateAreaCount: guide.totalAreaCount,
    omittedAreaCount: Math.max(0, guide.totalAreaCount - Math.min(
      guide.areas.length,
      VISIBLE_AREA_LIMIT
    )),
    recommendedFlows: guide.readingPaths.slice(0, VISIBLE_FLOW_LIMIT).map((path) =>
      createFlowPayload(path, sourceDisplay, createSourceToken)
    ),
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
  area: ProjectScopeReadingGuide["areas"][number],
  sourceDisplay: SourceDisplayFormatter
): ProjectReadingAreaPayload {
  return {
    id: `reading-area:${createContentHash(area.id).slice(0, 24)}`,
    displayPath: area.displayPath,
    basis: area.basis,
    analyzedFileCount: area.analyzedFileCount,
    callableCount: area.callableCount,
    entrypointCount: area.entrypointCount,
    representativeFilePaths: createRepresentativeFilePaths(
      area.representativeFilePaths,
      sourceDisplay
    )
  };
}

/** Projects one recommended path and derives display-only boundary stages. */
function createFlowPayload(
  path: ProjectReadingPath,
  sourceDisplay: SourceDisplayFormatter,
  createSourceToken: ProjectReadingSourceTokenFactory | undefined
): ProjectReadingFlowPayload {
  const visibleSteps = path.steps.slice(0, VISIBLE_STEP_LIMIT);
  const recommendation = createVisibleRecommendation(path, visibleSteps);

  return {
    id: `reading-flow:${createContentHash(path.id).slice(0, 24)}`,
    transport: path.transport,
    framework: path.framework,
    name: path.name,
    confidence: path.confidence,
    traceStatus: path.traceStatus,
    recommendation,
    steps: visibleSteps.map((step, index) =>
      createStepPayload(step, index === visibleSteps.length - 1, sourceDisplay, createSourceToken)
    ),
    omittedStepCount: Math.max(0, path.totalStepCount - visibleSteps.length),
    depthLimitReached: path.depthLimitReached,
    stepLimitReached: path.stepLimitReached,
    unresolvedCallCount: path.unresolvedCallCount
  };
}

/** Keeps START HERE visible even if a malformed/future domain payload exceeds the wire cap. */
function createVisibleRecommendation(
  path: ProjectReadingPath,
  visibleSteps: readonly ProjectReadingStep[]
): ProjectReadingFlowPayload["recommendation"] {
  const recommendation = path.recommendation;
  const targetVisible = recommendation.targetStepIndex !== undefined
    && recommendation.targetStepIndex >= 0
    && recommendation.targetStepIndex < visibleSteps.length;

  if (recommendation.targetStepIndex === undefined || targetVisible) {
    return {
      ...recommendation,
      whyRecommended: [...recommendation.whyRecommended],
      unknowns: [...recommendation.unknowns]
    };
  }

  const targetStepIndex = selectVisibleTargetIndex(visibleSteps);
  return {
    ...recommendation,
    targetStepIndex,
    explanation: targetStepIndex === undefined
      ? "The recommended target is outside this bounded payload."
      : "Start with the highlighted visible step; a stronger target is outside this bounded payload.",
    whyRecommended: [...recommendation.whyRecommended],
    unknowns: [
      "The stronger recommended target is outside the visible step budget.",
      ...recommendation.unknowns
    ].slice(0, 3)
  };
}

/** Selects the strongest visible evidence, then the handler, without guessing a layer. */
function selectVisibleTargetIndex(
  steps: readonly ProjectReadingStep[]
): number | undefined {
  const predicates: Array<(step: ProjectReadingStep) => boolean> = [
    (step) => step.readingCues.includes("startHere"),
    (step) => step.architecture.businessLogic === "domainRuleCandidate",
    (step) => step.architecture.businessLogic === "applicationWorkflowCandidate",
    (step) => step.contextInference?.role === "workflowBridgeCandidate",
    (step) => step.kind === "handler"
  ];

  for (const predicate of predicates) {
    const index = steps.findIndex(predicate);
    if (index >= 0) {
      return index;
    }
  }
  return steps.length > 0 ? 0 : undefined;
}

/** Adds presentation stages without strengthening the analyzer's resolution. */
function createStepPayload(
  step: ProjectReadingStep,
  isLastStep: boolean,
  sourceDisplay: SourceDisplayFormatter,
  createSourceToken: ProjectReadingSourceTokenFactory | undefined
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

  const sourceLocation = sourceDisplay.location(step.filePath, step.range);

  return {
    stages,
    role: step.role,
    label: createSafeStepLabel(step),
    sourceLocation,
    sourceLocationKind: getSourceLocationKind(step, sourceLocation),
    sourceToken: step.resolution === "concrete" && step.functionId
      ? createSourceToken?.(step.functionId)
      : undefined,
    architecture: {
      ...step.architecture,
      evidence: [...step.architecture.evidence],
      alternatives: [...step.architecture.alternatives]
    },
    contextInference: step.contextInference
      ? { ...step.contextInference, evidence: [...step.contextInference.evidence] }
      : undefined,
    readingCues: [...step.readingCues],
    boundaryKind
  };
}

/** Preserves whether source text identifies a target, edge, or mapping fact. */
function getSourceLocationKind(
  step: ProjectReadingStep,
  sourceLocation: string | undefined
): ProjectReadingStepPayload["sourceLocationKind"] {
  if (!sourceLocation) {
    return undefined;
  }
  if (step.resolution === "concrete") {
    return "definition";
  }
  return step.kind === "call" ? "callsite" : "evidence";
}

/** Avoids presenting path-bearing analyzer identities as reading-step labels. */
function createSafeStepLabel(step: ProjectReadingStep): string {
  for (const candidate of [step.qualifiedName, step.name]) {
    const value = candidate?.trim();
    if (value && !containsStepHostIdentity(value, step)) {
      return value.length <= SOURCE_DISPLAY_CHARACTER_LIMIT
        ? value
        : `${value.slice(0, SOURCE_DISPLAY_CHARACTER_LIMIT - 1)}…`;
    }
  }

  if (step.resolution === "external") {
    return "External call";
  }
  if (step.resolution === "unresolved") {
    return "Unresolved call";
  }
  return "Anonymous callable";
}

/** Detects exact step IDs and embedded POSIX, drive, or UNC absolute paths. */
function containsStepHostIdentity(value: string, step: ProjectReadingStep): boolean {
  const normalized = value.replace(/\\/gu, "/").toLowerCase();
  const identities = [step.functionId, step.filePath]
    .filter((identity): identity is string => Boolean(identity))
    .map((identity) => identity.replace(/\\/gu, "/").toLowerCase());

  return identities.some((identity) => normalized.includes(identity))
    || /(?:^|[:=(\s])\/(?:[^/\s:]+\/)+[^/\s:]*/u.test(normalized)
    || /(?:^|[:=(\s])[a-z]:\/(?:[^/\s:]+\/)*[^/\s:]*/u.test(normalized)
    || /(?:^|[:=(\s])\/\/[a-z0-9._-]+\/[a-z0-9._-]+/iu.test(normalized);
}

/** Keeps at most three unique, safe display paths for one measured source area. */
function createRepresentativeFilePaths(
  filePaths: readonly string[],
  sourceDisplay: SourceDisplayFormatter
): string[] {
  const visiblePaths: string[] = [];
  const seenPaths = new Set<string>();

  for (const filePath of filePaths) {
    const displayPath = sourceDisplay.path(filePath);
    if (!displayPath || seenPaths.has(displayPath)) {
      continue;
    }

    seenPaths.add(displayPath);
    visiblePaths.push(displayPath);
    if (visiblePaths.length >= VISIBLE_AREA_FILE_LIMIT) {
      break;
    }
  }

  return visiblePaths;
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
