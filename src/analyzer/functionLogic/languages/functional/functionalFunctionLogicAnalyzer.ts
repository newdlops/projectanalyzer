/**
 * Function Logic adapter for true pipe-forward languages. It renders exact
 * input/stage order and preserves each named stage as an independent drill site.
 */

import { createNodeId } from "../../../../shared/ids";
import type { SourceRange } from "../../../../shared/types";
import {
  collectFunctionalPipelineChains,
  parseFunctionalSource
} from "../../../languages/functional";
import {
  functionalOffsetsRange,
  trimFunctionalSpan
} from "../../../languages/functional/functionalSourceText";
import type {
  FunctionalCallableSyntax,
  FunctionalPipelineChain,
  FunctionalSourceSnapshot
} from "../../../languages/functional/types";
import {
  createFunctionLogicBlockId,
  createFunctionLogicSummary,
  createSyntheticFunctionLogicBlock,
  createUnavailableFunctionLogicAnalysis,
  isPotentialFunctionEffectCall,
  normalizeFunctionLogicMaxBlocks
} from "../../core/functionLogicSupport";
import type {
  FunctionLogicAnalysis,
  FunctionLogicAnalysisInput,
  FunctionLogicBlock,
  FunctionLogicCallsite,
  FunctionLogicEdge,
  FunctionLogicGap
} from "../../types";

/** Analyzes one selected F#, OCaml, or Elixir named function. */
export function analyzeFunctionalFunctionLogic(
  input: FunctionLogicAnalysisInput
): FunctionLogicAnalysis {
  const language = input.functionNode.language.toLowerCase();
  if (input.sourceText === undefined) {
    return createUnavailableFunctionLogicAnalysis(
      input.functionNode,
      functionalLanguageOrUnsupported(language),
      "sourceUnavailable",
      "Current source is required to expand a functional pipeline."
    );
  }
  const source = parseFunctionalSource(
    input.sourceText,
    input.functionNode.language,
    input.functionNode.filePath
  );
  if (!source) {
    return createUnavailableFunctionLogicAnalysis(
      input.functionNode,
      "unsupported",
      "languageUnsupported",
      "No pipe-forward Function Logic adapter is registered for this language."
    );
  }
  const callable = findSelectedCallable(source, input);
  if (!callable) {
    return createUnavailableFunctionLogicAnalysis(
      input.functionNode,
      source.profile.language,
      "functionNotFound",
      "The selected functional-language declaration no longer matches this source snapshot."
    );
  }
  return buildFunctionalAnalysis(source, callable, input);
}

/** Joins exact callable selection identity before falling back to containment. */
function findSelectedCallable(
  source: FunctionalSourceSnapshot,
  input: FunctionLogicAnalysisInput
): FunctionalCallableSyntax | undefined {
  const selection = input.functionNode.selectionRange;
  const exact = source.callables.filter((callable) => {
    const range = functionalOffsetsRange(source.lines, callable.selectionFrom, callable.selectionTo);
    return range.startLine === selection.startLine
      && range.startCharacter === selection.startCharacter;
  });
  if (exact.length === 1) {
    return exact[0];
  }
  return source.callables
    .filter((callable) => callable.name === input.functionNode.name)
    .sort((left, right) =>
      (left.declarationTo - left.declarationFrom)
        - (right.declarationTo - right.declarationFrom)
    )[0];
}

/** Builds a bounded linear CFG because pipe-forward stages execute sequentially. */
function buildFunctionalAnalysis(
  source: FunctionalSourceSnapshot,
  callable: FunctionalCallableSyntax,
  input: FunctionLogicAnalysisInput
): FunctionLogicAnalysis {
  const maxBlocks = normalizeFunctionLogicMaxBlocks(input.maxBlocks);
  const anchorRange = functionalOffsetsRange(
    source.lines,
    callable.selectionFrom,
    callable.selectionTo
  );
  const endRange = functionalOffsetsRange(source.lines, callable.bodyTo, callable.bodyTo);
  const entry = createSyntheticFunctionLogicBlock(
    input.functionNode,
    "entry",
    `Enter ${callable.name}`,
    `Start evaluating ${source.profile.language} function ${callable.qualifiedName}.`,
    anchorRange
  );
  const exit = createSyntheticFunctionLogicBlock(
    input.functionNode,
    "exit",
    `Exit ${callable.name}`,
    "The final pipeline value becomes the function result.",
    endRange
  );
  const chains = collectFunctionalPipelineChains(source, callable);
  const candidates = chains.length > 0
    ? chains.flatMap((chain) => createPipelineBlocks(source, input, chain))
    : createCollapsedBodyBlock(source, input, callable);
  const availableBodySlots = Math.max(0, maxBlocks - 2);
  const visibleCandidates = candidates.slice(0, availableBodySlots);
  const blocks = maxBlocks === 1
    ? [entry]
    : [entry, ...visibleCandidates, exit];
  const edges = createLinearEdges(blocks);
  const visibleIds = new Set(visibleCandidates.map((block) => block.id));
  const callsites = chains.flatMap((chain) => createPipelineCallsites(input, chain))
    .filter((callsite) => candidates.some((block) =>
      visibleIds.has(block.id) && rangesOverlap(block.range, callsite.range)
    ));
  const gaps = createFunctionalGaps(source, chains, candidates.length - visibleCandidates.length);
  return {
    functionNode: input.functionNode,
    language: source.profile.language,
    signature: callable.signature,
    lexicalOwnerQualifiedName: callable.qualifiedName.split(".").slice(0, -1).join(".") || undefined,
    blocks,
    edges,
    callsites,
    gaps,
    summary: createFunctionLogicSummary(blocks, callsites.length)
  };
}

