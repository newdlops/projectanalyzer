/** Projects framework facts through exact source spans and opaque graph evidence. */
import type { FunctionFrameworkBehavior } from "../../../analyzer/frameworkBehavior";
import type { FunctionLogicAnalysis } from "../../../analyzer/functionLogic";
import type { FunctionFrameworkBehaviorPayload } from "../../../protocol/frameworkBehavior";
import { createContentHash } from "../../../shared/hash";
import type { SourceRange } from "../../../shared/types";
import type { CodeFlowEvidenceToken } from "../../../protocol/functionLogic";

type FrameworkProjectionContext = {
  flowId: string;
  blockIds: ReadonlyMap<string, string>;
  createEvidenceToken(filePath: string, range: SourceRange): CodeFlowEvidenceToken | undefined;
};

/** Maps only containing blocks from this function; raw source locations stay on the Host. */
export function projectFrameworkBehavior(
  behavior: FunctionFrameworkBehavior | undefined,
  logic: FunctionLogicAnalysis,
  context: FrameworkProjectionContext
): FunctionFrameworkBehaviorPayload | undefined {
  if (!behavior) return undefined;
  return {
    ...behavior,
    facts: behavior.facts.map((fact, index) => {
      const block = logic.blocks.filter((candidate) => candidate.kind !== "exit" && candidate.kind !== "entry"
        && containsStart(candidate.range, fact.range)).sort((left, right) =>
          (left.range.endLine - left.range.startLine) - (right.range.endLine - right.range.startLine)
          || (left.range.endCharacter - left.range.startCharacter) - (right.range.endCharacter - right.range.startCharacter))[0];
      return {
        id: "framework-fact:" + createContentHash(`${context.flowId}:${fact.kind}:${index}:${JSON.stringify(fact.range)}`).slice(0, 24),
        kind: fact.kind, phase: fact.phase, subject: fact.subject, confidence: fact.confidence,
        blockId: block ? context.blockIds.get(block.id) : undefined,
        evidenceToken: context.createEvidenceToken(logic.functionNode.filePath, fact.range)
      };
    })
  };
}

/** Evidence can start inside a statement but extend into a nested callback. */
function containsStart(container: SourceRange, candidate: SourceRange): boolean {
  return (candidate.startLine > container.startLine || candidate.startLine === container.startLine && candidate.startCharacter >= container.startCharacter)
    && (candidate.startLine < container.endLine || candidate.startLine === container.endLine && candidate.startCharacter <= container.endCharacter);
}
