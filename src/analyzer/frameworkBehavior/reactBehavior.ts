/** React import-owned hooks, render output and callback timing from TypeScript syntax. */
import * as ts from "typescript";
import type { SourceRange } from "../../shared/types";
import type { FrameworkBehaviorKind, FrameworkBehaviorPhase } from "../../shared/frameworkBehavior";
import { containsPosition, createFrameworkFactCollector, hasFrameworkHint } from "./support";
import type { FrameworkBehaviorInput, FunctionFrameworkBehavior } from "./types";

type Callable = ts.FunctionLikeDeclaration & { body: ts.ConciseBody };
const MAX_NODES = 30_000;

/** Follows source ownership and import aliases, never a useEffect-looking name alone. */
export function analyzeReactBehavior(input: FrameworkBehaviorInput): FunctionFrameworkBehavior | undefined {
  const source = ts.createSourceFile(input.functionNode.filePath, input.sourceText!, ts.ScriptTarget.Latest, true,
    /x$/u.test(input.functionNode.filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if ((source as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics?.length) return undefined;
  const collector = createFrameworkFactCollector(input, "react");
  const depth = Math.max(1, Math.min(100, input.maxDepth ?? 40));
  const all = collectNodes(source, depth, () => { collector.result.limited = true; });
  const position = input.functionNode.selectionRange ?? input.functionNode.range;
  const selected = all.filter(isCallable).filter((node) => containsPosition(range(callableOwner(node)), position.startLine, position.startCharacter))
    .sort((left, right) => (left.end - left.pos) - (right.end - right.pos))[0];
  if (!selected) return undefined;
  const imports = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== "react" || statement.importClause?.isTypeOnly) continue;
    const clause = statement.importClause;
    if (clause?.name) imports.set(clause.name.text, "*");
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) imports.set(clause.namedBindings.name.text, "*");
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const item of clause.namedBindings.elements) if (!item.isTypeOnly) imports.set(item.name.text, item.propertyName?.text ?? item.name.text);
    }
  }
  const local = collectNodes(selected.body, depth, () => { collector.result.limited = true; }, true);
  const shadows = new Set<string>();
  const scopes = [...local];
  let ancestor: ts.Node | undefined = selected;
  const seenScopes = new Set<ts.Node>();
  while (ancestor && !seenScopes.has(ancestor)) {
    seenScopes.add(ancestor);
    if (isCallable(ancestor)) {
      for (const parameter of ancestor.parameters) collectBindingNames(parameter.name, shadows);
      if (ancestor !== selected) scopes.push(...collectNodes(ancestor.body, depth, () => { collector.result.limited = true; }, true));
    }
    ancestor = ancestor.parent;
  }
  for (const node of scopes) {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) collectBindingNames(node.name, shadows);
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) shadows.add(node.name.text);
  }
  const api = (expression: ts.Expression): string | undefined => {
    if (ts.isIdentifier(expression) && !shadows.has(expression.text)) return imports.get(expression.text);
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)
      && !shadows.has(expression.expression.text) && imports.get(expression.expression.text) === "*") return expression.name.text;
    return undefined;
  };
  const knownReact = imports.size > 0 || hasFrameworkHint(input, "react");
  const jsx = local.find((node) => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node));
  if (jsx && knownReact) {
    collector.result.role = "component";
    add("react-render", "render", input.functionNode.name, selected, "inferred");
  }
  for (const node of local) {
    if (ts.isCallExpression(node)) {
      const hook = api(node.expression);
      if (hook === "useState" || hook === "useReducer") add("react-state", "render", node.parent && ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(source) : hook, node);
      else if (hook === "useEffect" || hook === "useLayoutEffect") {
        const dependencies = node.arguments[1];
        const kind = hook === "useLayoutEffect" ? "react-layout-effect" : !dependencies ? "react-effect-every"
          : ts.isArrayLiteralExpression(dependencies) ? dependencies.elements.length ? "react-effect-deps" : "react-effect-mount" : "react-effect-dynamic";
        add(kind, "commit", hook + (dependencies ? " · " + dependencies.getText(source) : ""), node);
        const setup = node.arguments[0];
        if (setup && (ts.isArrowFunction(setup) || ts.isFunctionExpression(setup))
          && !setup.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
          const cleanup = ts.isBlock(setup.body) ? collectNodes(setup.body, depth, () => { collector.result.limited = true; }, true)
            .find((candidate) => ts.isReturnStatement(candidate) && candidate.expression &&
              (ts.isArrowFunction(candidate.expression) || ts.isFunctionExpression(candidate.expression)))
            : ts.isArrowFunction(setup.body) || ts.isFunctionExpression(setup.body) ? setup.body : undefined;
          if (cleanup) add("react-cleanup", "commit", cleanup.getText(source), cleanup);
        }
      } else {
        const kinds: Record<string, FrameworkBehaviorKind> = { useMemo: "react-memo", useCallback: "react-callback", useRef: "react-ref", useContext: "react-context" };
        if (hook && kinds[hook]) add(kinds[hook], "render", node.getText(source), node);
      }
    }
    if (knownReact && ts.isJsxAttribute(node) && /^on[A-Z]/u.test(node.name.getText(source))
      && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      let value = node.initializer.expression;
      while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isNonNullExpression(value)) value = value.expression;
      // A direct call is evaluated while JSX is constructed; its return value,
      // rather than that invocation, becomes the callback prop.
      const eager = ts.isCallExpression(value);
      add(eager ? "react-event-eager" : "react-event", eager ? "render" : "event", node.getText(source), node, "inferred");
    }
  }
  if (!collector.result.facts.length) return undefined;
  if (collector.result.role === "usage" && collector.result.facts.some((fact) => fact.kind.startsWith("react-") && !fact.kind.startsWith("react-event"))) collector.result.role = "hooks";
  return collector.result;

  /** Converts exact UTF-16 compiler positions into editor evidence. */
  function range(node: ts.Node): SourceRange {
    const start = source.getLineAndCharacterOfPosition(node.getStart(source));
    const end = source.getLineAndCharacterOfPosition(node.end);
    return { startLine: start.line, startCharacter: start.character, endLine: end.line, endCharacter: end.character };
  }
  function add(kind: FrameworkBehaviorKind, phase: FrameworkBehaviorPhase, subject: string, node: ts.Node, confidence: "exact" | "inferred" = "exact") {
    collector.add({ kind, phase, subject, confidence, range: range(node) });
  }
}

