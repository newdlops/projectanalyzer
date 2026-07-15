/**
 * Graph-wide callable architecture index built from intrinsic source structure
 * and conservative framework semantics. Assessments never depend on which
 * entrypoint happened to reach the callable.
 */

import {
  createFunctionFrameworkSemantics,
  type FunctionFrameworkSemantics
} from "../../graph/functionFrameworkSemantics";
import { createPortableProjectPathNormalizer } from "../../shared/portableProjectPath";
import type { ProjectGraph, SymbolNode } from "../../shared/types";
import {
  ARCHITECTURE_EVIDENCE_LIMIT,
  collectArchitecturalLayerEvidence,
  getConfidenceRank,
  getLayerOrder
} from "./layerRules";
import type {
  ArchitecturalLayer,
  ArchitecturalLayerConfidence,
  ArchitecturalLayerEvidence,
  BusinessLogicClassification,
  FunctionArchitectureAssessment,
  FunctionArchitectureIndex,
  FunctionArchitectureInput
} from "./types";

/** Creates one reusable assessment index for an immutable ProjectGraph. */
export function createFunctionArchitectureIndex(
  graph: ProjectGraph,
  frameworkSemantics: FunctionFrameworkSemantics = createFunctionFrameworkSemantics(graph)
): FunctionArchitectureIndex {
  const assessments: FunctionArchitectureAssessment[] = [];
  const assessmentsByFunctionId = new Map<string, FunctionArchitectureAssessment>();
  const pathNormalizer = createPortableProjectPathNormalizer(graph.workspaceRoot);
  const workspacePath = pathNormalizer.normalize();

  for (const node of graph.nodes) {
    if (!isConcreteCallable(node)) {
      continue;
    }

    const assessment = assessFunctionArchitecture({
      functionId: node.id,
      projectRelativePath: getProjectRelativePath(
        node.filePath,
        workspacePath.key,
        pathNormalizer
      ),
      semantics: (frameworkSemantics.semanticsByFunctionId.get(node.id) ?? []).map((semantic) => ({
        unitKind: semantic.unitKind,
        bindingConfidence: semantic.confidence
      }))
    });
    assessments.push(assessment);
    assessmentsByFunctionId.set(node.id, assessment);
  }

  assessments.sort((left, right) => compareText(left.functionId, right.functionId));
  return {
    graphVersion: graph.version,
    assessments,
    assessmentsByFunctionId,
    summary: {
      graphVersion: graph.version,
      concreteCallableCount: assessments.length,
      classifiedCallableCount: assessments.filter((item) => item.layer !== "unclassified").length,
      businessCandidateCount: assessments.filter((item) =>
        item.businessLogic === "domainRuleCandidate"
          || item.businessLogic === "applicationWorkflowCandidate"
      ).length,
      conflictedCallableCount: assessments.filter((item) => item.conflicted).length
    }
  };
}

/** Classifies one callable from intrinsic facts and preserves conflicting layers. */
export function assessFunctionArchitecture(
  input: FunctionArchitectureInput
): FunctionArchitectureAssessment {
  const allEvidence = collectArchitecturalLayerEvidence(
    input.projectRelativePath ?? "",
    input.semantics
  );
  const visibleEvidence = allEvidence.slice(0, ARCHITECTURE_EVIDENCE_LIMIT);
  const layers = uniqueLayers(allEvidence);
  const testEvidence = allEvidence.find((item) => item.supports === "test");

  if (testEvidence) {
    return createAssessment(input.functionId, "test", "high", visibleEvidence, allEvidence, []);
  }
  if (layers.length === 0) {
    return createAssessment(input.functionId, "unclassified", "unknown", [], [], []);
  }
  if (layers.length > 1) {
    return createAssessment(
      input.functionId,
      "unclassified",
      "unknown",
      visibleEvidence,
      allEvidence,
      layers
    );
  }

  const layer = layers[0];
  return createAssessment(
    input.functionId,
    layer,
    getAssessmentConfidence(allEvidence),
    visibleEvidence,
    allEvidence,
    []
  );
}

function createAssessment(
  functionId: string,
  layer: ArchitecturalLayer,
  confidence: ArchitecturalLayerConfidence,
  visibleEvidence: ArchitecturalLayerEvidence[],
  allEvidence: ArchitecturalLayerEvidence[],
  alternatives: ArchitecturalLayer[]
): FunctionArchitectureAssessment {
  const excludesBusinessTarget = allEvidence.some((item) => item.excludesBusinessTarget);
  return {
    functionId,
    layer,
    confidence,
    businessLogic: getBusinessLogicClassification(layer, excludesBusinessTarget),
    purity: "unknown",
    evidence: visibleEvidence,
    omittedEvidenceCount: Math.max(0, allEvidence.length - visibleEvidence.length),
    alternatives,
    conflicted: alternatives.length > 1
  };
}

function getBusinessLogicClassification(
  layer: ArchitecturalLayer,
  excludesBusinessTarget: boolean
): BusinessLogicClassification {
  if (excludesBusinessTarget) {
    return "notBusinessLogic";
  }
  if (layer === "domain") {
    return "domainRuleCandidate";
  }
  if (layer === "application") {
    return "applicationWorkflowCandidate";
  }
  if (layer === "unclassified") {
    return "unknown";
  }
  return "notBusinessLogic";
}

function getAssessmentConfidence(
  evidence: readonly ArchitecturalLayerEvidence[]
): ArchitecturalLayerConfidence {
  let selected: Exclude<ArchitecturalLayerConfidence, "unknown"> = "low";
  for (const item of evidence) {
    if (getConfidenceRank(item.confidence) > getConfidenceRank(selected)) {
      selected = item.confidence;
    }
  }
  return selected;
}

function uniqueLayers(evidence: readonly ArchitecturalLayerEvidence[]): ArchitecturalLayer[] {
  return [...new Set(evidence.map((item) => item.supports))]
    .sort((left, right) => getLayerOrder(left) - getLayerOrder(right));
}

function isConcreteCallable(node: SymbolNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Returns only a contained workspace-relative path for source-structure rules. */
function getProjectRelativePath(
  filePath: string,
  workspaceKey: string,
  normalizer: ReturnType<typeof createPortableProjectPathNormalizer>
): string | undefined {
  const sourcePath = normalizer.normalize(filePath);
  return normalizer.contains(workspaceKey, sourcePath.key)
    ? sourcePath.displayPath
    : undefined;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