/** Creates one input block followed by exact named/anonymous stage blocks. */
function createPipelineBlocks(
  source: FunctionalSourceSnapshot,
  input: FunctionLogicAnalysisInput,
  chain: FunctionalPipelineChain
): FunctionLogicBlock[] {
  const inputLabel = `pipeline input · ${chain.inputText}`;
  const blocks: FunctionLogicBlock[] = [{
    id: createFunctionLogicBlockId(input.functionNode.filePath, "operation", chain.inputRange, inputLabel),
    kind: "operation",
    label: inputLabel,
    detail: "Evaluates the value supplied to the first pipe-forward stage.",
    depth: 0,
    confidence: "exact",
    filePath: input.functionNode.filePath,
    range: chain.inputRange
  }];
  for (const stage of chain.stages) {
    const effect = Boolean(stage.calleeName && isPotentialFunctionEffectCall(stage.calleeName));
    const label = `pipe → ${stage.text} · previous result`;
    blocks.push({
      id: createFunctionLogicBlockId(
        input.functionNode.filePath,
        effect ? "effect" : "call",
        stage.range,
        label
      ),
      kind: effect ? "effect" : "call",
      label,
      detail: source.profile.pipeInsertion === "firstArgument"
        ? "Passes the previous result as this stage's first argument."
        : "Passes the previous result as this stage's final argument.",
      depth: 0,
      confidence: effect ? "inferred" : "exact",
      filePath: input.functionNode.filePath,
      range: stage.range
    });
  }
  return blocks;
}

/** Keeps a non-pipeline body visible without inventing statement semantics. */
function createCollapsedBodyBlock(
  source: FunctionalSourceSnapshot,
  input: FunctionLogicAnalysisInput,
  callable: FunctionalCallableSyntax
): FunctionLogicBlock[] {
  const body = trimFunctionalSpan(source.text, callable.bodyFrom, callable.bodyTo);
  if (!body.text) {
    return [];
  }
  const range = functionalOffsetsRange(source.lines, body.from, body.to);
  const label = `expression · ${body.text}`;
  return [{
    id: createFunctionLogicBlockId(input.functionNode.filePath, "operation", range, label),
    kind: "operation",
    label,
    detail: "Retains the complete expression without claiming unsupported internal control flow.",
    depth: 0,
    confidence: "exact",
    filePath: input.functionNode.filePath,
    range
  }];
}

/** Converts named stages to independent conservative drill callsites. */
function createPipelineCallsites(
  input: FunctionLogicAnalysisInput,
  chain: FunctionalPipelineChain
): FunctionLogicCallsite[] {
  return chain.stages.flatMap((stage) =>
    stage.calleeName && stage.calleeText
      ? [{
          filePath: input.functionNode.filePath,
          range: stage.range,
          calleeName: stage.calleeName,
          calleeText: stage.calleeText,
          callChain: "pipeline" as const
        }]
      : []
  );
}

/** Links visible blocks in exact evaluation order without recursive traversal. */
function createLinearEdges(blocks: readonly FunctionLogicBlock[]): FunctionLogicEdge[] {
  const edges: FunctionLogicEdge[] = [];
  for (let index = 1; index < blocks.length; index += 1) {
    const source = blocks[index - 1];
    const target = blocks[index];
    if (!source || !target) {
      continue;
    }
    edges.push({
      id: createNodeId(["functional-logic-edge", source.id, target.id]),
      sourceId: source.id,
      targetId: target.id,
      kind: "next",
      confidence: "exact"
    });
  }
  return edges;
}

/** Reports only real semantic boundaries and visible budget truncation. */
function createFunctionalGaps(
  source: FunctionalSourceSnapshot,
  chains: readonly FunctionalPipelineChain[],
  omittedBlockCount: number
): FunctionLogicGap[] {
  const gaps: FunctionLogicGap[] = [{
    code: "dynamicBehavior",
    message: `${source.profile.language} pipe order is exact; higher-order callbacks, macros, and runtime dispatch remain runtime-dependent.`
  }];
  if (chains.length === 0) {
    gaps.push({
      code: "parseLimited",
      message: "No pipe-forward expression was found; pattern matching and composition remain collapsed."
    });
  }
  if (omittedBlockCount > 0) {
    gaps.push({
      code: "parseLimited",
      message: `${omittedBlockCount} pipeline blocks were omitted by the configured Function Logic limit.`
    });
  }
  return gaps;
}

/** Narrows known functional graph languages for source-unavailable results. */
function functionalLanguageOrUnsupported(
  language: string
): "fsharp" | "ocaml" | "elixir" | "unsupported" {
  return language === "fsharp" || language === "ocaml" || language === "elixir"
    ? language
    : "unsupported";
}

/** Accepts a block/callsite overlap without relying on byte offsets. */
function rangesOverlap(left: SourceRange, right: SourceRange): boolean {
  return comparePosition(
    left.startLine,
    left.startCharacter,
    right.endLine,
    right.endCharacter
  ) <= 0 && comparePosition(
    right.startLine,
    right.startCharacter,
    left.endLine,
    left.endCharacter
  ) <= 0;
}

/** Lexicographically compares zero-based editor positions. */
function comparePosition(
  leftLine: number,
  leftCharacter: number,
  rightLine: number,
  rightCharacter: number
): number {
  return leftLine - rightLine || leftCharacter - rightCharacter;
}
