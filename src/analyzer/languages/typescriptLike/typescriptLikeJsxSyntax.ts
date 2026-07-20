/**
 * TypeScript-like JSX syntax helpers shared by symbol extraction and Function
 * Logic. They recognize source-proven component tags and narrow React wrapper
 * calls without depending on graph or Webview contracts.
 */

import * as ts from "typescript";

/** Callable expression accepted as the implementation of a wrapped component. */
export type TypeScriptLikeComponentFunction = ts.ArrowFunction | ts.FunctionExpression;

/** Concise `.map` callback whose expression contributes JSX list output. */
export type TypeScriptLikeJsxMapCallback = ts.ArrowFunction & { body: ts.Expression };

/** One custom JSX tag that can conservatively participate in callee drilling. */
export type TypeScriptLikeJsxComponentReference = {
  name: string;
  text: string;
  node: ts.JsxTagNameExpression;
};

const REACT_COMPONENT_WRAPPER_NAMES = new Set(["memo", "forwardRef"]);

/**
 * Reads an uppercase or member-style JSX component tag. Lowercase intrinsic
 * elements and namespaced markup remain presentation syntax, not callsites.
 */
export function readTypeScriptLikeJsxComponentReference(
  sourceFile: ts.SourceFile,
  element: ts.JsxOpeningLikeElement
): TypeScriptLikeJsxComponentReference | undefined {
  const node = element.tagName;
  const text = node.getText(sourceFile).replace(/\s+/gu, "");
  if (!text || text.includes(":")) {
    return undefined;
  }
  const memberStyle = text.includes(".");
  if (!memberStyle && !/^\p{Lu}/u.test(text)) {
    return undefined;
  }
  const name = text.match(/([\p{L}_$][\p{L}\p{N}_$]*)$/u)?.[1];
  return name ? { name, text, node } : undefined;
}

/** Finds an arrow or function expression inside memo/forwardRef wrapper calls. */
export function findTypeScriptLikeWrappedComponentFunction(
  initializer: ts.Expression | undefined
): TypeScriptLikeComponentFunction | undefined {
  let current = initializer ? unwrapTransparentExpression(initializer) : undefined;
  const visited = new Set<ts.Node>();

  while (current && !visited.has(current)) {
    visited.add(current);
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      return current;
    }
    if (!ts.isCallExpression(current) || !isReactComponentWrapperCall(current)) {
      return undefined;
    }
    const implementation = current.arguments[0];
    current = implementation ? unwrapTransparentExpression(implementation) : undefined;
  }
  return undefined;
}

/**
 * Finds the narrow JSX-producing callback supported as an inferred list-render
 * boundary. Block callbacks stay opaque because their internal control flow
 * belongs to the nested function rather than the outer component.
 */
export function findTypeScriptLikeJsxMapCallback(
  call: ts.CallExpression
): TypeScriptLikeJsxMapCallback | undefined {
  const callee = unwrapTransparentExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "map") {
    return undefined;
  }
  const callbackExpression = call.arguments[0]
    ? unwrapTransparentExpression(call.arguments[0])
    : undefined;
  if (!callbackExpression
    || !ts.isArrowFunction(callbackExpression)
    || ts.isBlock(callbackExpression.body)
    || !containsDirectJsx(callbackExpression.body)) {
    return undefined;
  }
  return callbackExpression as TypeScriptLikeJsxMapCallback;
}

/**
 * Finds the variable binding that names a function nested only through known
 * React component wrappers. This retains an exact source selection anchor.
 */
export function findTypeScriptLikeWrappedComponentBinding(
  node: TypeScriptLikeComponentFunction
): ts.VariableDeclaration | undefined {
  let current: ts.Expression = node;
  let crossedWrapper = false;
  const visited = new Set<ts.Node>();

  while (!visited.has(current)) {
    visited.add(current);
    current = climbTransparentParents(current);
    const parent = current.parent;
    if (!parent || !ts.isCallExpression(parent) || !isReactComponentWrapperCall(parent)) {
      break;
    }
    if (parent.arguments[0] !== current) {
      break;
    }
    crossedWrapper = true;
    current = parent;
  }

  current = climbTransparentParents(current);
  const parent = current.parent;
  return crossedWrapper
    && parent
    && ts.isVariableDeclaration(parent)
    && parent.initializer === current
    && ts.isIdentifier(parent.name)
    ? parent
    : undefined;
}

/** Recognizes direct or React-qualified memo and forwardRef calls. */
function isReactComponentWrapperCall(call: ts.CallExpression): boolean {
  const expression = unwrapTransparentExpression(call.expression);
  if (ts.isIdentifier(expression)) {
    return REACT_COMPONENT_WRAPPER_NAMES.has(expression.text);
  }
  return ts.isPropertyAccessExpression(expression)
    && REACT_COMPONENT_WRAPPER_NAMES.has(expression.name.text)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === "React";
}

/** Removes syntax-only expression wrappers without evaluating the source. */
function unwrapTransparentExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Climbs the inverse transparent-wrapper chain while preserving node identity. */
function climbTransparentParents(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (current.parent && isTransparentParentOf(current.parent, current)) {
    current = current.parent;
  }
  return current;
}

/** Tests whether a parent only preserves the wrapped expression's semantics. */
function isTransparentParentOf(parent: ts.Node, child: ts.Expression): parent is ts.Expression {
  return (ts.isParenthesizedExpression(parent)
      || ts.isAsExpression(parent)
      || ts.isTypeAssertionExpression(parent)
      || ts.isNonNullExpression(parent)
      || ts.isSatisfiesExpression(parent))
    && parent.expression === child;
}

/** Finds JSX output iteratively while preserving nested callable boundaries. */
function containsDirectJsx(root: ts.Node): boolean {
  const pending: ts.Node[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      return true;
    }
    if (node !== root && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))) {
      continue;
    }
    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
      return undefined;
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return false;
}
