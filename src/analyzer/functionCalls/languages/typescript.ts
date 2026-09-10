/** TypeScript/JavaScript expression guards, including nested arguments and optional dispatch. */
import * as ts from "typescript";
import type { FunctionLogicCallsite } from "../../functionLogic";

/** Parses once, then walks only syntax children containing each call's source position. */
export function createTypeScriptCallGuardReader(source: string, filePath: string, maxDepth: number) {
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true,
    /\.[jt]sx$/iu.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return (site: FunctionLogicCallsite) => {
    const lineStarts = file.getLineStarts();
    const offset = (lineStarts[site.range.startLine] ?? source.length) + site.range.startCharacter;
    const guards: Array<{ expression: string; outcome: string; from: number; to: number }> = [];
    const guard = (expression: ts.Node, outcome: string) => ({ expression: expression.getText(file), outcome, from: expression.getStart(file), to: expression.end });
    const end = (lineStarts[site.range.endLine] ?? source.length) + site.range.endCharacter;
    const path: number[] = []; let order: number[] | undefined;
    const visited = new Set<ts.Node>();
    let node: ts.Node | undefined = file;
    while (node && visited.size < maxDepth && !visited.has(node)) {
      visited.add(node);
      if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.getStart(file) === offset && node.end === end) order = [...path, Number.MAX_SAFE_INTEGER];
      // Conditions that created a closure are not invocation prerequisites of
      // that closure. Only expression owners inside its own function apply.
      if (ts.isFunctionLike(node)) guards.length = 0;
      if (ts.isConditionalExpression(node)) {
        const arm = contains(node.whenTrue, offset) ? "true" : contains(node.whenFalse, offset) ? "false" : undefined;
        if (arm) guards.push(guard(node.condition, arm));
      }
      if (ts.isBinaryExpression(node) && contains(node.right, offset)) {
        const kind = node.operatorToken.kind;
        const outcome = kind === ts.SyntaxKind.AmpersandAmpersandToken ? "true" : kind === ts.SyntaxKind.BarBarToken ? "false" : kind === ts.SyntaxKind.QuestionQuestionToken ? "nullish" : undefined;
        if (outcome) guards.push(guard(node.left, outcome));
      }
      if ((ts.isCallExpression(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && node.questionDotToken) {
        guards.push(guard(node.expression, "notNullish"));
      }
      // Arguments of obj?.method(inner()) are skipped with the optional receiver,
      // although that receiver is a sibling of inner() in the syntax tree.
      if (ts.isCallExpression(node) && ts.isOptionalChain(node)) {
        let receiver: ts.Expression = node.expression;
        const receivers = new Set<ts.Node>();
        while (receivers.size < 32 && !receivers.has(receiver)
          && (ts.isPropertyAccessExpression(receiver) || ts.isElementAccessExpression(receiver))) {
          receivers.add(receiver);
          if (receiver.questionDotToken) guards.push(guard(receiver.expression, "notNullish"));
          receiver = receiver.expression;
        }
      }
      let child: ts.Node | undefined;
      let childIndex = 0, selectedIndex = 0;
      ts.forEachChild(node, candidate => { if (contains(candidate, offset)) { child = candidate; selectedIndex = childIndex; } childIndex += 1; });
      path.push(selectedIndex);
      node = child;
    }
    return { guards, order, deferred: false, limited: Boolean(node && visited.size >= maxDepth) };
  };
}

/** Source positions include the callee itself and exclude the next sibling's boundary. */
function contains(node: ts.Node, offset: number): boolean {
  return node.pos <= offset && offset < node.end;
}
