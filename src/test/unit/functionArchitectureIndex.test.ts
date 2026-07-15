/**
 * Unit tests for graph-stable callable architecture assessments.
 * Cases guard conservative service handling, anchored structure rules,
 * conflicts, test precedence, domain ports, and purity honesty.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  assessFunctionArchitecture,
  createFunctionArchitectureIndex
} from "../../insights/architecturalLayers";
import type { ProjectGraph, SymbolNode } from "../../shared/types";

test("architectural layer insight stays independent from application and UI modules", async () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const moduleRoot = path.join(projectRoot, "src", "insights", "architecturalLayers");
  const sourceFiles = (await readdir(moduleRoot)).filter((fileName) => fileName.endsWith(".ts"));

  assert.ok(sourceFiles.length >= 4);
  for (const fileName of sourceFiles) {
    const source = await readFile(path.join(moduleRoot, fileName), "utf8");
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*(?:application|extension|protocol|webview|vscode)[^"']*["']/u
    );
  }
});

test("framework service is an application candidate and never purity proof", () => {
  const assessment = assessFunctionArchitecture({
    functionId: "place-order",
    projectRelativePath: "src/services/place-order.ts",
    semantics: [{ unitKind: "service", bindingConfidence: "resolved" }]
  });

  assert.equal(assessment.layer, "application");
  assert.equal(assessment.confidence, "medium");
  assert.equal(assessment.businessLogic, "applicationWorkflowCandidate");
  assert.equal(assessment.purity, "unknown");
  assert.notEqual(assessment.businessLogic, "domainRuleCandidate");
});

test("anchored domain source becomes a rule candidate while a domain port does not", () => {
  const rule = assessFunctionArchitecture({
    functionId: "pricing-policy",
    projectRelativePath: "src/domain/pricing/policy.ts",
    semantics: []
  });
  const port = assessFunctionArchitecture({
    functionId: "orders-port",
    projectRelativePath: "src/domain/repositories/orders.ts",
    semantics: []
  });

  assert.equal(rule.layer, "domain");
  assert.equal(rule.businessLogic, "domainRuleCandidate");
  assert.equal(port.layer, "domain");
  assert.equal(port.businessLogic, "notBusinessLogic");
});

test("conflicting domain structure and service semantic remains unclassified", () => {
  const assessment = assessFunctionArchitecture({
    functionId: "conflicted-service",
    projectRelativePath: "src/domain/conflicted-service.ts",
    semantics: [{ unitKind: "service", bindingConfidence: "resolved" }]
  });

  assert.equal(assessment.layer, "unclassified");
  assert.equal(assessment.conflicted, true);
  assert.deepEqual(assessment.alternatives, ["application", "domain"]);
  assert.equal(assessment.businessLogic, "unknown");
});

test("test source overrides production-looking framework and directory evidence", () => {
  const assessment = assessFunctionArchitecture({
    functionId: "fixture-service",
    projectRelativePath: "src/domain/__tests__/fixture.service.spec.ts",
    semantics: [{ unitKind: "service", bindingConfidence: "exact" }]
  });

  assert.equal(assessment.layer, "test");
  assert.equal(assessment.confidence, "high");
  assert.equal(assessment.businessLogic, "notBusinessLogic");
  assert.equal(assessment.alternatives.length, 0);
});

test("composite adapters and infrastructure repositories keep boundary direction", () => {
  const inbound = assessFunctionArchitecture({
    functionId: "http-adapter",
    projectRelativePath: "src/adapters/in/http.ts",
    semantics: []
  });
  const outbound = assessFunctionArchitecture({
    functionId: "billing-client",
    projectRelativePath: "src/adapters/out/billing.ts",
    semantics: []
  });
  const repository = assessFunctionArchitecture({
    functionId: "orders-repository",
    projectRelativePath: "src/infrastructure/repositories/orders.ts",
    semantics: []
  });

  assert.equal(inbound.layer, "interface");
  assert.equal(outbound.layer, "infrastructure");
  assert.equal(repository.layer, "dataAccess");
});

test("generic service, auth, core, and utility paths do not guess a layer", () => {
  for (const projectRelativePath of [
    "src/services/orders.ts",
    "src/auth/check.ts",
    "src/core/run.ts",
    "src/utils/format.ts"
  ]) {
    const assessment = assessFunctionArchitecture({
      functionId: projectRelativePath,
      projectRelativePath,
      semantics: []
    });
    assert.equal(assessment.layer, "unclassified", projectRelativePath);
    assert.equal(assessment.businessLogic, "unknown", projectRelativePath);
  }
});

test("checkout ancestors never contaminate workspace-relative source rules", () => {
  const cases = [
    {
      workspaceRoot: "/tmp/test/domain/application/repository/workspace",
      filePath: "/tmp/test/domain/application/repository/workspace/src/plain.ts"
    },
    {
      workspaceRoot: "C:\\test\\domain\\application\\workspace",
      filePath: "c:\\test\\domain\\application\\workspace\\src\\plain.ts"
    }
  ];

  for (const fixture of cases) {
    const graph = createArchitectureGraph(fixture.workspaceRoot, fixture.filePath);
    const assessment = createFunctionArchitectureIndex(graph).assessmentsByFunctionId.get("plain");
    assert.equal(assessment?.layer, "unclassified", fixture.workspaceRoot);
    assert.equal(assessment?.businessLogic, "unknown", fixture.workspaceRoot);
  }
});

/** Creates the smallest graph needed to exercise workspace-relative indexing. */
function createArchitectureGraph(workspaceRoot: string, filePath: string): ProjectGraph {
  const node: SymbolNode = {
    id: "plain",
    kind: "function",
    name: "plain",
    qualifiedName: "plain",
    filePath,
    range: createRange(),
    selectionRange: createRange(),
    language: "typescript"
  };
  return {
    workspaceRoot,
    version: "architecture-path-test",
    generatedAt: "2026-07-14T00:00:00.000Z",
    nodes: [node],
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: 1,
      symbolCount: 1,
      edgeCount: 0
    }
  };
}

function createRange(): SymbolNode["range"] {
  return { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 };
}
