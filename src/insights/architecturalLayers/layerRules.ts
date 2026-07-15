/**
 * Conservative intrinsic rules for callable architecture layers.
 * Rules use anchored source segments and existing framework semantics; symbol
 * names, fan-in, leaf status, and caller layers never decide a layer.
 */

import type { FrameworkUnitKind } from "../../shared/types";
import type {
  ArchitecturalLayer,
  ArchitecturalLayerEvidence,
  FunctionArchitectureSemanticInput
} from "./types";

/** Maximum reasons retained on one callable assessment. */
export const ARCHITECTURE_EVIDENCE_LIMIT = 5;

const INTERFACE_UNIT_KINDS = new Set<FrameworkUnitKind>([
  "route", "operation", "controller", "view", "serializer", "component", "command"
]);

const DATA_UNIT_KINDS = new Set<FrameworkUnitKind>(["repository", "model", "entity"]);
const INFRASTRUCTURE_UNIT_KINDS = new Set<FrameworkUnitKind>([
  "app", "configuration", "module"
]);

const TEST_DIRECTORY_SEGMENTS = new Set(["test", "tests", "__tests__", "spec", "specs"]);
const INTERFACE_DIRECTORY_SEGMENTS = new Set([
  "presentation", "controllers", "routes", "resolvers"
]);
const APPLICATION_DIRECTORY_SEGMENTS = new Set(["application", "usecase", "usecases"]);
const DATA_DIRECTORY_SEGMENTS = new Set([
  "persistence", "dao", "database", "databases", "orm"
]);
const INFRASTRUCTURE_DIRECTORY_SEGMENTS = new Set([
  "infrastructure", "infra", "clients", "gateways", "bootstrap", "config", "configuration"
]);
const CROSS_CUTTING_DIRECTORY_SEGMENTS = new Set([
  "middleware", "middlewares", "interceptors", "observability", "telemetry", "logging"
]);

/** Returns all intrinsic source and framework evidence for one callable. */
export function collectArchitecturalLayerEvidence(
  filePath: string,
  semantics: readonly FunctionArchitectureSemanticInput[]
): ArchitecturalLayerEvidence[] {
  const sourceEvidence = collectSourceStructureEvidence(filePath);

  // Test source is decisive: fixture services and repositories must not appear
  // as production business targets merely because they reuse production names.
  if (sourceEvidence.some((evidence) => evidence.kind === "testSource")) {
    return sourceEvidence;
  }

  const evidence = [...sourceEvidence];
  for (const semantic of semantics) {
    const semanticEvidence = createFrameworkSemanticEvidence(semantic);
    if (semanticEvidence) {
      evidence.push(semanticEvidence);
    }
  }
  return deduplicateEvidence(evidence);
}

/** Maps only framework unit kinds with a narrow structural interpretation. */
function createFrameworkSemanticEvidence(
  semantic: FunctionArchitectureSemanticInput
): ArchitecturalLayerEvidence | undefined {
  const bindingConfidence = semantic.bindingConfidence;
  const confidence = bindingConfidence === "inferred" || bindingConfidence === "unresolved"
    ? "low"
    : "medium";

  if (INTERFACE_UNIT_KINDS.has(semantic.unitKind)) {
    return frameworkEvidence(
      `framework-${semantic.unitKind}-interface`,
      "interface",
      confidence,
      `Framework semantic identifies a ${semantic.unitKind} boundary.`,
      bindingConfidence
    );
  }
  if (semantic.unitKind === "service") {
    return frameworkEvidence(
      "framework-service-application",
      "application",
      confidence,
      "Framework semantic identifies a service; treat it as an application-workflow candidate.",
      bindingConfidence
    );
  }
  if (DATA_UNIT_KINDS.has(semantic.unitKind)) {
    return frameworkEvidence(
      `framework-${semantic.unitKind}-data`,
      "dataAccess",
      confidence,
      `Framework semantic identifies a ${semantic.unitKind} persistence surface.`,
      bindingConfidence
    );
  }
  if (semantic.unitKind === "middleware") {
    return frameworkEvidence(
      "framework-middleware-cross-cutting",
      "crossCutting",
      confidence,
      "Framework semantic identifies request middleware.",
      bindingConfidence
    );
  }
  if (INFRASTRUCTURE_UNIT_KINDS.has(semantic.unitKind)) {
    return frameworkEvidence(
      `framework-${semantic.unitKind}-infrastructure`,
      "infrastructure",
      confidence,
      `Framework semantic identifies ${semantic.unitKind} or lifecycle infrastructure.`,
      bindingConfidence
    );
  }

  // provider, dependency, and schema meanings vary too widely to decide a layer.
  return undefined;
}

