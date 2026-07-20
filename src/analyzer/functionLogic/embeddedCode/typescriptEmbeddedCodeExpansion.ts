/**
 * Host-CFG integration for statically parsed TypeScript/JavaScript code text.
 * Immediate consumers splice before their host statement; stored, constructed,
 * and timer programs remain explicit non-runtime/deferred side branches.
 */

import * as ts from "typescript";
import { createContentHash } from "../../../shared/hash";
import {
  createFunctionLogicBlockId,
  createFunctionLogicEdge
} from "../core/functionLogicSupport";
import type {
  FunctionLogicBlock,
  FunctionLogicCallsite,
  FunctionLogicEdge,
  FunctionLogicGap,
  FunctionLogicValueBinding,
  FunctionLogicValueFlow
} from "../types";
import type {
  TypeScriptEmbeddedCodeExpansion,
  TypeScriptEmbeddedCodeMode,
  TypeScriptEmbeddedCodeRequest
} from "./types";
import { planTypeScriptEmbeddedProgram } from "./typescriptEmbeddedProgramPlanner";

const MAX_EMBEDDED_CODE_REGIONS = 16;

type PlannedArtifact = {
  anchorBlockId: string;
  mode: TypeScriptEmbeddedCodeMode;
  blocks: FunctionLogicBlock[];
};

/** Plans every bounded request and integrates it without implying deferred execution. */
export function expandTypeScriptEmbeddedCode(input: {
  sourceFile: ts.SourceFile;
  scriptKind: ts.ScriptKind;
  filePath: string;
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  requests: readonly TypeScriptEmbeddedCodeRequest[];
  dynamicConsumerCount: number;
  remainingBlockBudget: number;
}): TypeScriptEmbeddedCodeExpansion {
  const orderedRequests = [...input.requests].sort((left, right) =>
    left.sourceOrder - right.sourceOrder
    || left.range.endLine - right.range.endLine
    || left.range.endCharacter - right.range.endCharacter
  );
  const selectedRequests = orderedRequests.slice(0, MAX_EMBEDDED_CODE_REGIONS);
  const blocksById = new Map(input.blocks.map((block) => [block.id, block]));
  const beforeByAnchorId = new Map<string, FunctionLogicBlock[]>();
  const afterByAnchorId = new Map<string, FunctionLogicBlock[]>();
  const callsites: FunctionLogicCallsite[] = [];
  const valueBindings: FunctionLogicValueBinding[] = [];
  const valueFlows: FunctionLogicValueFlow[] = [];
  const artifacts: PlannedArtifact[] = [];
  let edges = [...input.edges];
  let remainingBlocks = Math.max(0, Math.floor(input.remainingBlockBudget));
  let parseDiagnosticCount = 0;
  let omittedBlockCount = 0;
  let omittedRegionCount = Math.max(0, orderedRequests.length - selectedRequests.length);

  for (let index = 0; index < selectedRequests.length; index += 1) {
    const request = selectedRequests[index];
    const anchor = blocksById.get(request.anchorBlockId);
    if (!anchor || remainingBlocks <= 0) {
      omittedRegionCount += 1;
      continue;
    }
    const boundary = createEmbeddedBoundary(input.filePath, request, anchor, index);
    const plan = planTypeScriptEmbeddedProgram({
      hostFilePath: input.filePath,
      scriptKind: input.scriptKind,
      request,
      boundaryBlock: boundary,
      maxBlocks: remainingBlocks
    });
    const specializedBlocks = specializeBoundarySummary(plan.blocks, request, plan.functionCount);
    const rootExit = specializedBlocks.find((block) =>
      block.kind === "exit"
      && block.parentBlockId === boundary.id
      && block.label === "End embedded program"
    );
    const artifact: PlannedArtifact = {
      anchorBlockId: anchor.id,
      mode: request.mode,
      blocks: specializedBlocks
    };
    artifacts.push(artifact);
    appendArtifactBlocks(
      request.mode === "immediate" ? beforeByAnchorId : afterByAnchorId,
      anchor.id,
      specializedBlocks
    );

    if (request.mode === "immediate") {
      edges = edges.map((edge) => edge.targetId === anchor.id
        ? createFunctionLogicEdge(
            edge.sourceId,
            boundary.id,
            edge.kind,
            edge.label,
            edge.confidence
          )
        : edge);
      edges.push(...plan.edges);
      edges.push(createFunctionLogicEdge(
        rootExit?.id ?? boundary.id,
        anchor.id,
        "next",
        rootExit ? "resume host flow" : "embedded text unavailable",
        request.confidence
      ));
    } else {
      edges.push(createFunctionLogicEdge(
        anchor.id,
        boundary.id,
        request.mode === "deferred" ? "deferred" : "defines",
        createBoundaryEdgeLabel(request.mode),
        request.confidence
      ));
      edges.push(...plan.edges);
    }

    callsites.push(...plan.callsites);
    valueBindings.push(...plan.valueBindings);
    valueFlows.push(...plan.valueFlows);
    remainingBlocks = Math.max(0, remainingBlocks - specializedBlocks.length);
    parseDiagnosticCount += plan.parseDiagnosticCount;
    omittedBlockCount += plan.omittedBlockCount;
  }

  const blocks = input.blocks.flatMap((block) => [
    ...(beforeByAnchorId.get(block.id) ?? []),
    block,
    ...(afterByAnchorId.get(block.id) ?? [])
  ]);
  const gaps = createExpansionGaps({
    dynamicConsumerCount: input.dynamicConsumerCount,
    parseDiagnosticCount,
    omittedBlockCount,
    omittedRegionCount
  });
  return {
    blocks,
    edges: deduplicateEdges(edges),
    callsites: deduplicateCallsites(callsites),
    valueBindings: deduplicateById(valueBindings),
    valueFlows: deduplicateById(valueFlows),
    gaps,
    addedBlockCount: artifacts.reduce((count, artifact) =>
      count + artifact.blocks.length,
    0)
  };
}