/** Arrow symbols are selected at their variable/property name, before the arrow span. */
function callableOwner(node: Callable): ts.Node {
  let owner: ts.Node = node;
  const seen = new Set<ts.Node>();
  while (owner.parent && !seen.has(owner)) {
    seen.add(owner);
    if (ts.isParenthesizedExpression(owner.parent) || ts.isAsExpression(owner.parent)) owner = owner.parent;
    else break;
  }
  return owner.parent && (ts.isVariableDeclaration(owner.parent) || ts.isPropertyAssignment(owner.parent)) ? owner.parent : owner;
}

/** Iterative syntax traversal; nested function bodies are separate execution contexts. */
function collectNodes(root: ts.Node, maxDepth: number, onLimit: () => void, skipFunctions = false): ts.Node[] {
  const pending = [{ node: root, depth: 0 }];
  const seen = new Set<ts.Node>();
  const nodes: ts.Node[] = [];
  while (pending.length && nodes.length < MAX_NODES) {
    const current = pending.pop()!;
    if (seen.has(current.node)) continue;
    seen.add(current.node); nodes.push(current.node);
    if (skipFunctions && current.node !== root && (ts.isFunctionLike(current.node) || ts.isClassLike(current.node))) continue;
    if (current.depth >= maxDepth) { onLimit(); continue; }
    const children: ts.Node[] = [];
    ts.forEachChild(current.node, (child) => { children.push(child); });
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push({ node: children[index], depth: current.depth + 1 });
  }
  if (pending.length) onLimit();
  return nodes;
}

/** Narrows only concrete callables whose source body can be inspected. */
function isCallable(node: ts.Node): node is Callable {
  return (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && Boolean(node.body);
}

/** Destructured parameters and locals can shadow imported APIs as well. */
function collectBindingNames(root: ts.BindingName, names: Set<string>): void {
  const pending: ts.BindingName[] = [root];
  const seen = new Set<ts.Node>();
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (ts.isIdentifier(current)) names.add(current.text);
    else for (const item of current.elements) if (ts.isBindingElement(item)) pending.push(item.name);
  }
}
