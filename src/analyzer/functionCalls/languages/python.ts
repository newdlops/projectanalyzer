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
    const guards: Array<{ expression: string; outcome: string }> = [];
    const visited = new Set<string>();
    let node: SyntaxNode | null = tree.resolveInner(offset, 1);
    let deferred = false;
    while (node && visited.size < maxDepth) {
      const key = `${node.name}:${node.from}:${node.to}`;
      if (visited.has(key) || node.name === "FunctionDefinition") break;
      visited.add(key);
      if (node.name === "LambdaExpression") { deferred = true; break; }
      const children: SyntaxNode[] = [];
      for (let child = node.firstChild; child && children.length < 64; child = child.nextSibling) children.push(child);
      if (node.name === "BinaryExpression" && ["and", "or"].includes(children[1]?.name)
        && offset >= children[1].to && children[0]) {
        guards.unshift({ expression: source.slice(children[0].from, children[0].to), outcome: children[1].name === "and" ? "true" : "false" });
      }
      if (node.name === "ConditionalExpression" && children[1]?.name === "if" && children[3]?.name === "else") {
        const arm = offset < children[1].from ? "true" : offset >= children[3].to ? "false" : undefined;
        if (arm) guards.unshift({ expression: source.slice(children[2].from, children[2].to), outcome: arm });
      }
      node = node.parent;
    }
    return { guards, deferred, limited: Boolean(node && visited.size >= maxDepth) };
  };
}
