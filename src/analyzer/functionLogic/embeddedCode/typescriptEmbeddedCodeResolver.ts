/**
 * Bounded static-text recovery for embedded programs. It resolves literal-only
 * expressions and unambiguous `const` aliases without evaluating source text
 * or following runtime values, calls, properties, or mutable bindings.
 */

import * as ts from "typescript";
import { getImmediateChildren, toSourceRange } from "../typescriptFunctionLogicSyntax";
import type { FunctionLikeWithBody } from "../typescriptFunctionLogicInternal";
import type { SourceRange } from "../../../shared/types";
const MAX_EMBEDDED_CODE_CHARACTERS = 24_000;
const MAX_EMBEDDED_CODE_PIECES = 64;
const MAX_EMBEDDED_CODE_ALIAS_DEPTH = 8;
const CODE_TAG_NAMES = new Set(["code", "js", "javascript", "ts", "typescript"]);

/** Decoded source plus its literal/constant evidence. */
export type TypeScriptStaticCodeText = {
  text: string;
  evidenceNode: ts.Expression;
  range: SourceRange;
  exactCodeTag: boolean;
  fromConstant?: { name: string; declarationRange: SourceRange };
};

type ConstantDeclaration = {
  name: string;
  initializer: ts.Expression;
  declaration: ts.VariableDeclaration;
};

/** Function-local index used for conservative eval shadowing and const lookup. */
export type TypeScriptEmbeddedCodeResolver = {
  isBareEvalShadowed(): boolean;
  isConsumedConstant(name: string): boolean;
  resolve(expression: ts.Expression, invocationStart: number): TypeScriptStaticCodeText | undefined;
};

/** Creates one bounded resolver shared by all embedded consumers in a callable. */
export function createTypeScriptEmbeddedCodeResolver(input: {
  sourceFile: ts.SourceFile;
  functionNode: FunctionLikeWithBody;
}): TypeScriptEmbeddedCodeResolver {
  const constants = new Map<string, ConstantDeclaration>();
  const ambiguousConstantNames = new Set<string>();
  let bareEvalShadowed = false;
  const pending: ts.Node[] = [input.functionNode];

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (node !== input.functionNode && isNestedCallable(node)) continue;
    if (ts.isParameter(node)) {
      if (bindingNameContains(node.name, "eval")) bareEvalShadowed = true;
    }
    if (ts.isVariableDeclaration(node)) {
      const declarationList = findVariableDeclarationList(node);
      if (bindingNameContains(node.name, "eval")) bareEvalShadowed = true;
      if (declarationList && (declarationList.flags & ts.NodeFlags.Const) !== 0
        && ts.isIdentifier(node.name) && node.initializer) {
        const prior = constants.get(node.name.text);
        if (prior) {
          constants.delete(node.name.text);
          ambiguousConstantNames.add(node.name.text);
        } else if (!ambiguousConstantNames.has(node.name.text)) {
          constants.set(node.name.text, {
            name: node.name.text,
            initializer: node.initializer,
            declaration: node
          });
        }
      }
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
      && node.name?.text === "eval") {
      bareEvalShadowed = true;
    }
    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  const consumedConstantNames = collectDirectEvalConstantNames(
    input.functionNode,
    constants,
    bareEvalShadowed
  );

  return {
    isBareEvalShadowed: () => bareEvalShadowed,
    isConsumedConstant: (name) => consumedConstantNames.has(name),
    resolve: (expression, invocationStart) => resolveStaticCodeText({
      sourceFile: input.sourceFile,
      expression,
      invocationStart,
      constants
    })
  };
}

/** Identifies const programs that later have a proven direct-eval execution consumer. */
function collectDirectEvalConstantNames(
  rootFunction: FunctionLikeWithBody,
  constants: ReadonlyMap<string, ConstantDeclaration>,
  bareEvalShadowed: boolean
): Set<string> {
  const result = new Set<string>();
  if (bareEvalShadowed) return result;
  const pending: ts.Node[] = [rootFunction.body];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (node !== rootFunction.body && isNestedCallable(node)) continue;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === "eval" && ts.isIdentifier(node.arguments[0])
      && constants.has(node.arguments[0].text)) {
      result.add(node.arguments[0].text);
    }
    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
  return result;
}

