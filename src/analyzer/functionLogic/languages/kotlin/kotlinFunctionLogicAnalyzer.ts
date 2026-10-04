/**
 * Kotlin Function Logic public analysis adapter. The common bounded scheduler
 * owns CFG/data flow; this module applies Kotlin-specific post-test-loop and
 * source-proven labeled-jump routing without copying the shared CFG builder.
 */
import type { FunctionLogicAnalysis, FunctionLogicAnalysisInput, FunctionLogicEdge } from "../../types";
import { analyzeStructuredFunctionLogic, type StructuredFunctionLogicAdapter } from "../../core/structuredFunctionLogicAnalyzer";
import { createFunctionLogicEdge, createFunctionLogicSummary } from "../../core/functionLogicSupport";
import { createFunctionLogicValueFlowsForBindings, type FunctionLogicValueFacts } from "../../dataFlow";
import {
  kotlinPositionOffset, parseKotlinSource, setKotlinSyntaxCachePreferredPath,
  type KotlinSource, type KotlinSyntaxNode
} from "../../../languages/kotlin";
import {
  classifyKotlinStatement, collectKotlinFunctionCallsites, createKotlinFunctionLogicGaps,
  findKotlinOwnedNodes, findSelectedKotlinCallable, unwrapKotlinNode
} from "./kotlinFunctionLogicSyntax";
import { classifyKotlinFlowTask, describeKotlinControl, getKotlinRootStatements } from "./kotlinExpressionFlow";
import { collectKotlinFunctionValueFacts } from "./kotlinFunctionValueFacts";

const KOTLIN_ADAPTER: StructuredFunctionLogicAdapter<KotlinSource, KotlinSyntaxNode> = {
  language: "kotlin", findSelectedCallable: findSelectedKotlinCallable,
  getRootStatements: getKotlinRootStatements,
  classifyStatement: (source, filePath, task) => classifyKotlinFlowTask(source, filePath, task)
    ?? classifyKotlinStatement(source, filePath, task),
  describeControl: describeKotlinControl, collectCallsites: collectKotlinFunctionCallsites,
  collectValueFacts: collectKotlinFunctionValueFacts, createDefaultGaps: createKotlinFunctionLogicGaps,
  hasParseError: (source, node) => source.diagnostics.some((diagnostic) => diagnostic.from <= node.to && diagnostic.to >= node.from)
};

/** Analyzes current source, reusing the shared parser snapshot/cache boundary. */
export function analyzeKotlinFunctionLogic(input: FunctionLogicAnalysisInput): FunctionLogicAnalysis {
  setKotlinSyntaxCachePreferredPath(input.functionNode.filePath);
  const source = input.sourceText === undefined ? undefined : parseKotlinSource(input.sourceText, input.functionNode.filePath);
  const analysis = analyzeStructuredFunctionLogic(input, source, KOTLIN_ADAPTER);
  if (!source || !analysis.blocks.length) return analysis;
  const callable = findSelectedKotlinCallable(source, input.functionNode);
  if (!callable) return analysis;
  return correctKotlinControlTransfers(analysis, source, callable.body, collectKotlinFunctionValueFacts(source, callable));
}

