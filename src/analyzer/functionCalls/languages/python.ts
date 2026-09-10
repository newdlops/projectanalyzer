/** Python expression prerequisites absent from statement CFG: short circuits and conditional expressions. */
import { parser } from "@lezer/python";
import type { SyntaxNode } from "@lezer/common";
import type { FunctionLogicCallsite } from "../../functionLogic";

/** Parses once and resolves each call's lexical expression owners with bounded parent traversal. */
export function createPythonCallGuardReader(source: string, maxDepth: number) {
  const tree = parser.parse(source);
  const lines = [0];
  for (let offset = 0; offset < source.length; offset += 1) if (source[offset] === "\n") lines.push(offset + 1);
  return (site: FunctionLogicCallsite) => {
    const offset = (lines[site.range.startLine] ?? source.length) + site.range.startCharacter;
    const end = (lines[site.range.endLine] ?? source.length) + site.range.endCharacter;
    const guards: Array<{ expression: string; outcome: string; from: number; to: number }> = [];
    const guard = (expression: SyntaxNode, outcome: string) => ({ expression: source.slice(expression.from, expression.to), outcome, from: expression.from, to: expression.to });
    const visited = new Set<string>();
    let node: SyntaxNode | null = tree.resolveInner(offset, 1);
    let deferred = false;
    let call: SyntaxNode | undefined;
    while (node && visited.size < maxDepth) {
      const key = `${node.name}:${node.from}:${node.to}`;
      if (visited.has(key) || node.name === "FunctionDefinition") break;
      visited.add(key);
      if (node.name === "CallExpression" && node.from === offset && node.to === end) call = node;
      if (node.name === "LambdaExpression") { deferred = true; break; }
      const children: SyntaxNode[] = [];
      for (let child = node.firstChild; child && children.length < 64; child = child.nextSibling) children.push(child);
      if (node.name === "BinaryExpression" && ["and", "or"].includes(children[1]?.name)
        && offset >= children[1].to && children[0]) {
        guards.unshift(guard(children[0], children[1].name === "and" ? "true" : "false"));
      }
      if (node.name === "ConditionalExpression" && children[1]?.name === "if" && children[3]?.name === "else") {
        const arm = offset < children[1].from ? "true" : offset >= children[3].to ? "false" : undefined;
        if (arm) guards.unshift(guard(children[2], arm));
      }
      node = node.parent;
    }
    return { guards, order: call ? pythonEvaluationOrder(call, maxDepth) : undefined, deferred, limited: Boolean(node && visited.size >= maxDepth) };
  };
}

/** Postorder path keys put argument calls before their consumer and Python ternary tests before either arm. */
function pythonEvaluationOrder(call: SyntaxNode, maxDepth: number): number[] | undefined {
  const order = [Number.MAX_SAFE_INTEGER]; const visited = new Set<string>();
  let node = call;
  while (node.parent && node.parent.name !== "FunctionDefinition") {
    const parent = node.parent; const key = `${parent.name}:${parent.from}:${parent.to}`;
    if (visited.has(key) || visited.size >= maxDepth) return undefined;
    visited.add(key);
    let children: SyntaxNode[] = [];
    for (let child = parent.firstChild; child; child = child.nextSibling) children.push(child);
    if (parent.name === "ConditionalExpression" && children[1]?.name === "if" && children[3]?.name === "else") children = [children[2], children[0], children[4]];
    order.unshift(children.findIndex(child => child.from === node.from && child.to === node.to && child.name === node.name));
    node = parent;
  }
  return order;
}