/** Creates a stable source-backed boundary without using decoded text as an ID. */
function createEmbeddedBoundary(
  filePath: string,
  request: TypeScriptEmbeddedCodeRequest,
  anchor: FunctionLogicBlock,
  index: number
): FunctionLogicBlock {
  const identityLabel = [
    "embedded-code",
    request.mode,
    request.consumer,
    request.sourceOrder,
    index,
    createContentHash(request.code).slice(0, 16)
  ].join(":");
  return {
    id: createFunctionLogicBlockId(filePath, "embedded", request.range, identityLabel),
    kind: "embedded",
    label: createBoundaryLabel(request, 0),
    detail: createBoundaryDetail(request.mode),
    depth: anchor.depth,
    parentBlockId: anchor.parentBlockId,
    branchLabel: anchor.branchLabel,
    confidence: request.confidence,
    filePath,
    range: request.range
  };
}

/** Replaces the provisional boundary label after the program function count is known. */
function specializeBoundarySummary(
  blocks: readonly FunctionLogicBlock[],
  request: TypeScriptEmbeddedCodeRequest,
  functionCount: number
): FunctionLogicBlock[] {
  return blocks.map((block, index) => index === 0
    ? {
        ...block,
        label: createBoundaryLabel(request, functionCount),
        detail: createBoundaryDetail(request.mode, functionCount)
      }
    : block);
}

/** Names the static boundary and its multiple callable definitions compactly. */
function createBoundaryLabel(
  request: TypeScriptEmbeddedCodeRequest,
  functionCount: number
): string {
  const action = request.mode === "immediate" ? "execute"
    : request.mode === "deferred" ? "schedule"
      : request.mode === "callable" ? "create callable from"
        : "store";
  const functions = functionCount > 0
    ? ` · ${functionCount} function${functionCount === 1 ? "" : "s"}`
    : "";
  return `${action} code text · ${request.consumer}${functions}`;
}