/** Resolves a complete text value with an explicit non-recursive expression stack. */
function resolveStaticCodeText(input: {
  sourceFile: ts.SourceFile;
  expression: ts.Expression;
  invocationStart: number;
  constants: ReadonlyMap<string, ConstantDeclaration>;
}): TypeScriptStaticCodeText | undefined {
  const pieces: string[] = [];
  const pending: Array<
    | { kind: "expression"; expression: ts.Expression; depth: number }
    | { kind: "leave"; name: string }
  > = [{ kind: "expression", expression: input.expression, depth: 0 }];
  const activeConstants = new Set<string>();
  let evidenceNode = unwrapExpression(input.expression);
  let origin: TypeScriptStaticCodeText["fromConstant"];

  while (pending.length > 0) {
    const task = pending.pop();
    if (!task) continue;
    if (task.kind === "leave") {
      activeConstants.delete(task.name);
      continue;
    }
    if (task.depth > MAX_EMBEDDED_CODE_ALIAS_DEPTH || pieces.length >= MAX_EMBEDDED_CODE_PIECES) {
      return undefined;
    }
    const current = unwrapExpression(task.expression);
    if (ts.isTaggedTemplateExpression(current)) {
      const tag = normalizeText(current.tag.getText(input.sourceFile));
      if (!isCodeTag(tag) || !ts.isNoSubstitutionTemplateLiteral(current.template)) return undefined;
      const rawText = (current.template as ts.NoSubstitutionTemplateLiteral & { rawText?: string }).rawText;
      const text = tag === "String.raw" ? rawText ?? current.template.text : current.template.text;
      pieces.push(text);
      evidenceNode = current;
      continue;
    }
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      pending.push(
        { kind: "expression", expression: current.right, depth: task.depth },
        { kind: "expression", expression: current.left, depth: task.depth }
      );
      continue;
    }
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      pieces.push(current.text);
      continue;
    }
    if (ts.isIdentifier(current)) {
      const declaration = input.constants.get(current.text);
      if (!declaration || declaration.declaration.getStart(input.sourceFile) >= input.invocationStart
        || activeConstants.has(declaration.name)) {
        return undefined;
      }
      activeConstants.add(declaration.name);
      evidenceNode = declaration.initializer;
      origin ??= {
        name: declaration.name,
        declarationRange: toSourceRange(input.sourceFile, declaration.declaration)
      };
      pending.push(
        { kind: "leave", name: declaration.name },
        { kind: "expression", expression: declaration.initializer, depth: task.depth + 1 }
      );
      continue;
    }
    return undefined;
  }

  const text = pieces.join("");
  if (text.trim().length === 0 || text.length > MAX_EMBEDDED_CODE_CHARACTERS) return undefined;
  return {
    text,
    evidenceNode,
    range: toSourceRange(input.sourceFile, evidenceNode),
    exactCodeTag: ts.isTaggedTemplateExpression(evidenceNode)
      && normalizeText(evidenceNode.tag.getText(input.sourceFile)) !== "String.raw",
    ...(origin ? { fromConstant: origin } : {})
  };
}

/** Removes only syntax wrappers that cannot alter a static string value. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
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

/** Finds eval inside a binding pattern without treating arbitrary text as a name. */
function bindingNameContains(name: ts.BindingName, expected: string): boolean {
  const pending: ts.BindingName[] = [name];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    if (ts.isIdentifier(current)) {
      if (current.text === expected) return true;
      continue;
    }
    for (let index = current.elements.length - 1; index >= 0; index -= 1) {
      const element = current.elements[index];
      if (ts.isBindingElement(element)) pending.push(element.name);
    }
  }
  return false;
}

/** Finds the variable declaration list owning a declaration without recursion. */
function findVariableDeclarationList(node: ts.VariableDeclaration): ts.VariableDeclarationList | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isVariableDeclarationList(current)) return current;
    if (ts.isStatement(current)) return undefined;
    current = current.parent;
  }
  return undefined;
}

/** Stops resolver indexing at a nested callable scope. */
function isNestedCallable(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node);
}

/** Recognizes explicit tags whose payload declares JavaScript/TypeScript source. */
function isCodeTag(tag: string): boolean {
  return tag === "String.raw" || CODE_TAG_NAMES.has(tag.split(".").at(-1) ?? tag);
}

/** Keeps property/text comparisons stable across formatting differences. */
function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