/** Extracts anchored directory evidence without using symbol or filename labels. */
function collectSourceStructureEvidence(filePath: string): ArchitecturalLayerEvidence[] {
  const normalized = filePath.replace(/\\/gu, "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const fileName = segments.at(-1) ?? "";

  if (isTestSource(segments, fileName)) {
    return [sourceEvidence(
      "test-source",
      "test",
      "high",
      "Source is inside an anchored test location or uses a conventional test filename."
    )];
  }

  const adapterIndex = segments.lastIndexOf("adapters");
  const adapterDirection = adapterIndex >= 0 ? segments[adapterIndex + 1] : undefined;
  if (adapterDirection === "in") {
    return [sourceEvidence(
      "source-adapter-in-interface",
      "interface",
      "medium",
      "Source is under an inbound adapter boundary."
    )];
  }
  if (adapterDirection === "out") {
    return [sourceEvidence(
      "source-adapter-out-infrastructure",
      "infrastructure",
      "medium",
      "Source is under an outbound adapter boundary."
    )];
  }

  const domainIndex = segments.lastIndexOf("domain");
  if (domainIndex >= 0) {
    const domainTail = segments.slice(domainIndex + 1);
    const isPort = domainTail.some((segment) =>
      segment === "ports" || segment === "repositories"
    );
    return [sourceEvidence(
      isPort ? "source-domain-port" : "source-domain",
      "domain",
      "medium",
      isPort
        ? "Source is under a domain port/repository contract; it is not treated as a domain rule."
        : "Source is under an anchored domain directory.",
      isPort
    )];
  }

  if (segments.some((segment) => APPLICATION_DIRECTORY_SEGMENTS.has(segment))) {
    return [sourceEvidence(
      "source-application",
      "application",
      "medium",
      "Source is under an anchored application/use-case directory."
    )];
  }

  if (segments.some((segment) => DATA_DIRECTORY_SEGMENTS.has(segment))) {
    return [sourceEvidence(
      "source-data-access",
      "dataAccess",
      "medium",
      "Source is under an anchored persistence/data-access directory."
    )];
  }

  if (segments.some((segment) => INTERFACE_DIRECTORY_SEGMENTS.has(segment))) {
    return [sourceEvidence(
      "source-interface",
      "interface",
      "medium",
      "Source is under an anchored interface/presentation directory."
    )];
  }

  if (segments.some((segment) => CROSS_CUTTING_DIRECTORY_SEGMENTS.has(segment))) {
    return [sourceEvidence(
      "source-cross-cutting",
      "crossCutting",
      "medium",
      "Source is under an anchored middleware or observability directory."
    )];
  }

  if (segments.some((segment) => INFRASTRUCTURE_DIRECTORY_SEGMENTS.has(segment))) {
    const containsRepository = segments.some((segment) =>
      segment === "repository" || segment === "repositories"
    );
    return [sourceEvidence(
      containsRepository ? "source-infrastructure-repository" : "source-infrastructure",
      containsRepository ? "dataAccess" : "infrastructure",
      "medium",
      containsRepository
        ? "Repository implementation is under an anchored infrastructure directory."
        : "Source is under an anchored infrastructure directory."
    )];
  }

  return [];
}

function isTestSource(segments: readonly string[], fileName: string): boolean {
  return segments.some((segment) => TEST_DIRECTORY_SEGMENTS.has(segment))
    || /(?:^|\.)test\.[^.]+$/u.test(fileName)
    || /(?:^|\.)spec\.[^.]+$/u.test(fileName)
    || /^test_.+\.py$/u.test(fileName)
    || /_test\.py$/u.test(fileName);
}

function frameworkEvidence(
  ruleId: string,
  supports: ArchitecturalLayer,
  confidence: "medium" | "low",
  description: string,
  bindingConfidence: FunctionArchitectureSemanticInput["bindingConfidence"]
): ArchitecturalLayerEvidence {
  return {
    kind: "frameworkSemantic",
    ruleId,
    supports,
    confidence,
    description,
    bindingConfidence
  };
}

function sourceEvidence(
  ruleId: string,
  supports: ArchitecturalLayer,
  confidence: "high" | "medium",
  description: string,
  excludesBusinessTarget = false
): ArchitecturalLayerEvidence {
  return {
    kind: ruleId === "test-source" ? "testSource" : "sourceStructure",
    ruleId,
    supports,
    confidence,
    description,
    excludesBusinessTarget
  };
}

function deduplicateEvidence(
  evidence: readonly ArchitecturalLayerEvidence[]
): ArchitecturalLayerEvidence[] {
  const byRule = new Map<string, ArchitecturalLayerEvidence>();
  for (const item of evidence) {
    const key = `${item.ruleId}\0${item.supports}`;
    const current = byRule.get(key);
    if (!current || getConfidenceRank(item.confidence) > getConfidenceRank(current.confidence)) {
      byRule.set(key, item);
    }
  }
  return [...byRule.values()].sort((left, right) =>
    getLayerOrder(left.supports) - getLayerOrder(right.supports)
      || compareText(left.ruleId, right.ruleId)
  );
}

export function getLayerOrder(layer: ArchitecturalLayer): number {
  return [
    "interface", "application", "domain", "dataAccess", "infrastructure",
    "crossCutting", "test", "unclassified"
  ].indexOf(layer);
}

export function getConfidenceRank(confidence: "high" | "medium" | "low"): number {
  return confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
