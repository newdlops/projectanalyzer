/** Shared snapshot-range projection for legacy short routes and complete scenario planning. */
import type { FunctionLogicAnalysis, FunctionLogicBlock } from "../../analyzer/functionLogic";
import type { FunctionNarrativeContext, FunctionNarrativeFlowStep } from "../../shared/functionNarratives";

/** Builds a pure lookup over already supplied source; hidden columns and unrelated functions cannot supply citations. */
export function createFunctionNarrativeSourceStep(analysis: FunctionLogicAnalysis, source: string, context: FunctionNarrativeContext):
  (block: FunctionLogicBlock) => FunctionNarrativeFlowStep | undefined {
  const lines = source.split(/\r?\n/u);
  const excerptLines = new Map(context.snippets.map((snippet) => [snippet.id, snippet.text.split("\n")]));
  return (block) => {
    if (block.filePath !== analysis.functionNode.filePath) return undefined;
    const range = block.range;
    const startLine = range.startLine + 1;
    const endLine = range.endLine + (range.endCharacter > 0 || range.startLine === range.endLine ? 1 : 0);
    const snippet = context.snippets.find((candidate) => candidate.role === "function"
      && startLine >= candidate.startLine && endLine <= candidate.endLine);
    if (!snippet || range.startLine < 0 || range.endLine >= lines.length) return undefined;
    for (let line = range.startLine; line < endLine; line += 1) {
      const supplied = excerptLines.get(snippet.id)?.[line - snippet.startLine + 1];
      const offset = line === analysis.functionNode.range.startLine ? analysis.functionNode.range.startCharacter : 0;
      const lastCharacter = line === range.endLine ? range.endCharacter : lines[line].length;
      if (supplied === undefined || lastCharacter - offset > supplied.length) return undefined;
    }
    const raw = lines.slice(range.startLine, range.endLine + 1).map((line, index) => line.slice(index === 0 ? range.startCharacter : 0,
      range.startLine + index === range.endLine ? range.endCharacter : undefined)).join("\n").trim();
    const predicate = block.condition?.expression.trim();
    // Elvis/safe-call lowering introduces a predicate such as x != null that
    // was never written verbatim. Keep the original source and expose that
    // analyzer expression explicitly; it must not turn a present node into a gap.
    const loweredPredicate = predicate && !snippet.text.includes(predicate) ? predicate : undefined;
    const code = loweredPredicate ? raw : predicate || raw;
    if (code && !snippet.text.includes(code) || code.length > 480) return undefined;
    return { kind: block.kind, code: code || block.kind, confidence: block.confidence, ...(loweredPredicate ? { loweredPredicate } : {}),
      source: { snippetId: snippet.id, startLine, endLine } };
  };
}