/** Routes the do body before its first test and verifies labels by lexical loop spans. */
function correctKotlinControlTransfers(analysis: FunctionLogicAnalysis, source: KotlinSource,
  body: KotlinSyntaxNode, valueFacts: FunctionLogicValueFacts): FunctionLogicAnalysis {
  const loops = findKotlinOwnedNodes(body, (node) => node.name === "statement")
    .map((statement) => ({ statement, loop: unwrapKotlinNode(statement),
      label: statement.children.find((node) => node.name === "label") }))
    .filter((row) => ["forStatement", "whileStatement", "doWhileStatement"].includes(row.loop.name));
  const blockOffsets = new Map(analysis.blocks.map((block) => [block.id, {
    from: kotlinPositionOffset(source, { line: block.range.startLine, character: block.range.startCharacter }),
    to: kotlinPositionOffset(source, { line: block.range.endLine, character: block.range.endCharacter })
  }]));
  const loopBlockFor = (node: KotlinSyntaxNode) => analysis.blocks.find((block) => block.kind === "loop"
    && (blockOffsets.get(block.id)?.from ?? Infinity) <= node.from && blockOffsets.get(block.id)?.to === node.to);
  let edges = [...analysis.edges];
  for (const row of loops.filter((candidate) => candidate.loop.name === "doWhileStatement")) {
    const loopBlock = loopBlockFor(row.loop);
    const firstBody = loopBlock && edges.find((edge) => edge.sourceId === loopBlock.id && edge.kind === "iterate");
    if (!loopBlock || !firstBody) continue;
    edges = edges.map((edge) => edge.targetId === loopBlock.id && edge.kind !== "repeat" && edge.kind !== "continue"
      ? reroute(edge, firstBody.targetId) : edge.sourceId === loopBlock.id && edge.kind === "iterate"
        ? createFunctionLogicEdge(edge.sourceId, edge.targetId, "true", "repeat while true", edge.confidence,
          { key: "logic-edge-true" }) : edge);
  }
  let unknownLabels = 0;
  const exit = analysis.blocks.find((block) => block.kind === "exit");
  for (const block of analysis.blocks.filter((candidate) => ["break", "continue", "return"].includes(candidate.kind)
    && candidate.confidence === "inferred")) {
    const offsets = blockOffsets.get(block.id);
    const jumpText = offsets ? source.text.slice(offsets.from, offsets.to).trim() : "";
    const label = /^(?:break|continue|return)@([\p{L}\p{N}_`]+)/u.exec(jumpText)?.[1]?.replace(/^`|`$/gu, "");
    const targetLoop = label && offsets && block.kind !== "return" ? loops.filter((row) =>
      row.loop.from <= offsets.from && offsets.to <= row.loop.to
      && row.label && source.text.slice(row.label.from, row.label.to).replace(/@\s*$/u, "").trim().replace(/^`|`$/gu, "") === label)
      .sort((left, right) => (left.loop.to - left.loop.from) - (right.loop.to - right.loop.from))[0] : undefined;
    const targetBlock = targetLoop && loopBlockFor(targetLoop.loop);
    const targetId = targetBlock ? block.kind === "continue" ? targetBlock.id
      : edges.find((edge) => edge.sourceId === targetBlock.id && edge.kind === "exit")?.targetId : undefined;
    if (!targetId) unknownLabels += 1;
    edges = edges.map((edge) => edge.sourceId !== block.id ? edge
      : createFunctionLogicEdge(edge.sourceId, targetId ?? exit?.id ?? edge.targetId, edge.kind,
        jumpText || edge.label, targetId ? "exact" : "inferred"));
  }
  const gaps = unknownLabels ? [...analysis.gaps, { code: "parseLimited" as const,
    message: `${unknownLabels} labeled jump target(s) could not be proven in this callable. Those transfers are inferred unknown exits, not exact nearest-loop targets.` }] : analysis.gaps;
  // Kotlin break targets loops rather than when. The lexical nearest-loop span
  // corrects the shared switch fallback even for an unlabeled nested break.
  let unresolvedUnlabeledJumps = 0;
  for (const block of analysis.blocks.filter((candidate) => (candidate.kind === "break" || candidate.kind === "continue")
    && candidate.confidence === "exact")) {
    const offsets = blockOffsets.get(block.id);
    const nearestLoop = offsets && loops.filter((row) => row.loop.from <= offsets.from && offsets.to <= row.loop.to)
      .sort((left, right) => (left.loop.to - left.loop.from) - (right.loop.to - right.loop.from))[0];
    const target = nearestLoop && loopBlockFor(nearestLoop.loop);
    const targetId = target ? block.kind === "continue" ? target.id
      : edges.find((edge) => edge.sourceId === target.id && edge.kind === "exit")?.targetId : undefined;
    if (!targetId) unresolvedUnlabeledJumps += 1;
    edges = edges.map((edge) => edge.sourceId === block.id
      ? createFunctionLogicEdge(edge.sourceId, targetId ?? exit?.id ?? edge.targetId, edge.kind, edge.label, targetId ? "exact" : "inferred") : edge);
  }
  if (unresolvedUnlabeledJumps) gaps.push({ code: "parseLimited",
    message: `${unresolvedUnlabeledJumps} break/continue target(s) are unresolved or outside the retained loop blocks; those transfers remain inferred.` });
  const unique = new Map(edges.map((edge) => [edge.id, edge]));
  const blocks = new Map<string, FunctionLogicAnalysis["blocks"][number]>();
  for (const block of analysis.blocks) {
    const previous = blocks.get(block.id);
    // A short-circuit tail or Elvis fallback can join multiple source routes.
    // It remains one source block even when the tree scheduler saw two seeds.
    blocks.set(block.id, previous ? { ...previous,
      parentBlockId: previous.parentBlockId === block.parentBlockId ? block.parentBlockId : undefined } : block);
  }
  const callsites = analysis.callsites.map((call) => {
    const from = kotlinPositionOffset(source, { line: call.range.startLine, character: call.range.startCharacter });
    const to = kotlinPositionOffset(source, { line: call.range.endLine, character: call.range.endCharacter });
    const callText = source.text.slice(from, to);
    const owningDecision = [...blocks.values()].filter((block) => block.condition
      && block.condition.expression.includes(callText)
      && (blockOffsets.get(block.id)?.from ?? Infinity) <= from && (blockOffsets.get(block.id)?.to ?? -1) >= to)
      .sort((left, right) => {
        const leftRange = blockOffsets.get(left.id)!;
        const rightRange = blockOffsets.get(right.id)!;
        return (leftRange.to - leftRange.from) - (rightRange.to - rightRange.from) || right.depth - left.depth;
      })[0];
    return owningDecision ? { ...call, blockId: owningDecision.id } : call;
  });
  const projectedBlocks = attachPredicateReads(attachSelectedArmWrites([...blocks.values()], analysis), source, valueFacts, analysis);
  const projectedEdges = [...unique.values()];
  const dataFlow = createFunctionLogicValueFlowsForBindings({ blocks: projectedBlocks, edges: projectedEdges,
    bindingIds: new Set((analysis.valueBindings ?? []).map((binding) => binding.id)) });
  if (dataFlow.omittedFlowCount) gaps.push({ code: "parseLimited",
    message: `${dataFlow.omittedFlowCount} value-flow relationships were omitted after Kotlin control-transfer correction.` });
  return { ...analysis, blocks: projectedBlocks, edges: projectedEdges, callsites, gaps,
    valueFlows: dataFlow.valueFlows, summary: createFunctionLogicSummary(projectedBlocks, callsites.length) };
}

/** Maps lexical read facts to the decision that evaluates a source predicate. */
function attachPredicateReads(blocks: FunctionLogicAnalysis["blocks"], source: KotlinSource,
  facts: FunctionLogicValueFacts, analysis: FunctionLogicAnalysis): FunctionLogicAnalysis["blocks"] {
  const bindings = new Map((analysis.valueBindings ?? []).map((binding) => [binding.id, binding]));
  const reads = facts.accesses.filter((access) => access.access === "read" || access.access === "readwrite")
    .map((access) => ({ access,
      from: kotlinPositionOffset(source, { line: access.range.startLine, character: access.range.startCharacter }),
      to: kotlinPositionOffset(source, { line: access.range.endLine, character: access.range.endCharacter }) }));
  return blocks.map((block) => {
    if (!block.condition) return block;
    const group = /^kotlin-condition:(\d+):(\d+)$/u.exec(block.condition.groupId);
    if (!group) return block;
    const groupFrom = Number(group[1]);
    const groupTo = Number(group[2]);
    const predicate = block.condition.expression.replace(/ != null$/u, "").trim();
    if (!predicate) return block;
    let cursor = groupFrom;
    let selected: typeof reads = [];
    while (cursor < groupTo) {
      const found = source.text.indexOf(predicate, cursor);
      if (found < 0 || found + predicate.length > groupTo) break;
      const before = source.text[found - 1] ?? "";
      const after = source.text[found + predicate.length] ?? "";
      const isIdentifier = /^[\p{L}_][\p{L}\p{N}_]*$/u.test(predicate);
      if (!isIdentifier || (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after))) {
        selected = reads.filter((row) => found <= row.from && row.to <= found + predicate.length);
        if (selected.length) break;
      }
      cursor = found + Math.max(1, predicate.length);
    }
    if (!selected.length) return block;
    const accesses = [...(block.valueAccesses ?? [])];
    for (const row of selected) {
      const binding = bindings.get(row.access.bindingId);
      if (!binding || accesses.some((access) => access.bindingId === binding.id && access.access === "read" && access.usage === "consume")) continue;
      accesses.push({ bindingId: binding.id, name: binding.name, bindingKind: binding.kind,
        access: "read", usage: "consume", confidence: row.access.confidence });
    }
    return { ...block, valueAccesses: accesses };
  });
}

/** Adds writes whose synthetic selected values share one source expression span. */
function attachSelectedArmWrites(blocks: FunctionLogicAnalysis["blocks"], analysis: FunctionLogicAnalysis): FunctionLogicAnalysis["blocks"] {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  return blocks.map((block) => {
    const accesses = [...(block.valueAccesses ?? [])];
    for (const change of block.valueChanges ?? []) {
      if (change.targetKind !== "variable" || !["initialize", "assign", "update", "iterate"].includes(change.operation)) continue;
      const candidates = (analysis.valueBindings ?? []).filter((binding) => binding.name === change.target);
      const ancestors = new Set<string>();
      let current: FunctionLogicAnalysis["blocks"][number] | undefined = block;
      while (current && !ancestors.has(current.id)) {
        ancestors.add(current.id);
        current = current.parentBlockId ? blocksById.get(current.parentBlockId) : undefined;
      }
      const binding = candidates.find((candidate) => ancestors.has(candidate.definitionBlockId))
        ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (!binding || accesses.some((access) => access.bindingId === binding.id
        && (access.access === "write" || access.access === "readwrite"))) continue;
      accesses.push({ bindingId: binding.id, name: binding.name, bindingKind: binding.kind,
        access: change.operation === "update" || (change.operation === "assign" && change.operator !== "=") ? "readwrite" : "write",
        confidence: change.confidence });
    }
    return accesses.length ? { ...block, valueAccesses: accesses } : block;
  });
}

/** Keeps the transfer's semantic kind/confidence while changing its verified destination. */
function reroute(edge: FunctionLogicEdge, targetId: string): FunctionLogicEdge {
  return createFunctionLogicEdge(edge.sourceId, targetId, edge.kind, edge.label, edge.confidence, edge.presentation);
}
