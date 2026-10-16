/** Compiler-owned full-call/callee/prefix ranges with iterative bounded traversal. */
import * as ts from "typescript";
import type { SourceRange, SymbolNode } from "../../shared/types";
import { SourceCaptureError } from "../../shared/narrativeSources";
import type { SourceCallEvidence, SourceCallEvidenceResult, SourceSyntaxLimits } from "./types";

/** Convert compiler offsets to the existing zero-based UTF-16 range contract. */
function range(source: ts.SourceFile, from: number, to: number): SourceRange {
  const start = source.getLineAndCharacterOfPosition(from), end = source.getLineAndCharacterOfPosition(to);
  return { startLine: start.line, startCharacter: start.character, endLine: end.line, endCharacter: end.character };
}
const key = (value: SourceRange) => [value.startLine, value.startCharacter, value.endLine, value.endCharacter].join(":");

/**
 * Reads all direct calls, including dynamic callees, from an exact selected
 * callable. Nested callable bodies remain separate graph owners. AST limits
 * fail the acquisition; no prefix of a traversal is presented as complete.
 */
export function readTypeScriptSourceCalls(node: SymbolNode, text: string, selected: SourceRange,
  limits: SourceSyntaxLimits): SourceCallEvidenceResult | undefined {
  if (!Number.isSafeInteger(limits.maxNodes) || limits.maxNodes < 1 || !Number.isSafeInteger(limits.maxDepth) || limits.maxDepth < 0) throw new RangeError("Explicit syntax traversal limits required");
  const script = /\.tsx$/iu.test(node.filePath) ? ts.ScriptKind.TSX : /\.jsx$/iu.test(node.filePath) ? ts.ScriptKind.JSX
    : node.language === "javascript" ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(node.filePath, text, ts.ScriptTarget.Latest, true, script);
  const pending = [{ node: source as ts.Node, depth: 0 }], visited = new Set<ts.Node>();
  let root: ts.FunctionLikeDeclaration | undefined, processed = 0;
  const next = () => {
    const task = pending.pop()!;
    if (++processed > limits.maxNodes || task.depth > limits.maxDepth) throw new SourceCaptureError("context-too-large", "Whole syntax exceeds source traversal budget");
    return task;
  };
  const children = (value: ts.Node, depth: number) => { ts.forEachChild(value, (child) => { pending.push({ node: child, depth: depth + 1 }); }); };
  while (pending.length) {
    const task = next(); if (visited.has(task.node)) continue; visited.add(task.node);
    if (ts.isFunctionLike(task.node) && "body" in task.node && task.node.body
      && key(range(source, task.node.getStart(source), task.node.getEnd())) === key(selected)) {
      root = task.node as ts.FunctionLikeDeclaration; break;
    }
    children(task.node, task.depth);
  }
  if (!root?.body) return undefined;
  pending.length = 0; visited.clear(); pending.push({ node: root.body, depth: 0 });
  const calls: SourceCallEvidence[] = [];
  while (pending.length) {
    const task = next(); if (visited.has(task.node)) continue; visited.add(task.node);
    if (task.node !== root.body && ts.isFunctionLike(task.node)) continue;
    if (ts.isCallExpression(task.node) || ts.isNewExpression(task.node)) {
      const call: ts.CallExpression | ts.NewExpression = task.node;
      const whole = range(source, call.getStart(source), call.getEnd());
      const expression = call.expression, callee = range(source, expression.getStart(source), expression.getEnd());
      const evidenceRanges = [whole];
      // A chained call's callee may itself be another whole call. Keep that
      // inner invocation owned by its own AST node and its own graph evidence.
      if (!ts.isCallExpression(expression) && !ts.isNewExpression(expression)) evidenceRanges.push(callee);
      const opening = call.arguments ? call.arguments.pos - 1 : -1;
      if (opening >= expression.getEnd() && text[opening] === "(") {
        evidenceRanges.push(range(source, expression.getStart(source), opening + 1));
      }
      calls.push({ range: whole, evidenceRanges });
    }
    children(task.node, task.depth);
  }
  // The installed compiler owns parser diagnostics. Absence of this capability
  // conservatively limits the result when a different compiler is supplied.
  const diagnostics = "parseDiagnostics" in source ? source.parseDiagnostics : undefined;
  return { calls, limited: !Array.isArray(diagnostics) || diagnostics.length > 0 };
}