/** Explains runtime timing without claiming that parsed text was observed executing. */
function createBoundaryDetail(
  mode: TypeScriptEmbeddedCodeMode,
  functionCount = 0
): string {
  const functions = functionCount > 0
    ? ` ${functionCount} contained callable definition${functionCount === 1 ? " is" : "s are"} analyzed as separate scopes.`
    : "";
  if (mode === "immediate") {
    return "A statically complete code string is parsed without execution and placed before the host statement completes."
      + functions;
  }
  if (mode === "deferred") {
    return "A statically complete timer program is parsed as a separately scheduled path with no immediate return edge."
      + functions;
  }
  if (mode === "callable") {
    return "Static text defines a callable body; creation does not execute that body."
      + functions;
  }
  return "The parser recognizes this stored literal as code, but no execution consumer is proven."
    + functions;
}

/** Labels non-runtime relationships for both visual and accessible semantics. */
function createBoundaryEdgeLabel(mode: TypeScriptEmbeddedCodeMode): string {
  if (mode === "deferred") return "scheduled code · no immediate return";
  if (mode === "callable") return "created body · not invoked";
  return "stored program · not executed";
}

/** Retains request order around one shared host statement anchor. */
function appendArtifactBlocks(
  byAnchorId: Map<string, FunctionLogicBlock[]>,
  anchorBlockId: string,
  blocks: readonly FunctionLogicBlock[]
): void {
  const values = byAnchorId.get(anchorBlockId) ?? [];
  values.push(...blocks);
  byAnchorId.set(anchorBlockId, values);
}

/** Creates explicit diagnostics instead of silently dropping dynamic or bounded code. */
function createExpansionGaps(input: {
  dynamicConsumerCount: number;
  parseDiagnosticCount: number;
  omittedBlockCount: number;
  omittedRegionCount: number;
}): FunctionLogicGap[] {
  const gaps: FunctionLogicGap[] = [];
  if (input.dynamicConsumerCount > 0) {
    gaps.push({
      code: "dynamicBehavior",
      message: `${input.dynamicConsumerCount} code-consuming call(s) use runtime-built text and were not parsed or executed.`
    });
  }
  if (input.parseDiagnosticCount > 0) {
    gaps.push({
      code: "parseLimited",
      message: `${input.parseDiagnosticCount} embedded-code parser diagnostic(s) were recovered conservatively; verify the literal before relying on its internal paths.`
    });
  }
  if (input.omittedBlockCount > 0) {
    gaps.push({
      code: "parseLimited",
      message: `${input.omittedBlockCount} embedded statement, callable scope, or value-flow fact(s) were omitted after the shared Function Logic block limit.`
    });
  }
  if (input.omittedRegionCount > 0) {
    gaps.push({
      code: "parseLimited",
      message: `${input.omittedRegionCount} additional embedded code region(s) were omitted after the bounded region/block limit.`
    });
  }
  return gaps;
}

/** Keeps stable edge identities unique after sequential host rewrites. */
function deduplicateEdges(edges: readonly FunctionLogicEdge[]): FunctionLogicEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (seen.has(edge.id)) return false;
    seen.add(edge.id);
    return true;
  });
}

/** Keeps one virtual callsite per exact scope/block/name relationship. */
function deduplicateCallsites(
  callsites: readonly FunctionLogicCallsite[]
): FunctionLogicCallsite[] {
  const seen = new Set<string>();
  return callsites.filter((callsite) => {
    const key = [
      callsite.blockId ?? "",
      callsite.calleeText,
      callsite.relation ?? "call",
      callsite.range.startLine,
      callsite.range.startCharacter
    ].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Generic stable-ID de-duplication for bindings and value flows. */
function deduplicateById<T extends { id: string }>(values: readonly T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
}

