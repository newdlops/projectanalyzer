/**
 * Focused Function Tutor recommendation tests for typed object parameters.
 * They verify source-proven field paths become complete object inputs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import {
  analyzeFunctionTutorDeclaration,
  type FunctionTutorStaticValue
} from "../../analyzer/functionTutor";
import { buildFunctionTutorModel, CodeFlowInsightCache } from "../../application/codeFlow";
import type { SymbolNode } from "../../shared/types";
import { createGraph } from "./helpers/projectReadingGuideFixtures";

const filePath = "/workspace/src/recommendations.ts";
const sourceText = [
  "interface Payload {",
  "  profile: { score: number; mode: \"free\" | \"pro\" };",
  "  items: string[];",
  "  enabled?: boolean;",
  "}",
  "export function recommend(payload: Payload, metadata: Record<string, unknown>, dynamic) {",
  "  if (payload.profile.score >= 10 && payload.profile.mode === \"pro\") return 1;",
  "  if (payload.items.length > 1) return 2;",
  "  if (payload.enabled === true) return 3;",
  "  if (metadata.status === \"active\") return 4;",
  "  if (dynamic.state === \"ready\") return 5;",
  "  return 0;",
  "}"
].join("\n");

test("context-backed recommended values trace typed object fields", async () => {
  const node = createRecommendationNode();
  const functionLogic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic });
  assert.deepEqual(declaration.constraints.map((constraint) => ({
    parameter: declaration.parameters.find((parameter) => parameter.id === constraint.parameterId)?.name,
    path: constraint.memberPath,
    operator: constraint.operator,
    operand: scalarValue(constraint.operand)
  })), [
    { parameter: "payload", path: ["profile", "score"], operator: "gte", operand: 10 },
    { parameter: "payload", path: ["profile", "mode"], operator: "eq", operand: "pro" },
    { parameter: "payload", path: ["items"], operator: "length-gt", operand: 1 },
    { parameter: "payload", path: ["enabled"], operator: "eq", operand: true },
    { parameter: "metadata", path: ["status"], operator: "eq", operand: "active" },
    { parameter: "dynamic", path: ["state"], operator: "eq", operand: "ready" }
  ]);

  const graph = createGraph({ files: [filePath], callables: [node] });
  const insights = new CodeFlowInsightCache().get(graph);
  const model = await buildFunctionTutorModel({
    graph,
    declaration,
    functionLogic,
    architectureIndex: insights.functionArchitecture,
    semanticFlows: insights.semanticFlows,
    functionIndex: insights.functionIndex,
    readSourceText: async () => sourceText
  });
  const payload = declaration.parameters.find((parameter) => parameter.name === "payload");
  const metadata = declaration.parameters.find((parameter) => parameter.name === "metadata");
  const dynamic = declaration.parameters.find((parameter) => parameter.name === "dynamic");
  assert.ok(payload && metadata && dynamic);

  const payloadCandidates = (model.candidatesByParameter.get(payload.id) ?? [])
    .filter((candidate) => candidate.source === "constraint-boundary")
    .map((candidate) => candidate.value);
  assert.ok(payloadCandidates.length >= 6);
  assert.ok(payloadCandidates.every((value) => value.kind === "object"), "member boundaries must remain complete object inputs");
  assert.deepEqual(uniqueScalars(payloadCandidates, ["profile", "score"]), [9, 10]);
  assert.deepEqual(uniqueScalars(payloadCandidates, ["profile", "mode"]), ["free", "pro"]);
  assert.deepEqual(uniqueLengths(payloadCandidates, ["items"]), [1, 2]);
  assert.deepEqual(uniqueScalars(payloadCandidates, ["enabled"]), [false, true]);

  const metadataCandidates = (model.candidatesByParameter.get(metadata.id) ?? [])
    .filter((candidate) => candidate.source === "constraint-boundary")
    .map((candidate) => candidate.value);
  assert.deepEqual(uniqueScalars(metadataCandidates, ["status"]), ["", "active"]);
  assert.ok(metadataCandidates.every((value) => value.kind === "object"));

  const dynamicCandidates = (model.candidatesByParameter.get(dynamic.id) ?? [])
    .filter((candidate) => candidate.source === "constraint-boundary")
    .map((candidate) => candidate.value);
  assert.deepEqual(uniqueScalars(dynamicCandidates, ["state"]), ["", "ready"]);
  assert.ok(dynamicCandidates.every((value) => value.kind === "object"));

  const recommendedSeed = model.seeds.find((seed) => seed.inputs.every((input) => input.value.kind !== "unknown"));
  assert.ok(recommendedSeed, "the Values recommendation action must receive a fully known ranked seed");
  assert.ok(recommendedSeed.inputs.every((input) => input.value.kind === "object"));
  assert.equal(readPath(recommendedSeed.inputs[0].value, ["profile", "score"])?.kind, "number");
  assert.equal(readPath(recommendedSeed.inputs[1].value, ["status"])?.kind, "string");
  assert.equal(readPath(recommendedSeed.inputs[2].value, ["state"])?.kind, "string");
});

/** Creates the exact selected-function range used by both analyzers. */
function createRecommendationNode(): SymbolNode {
  const lines = sourceText.split("\n");
  const startLine = lines.findIndex((line) => line.startsWith("export function recommend"));
  const nameStart = lines[startLine].indexOf("recommend");
  return {
    id: "function:recommendations",
    kind: "function",
    name: "recommend",
    qualifiedName: "recommend",
    filePath,
    range: { startLine, startCharacter: 0, endLine: lines.length - 1, endCharacter: 1 },
    selectionRange: { startLine, startCharacter: nameStart, endLine: startLine, endCharacter: nameStart + "recommend".length },
    language: "typescript"
  };
}

/** Reads one bounded static own-data path without invoking user objects. */
function readPath(root: FunctionTutorStaticValue, path: string[]): FunctionTutorStaticValue | undefined {
  let current = root;
  for (const part of path) {
    if (current.kind === "object") {
      const entry = current.entries.find((candidate) => candidate.key === part);
      if (!entry) return undefined;
      current = entry.value;
      continue;
    }
    if (current.kind === "array" && /^(0|[1-7])$/u.test(part)) {
      const item = current.items[Number(part)];
      if (!item) return undefined;
      current = item;
      continue;
    }
    return undefined;
  }
  return current;
}

function scalarValue(value: FunctionTutorStaticValue | undefined): boolean | number | string | null | undefined {
  if (!value || value.kind === "undefined") return undefined;
  if (value.kind === "null") return null;
  return value.kind === "boolean" || value.kind === "number" || value.kind === "string" ? value.value : undefined;
}

function uniqueScalars(values: FunctionTutorStaticValue[], path: string[]): Array<boolean | number | string | null> {
  const result = values.flatMap((value) => {
    const target = readPath(value, path);
    const scalar = scalarValue(target);
    return scalar === undefined ? [] : [scalar];
  });
  return [...new Set(result)].sort(compareScalar);
}

function uniqueLengths(values: FunctionTutorStaticValue[], path: string[]): number[] {
  return [...new Set(values.flatMap((value) => {
    const target = readPath(value, path);
    return target?.kind === "array" ? [target.items.length] : target?.kind === "string" ? [target.value.length] : [];
  }))].sort((left, right) => left - right);
}

function compareScalar(left: boolean | number | string | null, right: boolean | number | string | null): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}
