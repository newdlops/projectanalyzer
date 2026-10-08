/** Kotlin parser-owned call postorder and expression guards; no expression evaluation or runtime dispatch. */
import { parseKotlinSource, getKotlinChildNamed, type KotlinSyntaxNode } from "../../languages/kotlin";
import type { FunctionLogicCallsite } from "../../functionLogic";

/** Reuses immutable Kotlin syntax and follows only the containing path with depth/cycle guards. */
export function createKotlinCallGuardReader(text: string, filePath: string, maxDepth: number,
  controlGroups: ReadonlySet<string> = new Set()) {
  const source = parseKotlinSource(text, filePath);
  return (site: FunctionLogicCallsite) => {
    const from = (source.lineStarts[site.range.startLine] ?? text.length) + site.range.startCharacter;
    const to = (source.lineStarts[site.range.endLine] ?? text.length) + site.range.endCharacter;
    const guards: Array<{ expression: string; outcome: string; from: number; to: number; representedByControl?: boolean }> = [];
    const visited = new Set<KotlinSyntaxNode>(), path: number[] = [];
    let node: KotlinSyntaxNode | undefined = source.root, order: number[] | undefined, argumentsText: string[] | undefined, deferred = false;
    const contains = (candidate: KotlinSyntaxNode) => candidate.from <= from && from < candidate.to;
    const guard = (start: number, end: number, outcome: string) => {
      if (!guards.some(existing => existing.from === start && existing.to === end && existing.outcome === outcome))
        guards.push({ expression: text.slice(start, end), outcome, from: start, to: end,
          // The Kotlin CFG's display range may include an entire if arm.
          // Its parser-owned group identity still pins the actual predicate span.
          ...(controlGroups.has(`kotlin-condition:${start}:${end}`) ? { representedByControl: true } : {}) });
    };
    while (node && visited.size < maxDepth && !visited.has(node)) {
      visited.add(node);
      if (node.name === "functionDeclaration") guards.length = 0;
      if (["lambdaLiteral", "anonymousFunction"].includes(node.name)) { deferred = true; break; }
      if (["postfixUnaryExpression", "genericCallLikeComparison"].includes(node.name) && node.from === from) {
        const suffix = node.children.findIndex(child => child.to === to && (child.name === "callSuffix" || getKotlinChildNamed(child, "callSuffix")));
        if (suffix >= 0) {
          order = [...path, suffix, Number.MAX_SAFE_INTEGER];
          const holder = node.children[suffix], call = holder.name === "callSuffix" ? holder : getKotlinChildNamed(holder, "callSuffix")!;
          const argumentsNode = getKotlinChildNamed(call, "valueArguments");
          const args = (argumentsNode?.children.filter(child => child.name === "valueArgument") ?? []).map(argument => text.slice(argument.from, argument.to));
          const lambda = getKotlinChildNamed(call, "annotatedLambda");if(lambda)args.push(text.slice(lambda.from,lambda.to));
          if (args.length <= 8 && args.every(argument => argument.length <= 160)) argumentsText = args;
        }
      }
      if (node.name === "conjunction" || node.name === "disjunction" || node.name === "elvisExpression") {
        const memberName = node.name === "conjunction" ? "equality" : node.name === "disjunction" ? "conjunction" : "infixFunctionCall";
        const members = node.children.filter(child => child.name === memberName), selected = members.findIndex(contains);
        for (let index = 0; index < selected; index++) guard(members[index].from, members[index].to,
          node.name === "conjunction" ? "true" : node.name === "disjunction" ? "false" : "nullish");
      }
      if (node.name === "ifExpression") {
        const predicate = getKotlinChildNamed(node, "expression"), bodies = node.children.filter(child => child.name === "controlStructureBody");
        const index = bodies.findIndex(contains);
        if (predicate && index >= 0) guard(predicate.from, predicate.to, index === 0 ? "true" : "false");
      }
      if (node.name === "postfixUnaryExpression") for (const child of node.children) {
        const navigation = getKotlinChildNamed(child, "navigationSuffix"), operator = navigation && getKotlinChildNamed(navigation, "memberAccessOperator");
        if (operator && text.slice(operator.from, operator.to) === "?." && to > child.to) guard(node.from, child.from, "notNullish");
      }
      const index = node.children.findIndex(contains);
      if (index < 0) break;
      path.push(index); node = node.children[index];
    }
    return { guards, order, argumentsText, deferred, limited: source.diagnostics.length > 0 || visited.size >= maxDepth || !order };
  };
}
