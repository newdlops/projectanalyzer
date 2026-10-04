/**
 * Builds the Host-private, range-identity Scenario callable catalog.  This is
 * intentionally a small lexical resolver: it follows only declarations proven
 * by the parsed SourceFile and never consults graph names or reparses source.
 */
import * as ts from "typescript";
import { createContentHash } from "../../../shared/hash";
import type { SymbolNode } from "../../../shared/types";
import { toSourceRange } from "../../functionLogic/typescriptFunctionLogicSyntax";
import type { FunctionLikeWithBody } from "../../functionLogic/typescriptFunctionLogicInternal";
import type { FunctionTutorDeclarationAnalysis, FunctionTutorExpression } from "../types";
import type { FunctionTutorScenarioCatalog, FunctionTutorScenarioCatalogProgram, FunctionTutorScenarioInvocationRole } from "./types";

const MAX_PROGRAMS = 12;
const MAX_DEPTH = 4;

type Materialize = (node: FunctionLikeWithBody, symbol: SymbolNode, thisBindingId?: string) => FunctionTutorDeclarationAnalysis;
type Input = { sourceFile: ts.SourceFile; rootNode: SymbolNode; rootFunction: FunctionLikeWithBody; rootAnalysis: FunctionTutorDeclarationAnalysis; materialize: Materialize };
type Candidate = { node: FunctionLikeWithBody; role: FunctionTutorScenarioInvocationRole; ownerId?: string; thisBindingId?: string };

/** Returns flat callable records and exact call ranges reachable from the root. */
export function buildFunctionTutorScenarioCatalog(input: Input): FunctionTutorScenarioCatalog {
  const functions = new Map<string, FunctionLikeWithBody>();
  const classes = new Map<string, ts.ClassDeclaration>();
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  const duplicateNames = new Set<string>();
  const addUnique = <T>(map: Map<string, T>, name: string, value: T) => { if (map.has(name)) { map.delete(name); duplicateNames.add(name); } else if (!duplicateNames.has(name)) map.set(name, value); };
  for (const statement of input.sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) addUnique(functions, statement.name.text, statement as FunctionLikeWithBody);
    if (ts.isClassDeclaration(statement) && statement.name && !statement.heritageClauses && !(ts.getDecorators(statement)?.length)) addUnique(classes, statement.name.text, statement);
    if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer) && safeObjectLiteral(declaration.initializer)) addUnique(objects, declaration.name.text, declaration.initializer);
      if (ts.isIdentifier(declaration.name) && declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) addUnique(functions, declaration.name.text, declaration.initializer);
    }
  }
  const unstableFunctions = collectCallableWrites(input.sourceFile, new Set(functions.keys()));
  input.rootAnalysis.inputSummarySafe = [...functions].some(([name, node]) => node === input.rootFunction && !unstableFunctions.has(name));
  for (const name of unstableFunctions) functions.delete(name);
  const programs: FunctionTutorScenarioCatalogProgram[] = [];
  const resolutions: FunctionTutorScenarioCatalog["resolutions"] = [];
  const idFor = (node: ts.Node, role: string) => `scenario-private:${createContentHash(`${input.rootNode.filePath}\0${role}\0${node.pos}\0${node.end}`).slice(0, 28)}`;
  const rootId = input.rootNode.id;
  const seen = new Map<FunctionLikeWithBody, string>([[input.rootFunction, rootId]]);
  const queue: Array<{ node: FunctionLikeWithBody; id: string; analysis: FunctionTutorDeclarationAnalysis; depth: number; candidate: Candidate }> = [{ node: input.rootFunction, id: rootId, analysis: input.rootAnalysis, depth: 0, candidate: { node: input.rootFunction, role: "function" } }];
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    const locals = collectStableReceivers(current.node, classes, objects);
    const shadows = collectLexicalShadows(current.node);
    const pending: ts.Node[] = [current.node.body];
    while (pending.length) {
      const node = pending.pop()!;
      if (node !== current.node.body && ts.isFunctionLike(node)) continue;
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const candidate = resolveCandidate(node, current.node, functions, classes, objects, locals, shadows, idFor);
        if (!candidate || current.depth >= MAX_DEPTH) continue;
        let targetId = seen.get(candidate.node);
        if (!targetId) {
          if (programs.length + 1 >= MAX_PROGRAMS) continue;
          targetId = idFor(candidate.node, candidate.role);
          seen.set(candidate.node, targetId);
          const symbol = privateSymbol(input.rootNode, candidate.node, targetId);
          const analysis = input.materialize(candidate.node, symbol, candidate.thisBindingId);
          analysis.inputSummarySafe = candidate.role === "function";
          programs.push({ id: targetId, ownerId: candidate.ownerId, thisBindingId: candidate.thisBindingId, invocationRole: candidate.role, declaration: analysis, fieldInitializers: candidate.role === "constructor" ? collectFieldInitializers(candidate.node.parent) : [] });
          queue.push({ node: candidate.node, id: targetId, analysis, depth: current.depth + 1, candidate });
        }
        resolutions.push({ callerId: current.id, range: toSourceRange(input.sourceFile, node), targetId, ownerId: candidate.ownerId, invocationRole: candidate.role, requiresAwait: candidate.node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
          optionalDisposition: optionalDisposition(node, locals, objects) });
      }
      ts.forEachChild(node, (child) => { pending.push(child); });
    }
  }
  return { programs, resolutions };
}

function privateSymbol(root: SymbolNode, node: ts.Node, id: string): SymbolNode {
  const range = toSourceRange(node.getSourceFile(), node);
  const namedNode = node as ts.NamedDeclaration;
  const selectionRange = toSourceRange(node.getSourceFile(), namedNode.name ?? node);
  return { ...root, id, kind: ts.isConstructorDeclaration(node) ? "constructor" : "method", name: "Scenario callable", qualifiedName: "Scenario callable", range, selectionRange, metadata: { ...root.metadata, cursorResolved: true } };
}

function ownerFor(root: ts.Node, idFor: (node: ts.Node, role: string) => string): string { return idFor(root, "owner"); }
function methodOf(owner: ts.ClassDeclaration | ts.ObjectLiteralExpression, name: string, staticExpected?: boolean): FunctionLikeWithBody | undefined {
  const items = ts.isClassDeclaration(owner) ? owner.members : owner.properties;
  const matches: FunctionLikeWithBody[] = [];
  for (const item of items) {
    if ((ts.isMethodDeclaration(item) || ts.isPropertyAssignment(item)) && item.name && ts.isIdentifier(item.name) && item.name.text === name) {
      const isStatic = Boolean(ts.getCombinedModifierFlags(item) & ts.ModifierFlags.Static);
      if (ts.isMethodDeclaration(item) && item.body && (staticExpected === undefined || isStatic === staticExpected)) matches.push(item as FunctionLikeWithBody);
      if (ts.isPropertyAssignment(item) && (ts.isArrowFunction(item.initializer) || ts.isFunctionExpression(item.initializer))) matches.push(item.initializer);
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}
function resolveCandidate(node: ts.CallExpression | ts.NewExpression, caller: FunctionLikeWithBody, functions: Map<string, FunctionLikeWithBody>, classes: Map<string, ts.ClassDeclaration>, objects: Map<string, ts.ObjectLiteralExpression>, locals: Map<string, string>, shadows: Set<string>, idFor: (node: ts.Node, role: string) => string): Candidate | undefined {
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    if (shadows.has(node.expression.text)) return undefined;
    const klass = classes.get(node.expression.text); if (!klass) return undefined;
    const constructor = klass.members.find(ts.isConstructorDeclaration); if (!constructor || !constructor.body) return undefined;
    const ownerId = ownerFor(klass, idFor); return { node: constructor as FunctionLikeWithBody, role: "constructor", ownerId, thisBindingId: `${ownerId}:this` };
  }
  if (!ts.isCallExpression(node)) return undefined;
  if (ts.isIdentifier(node.expression)) { if (shadows.has(node.expression.text)) return undefined; const fn = functions.get(node.expression.text); return fn ? { node: fn, role: "function" } : undefined; }
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  const receiver = node.expression.expression, name = node.expression.name.text;
  if (receiver.kind === ts.SyntaxKind.ThisKeyword) {
    const parent = caller.parent; if (!parent || !ts.isClassDeclaration(parent)) return undefined;
    const method = methodOf(parent, name, false); const ownerId = ownerFor(parent, idFor); return method ? { node: method, role: "method", ownerId, thisBindingId: `${ownerId}:this` } : undefined;
  }
  if (ts.isIdentifier(receiver) && classes.has(receiver.text) && !shadows.has(receiver.text)) {
    const klass = classes.get(receiver.text)!; const method = methodOf(klass, name, true); const ownerId = ownerFor(klass, idFor); return method ? { node: method, role: "static-method", ownerId, thisBindingId: `${ownerId}:this` } : undefined;
  }
  if (ts.isIdentifier(receiver) && locals.has(receiver.text)) {
    const klass = classes.get(locals.get(receiver.text)!); const method = klass && methodOf(klass, name, false); const ownerId = klass && ownerFor(klass, idFor); return method && ownerId ? { node: method, role: "method", ownerId, thisBindingId: `${ownerId}:this` } : undefined;
  }
  if (ts.isIdentifier(receiver) && objects.has(receiver.text)) { const object = objects.get(receiver.text)!; const method = methodOf(object, name); const ownerId = ownerFor(object, idFor); return method ? { node: method, role: "object-method", ownerId, thisBindingId: `${ownerId}:this` } : undefined; }
  return undefined;
}
function collectStableReceivers(node: FunctionLikeWithBody, classes: Map<string, ts.ClassDeclaration>, _objects: Map<string, ts.ObjectLiteralExpression>): Map<string, string> {
  const result = new Map<string, string>(); const pending: ts.Node[] = [node.body];
  while (pending.length) { const current = pending.pop()!; if (current !== node.body && ts.isFunctionLike(current)) continue;
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name) && current.parent && ts.isVariableDeclarationList(current.parent) && Boolean(current.parent.flags & ts.NodeFlags.Const) && current.initializer && ts.isNewExpression(current.initializer) && ts.isIdentifier(current.initializer.expression) && classes.has(current.initializer.expression.text) && !hasBindingWrite(node, current.name.text, current)) result.set(current.name.text, current.initializer.expression.text);
    ts.forEachChild(current, (child) => { pending.push(child); }); }
  return result;
}
/** Reject mutable receiver aliases instead of inferring a post-write class. */
function hasBindingWrite(root: FunctionLikeWithBody, name: string, declaration: ts.VariableDeclaration): boolean {
  const pending: ts.Node[] = [root.body];
  while (pending.length) { const current = pending.pop()!; if (current !== root.body && ts.isFunctionLike(current)) continue;
    if (ts.isBinaryExpression(current) && ts.isIdentifier(current.left) && current.left.text === name && current.left !== declaration.name && current.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && current.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true;
    if ((ts.isPrefixUnaryExpression(current) || ts.isPostfixUnaryExpression(current)) && ts.isIdentifier(current.operand) && current.operand.text === name) return true;
    ts.forEachChild(current, (child) => pending.push(child)); }
  return false;
}

/** Locals/parameters shadow top-level names, so they block rather than guess dispatch. */
function collectLexicalShadows(node: FunctionLikeWithBody): Set<string> {
  const shadows = new Set<string>();
  for (const parameter of node.parameters) for (const name of bindingNames(parameter.name)) shadows.add(name);
  const pending: ts.Node[] = [node.body];
  while (pending.length) { const current = pending.pop()!;
    // Record a declaration before skipping its body: a nested function shadows
    // the top-level name even though its code is not part of this root's CFG.
    if ((ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)) && current.name) shadows.add(current.name.text);
    if (current !== node.body && ts.isFunctionLike(current)) continue;
    if (ts.isVariableDeclaration(current)) for (const name of bindingNames(current.name)) shadows.add(name);
    ts.forEachChild(current, (child) => { pending.push(child); }); }
  return shadows;
}

/** Any potential write blocks stable callable dispatch, including destructuring and nested writers. */
function collectCallableWrites(source: ts.SourceFile, names: Set<string>): Set<string> {
  const unstable = new Set<string>(); const pending: ts.Node[] = [source]; const visited = new Set<ts.Node>();
  const recordTarget = (target: ts.Node) => {
    const targets = [target]; const seen = new Set<ts.Node>();
    while (targets.length) {
      const item = targets.pop()!; if (seen.has(item)) continue; seen.add(item);
      if (seen.size > 256) { for (const name of names) unstable.add(name); return; }
      if (ts.isIdentifier(item) && names.has(item.text)) unstable.add(item.text);
      else if (ts.isPropertyAccessExpression(item)) { if (names.has(item.name.text)) unstable.add(item.name.text); }
      else if (ts.isElementAccessExpression(item)) {
        if (item.argumentExpression && ts.isStringLiteral(item.argumentExpression) && names.has(item.argumentExpression.text)) unstable.add(item.argumentExpression.text);
      } else ts.forEachChild(item, (child) => { targets.push(child); });
    }
  };
  while (pending.length) {
    const node = pending.pop()!; if (visited.has(node)) continue; visited.add(node);
    if (visited.size > 50000) return new Set(names);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) recordTarget(node.left);
    else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) recordTarget(node.operand);
    else if (ts.isForOfStatement(node) || ts.isForInStatement(node)) recordTarget(node.initializer);
    else if (ts.isWithStatement(node) || ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "eval") return new Set(names);
    ts.forEachChild(node, (child) => { pending.push(child); });
  }
  return unstable;
}

/** Parameter/local binding patterns are names, not reads of same-named global callables. */
function bindingNames(root: ts.BindingName): string[] {
  const names: string[] = []; const pending: ts.BindingName[] = [root]; const visited = new Set<ts.Node>();
  while (pending.length && visited.size < 256) {
    const item = pending.pop()!; if (visited.has(item)) continue; visited.add(item);
    if (ts.isIdentifier(item)) names.push(item.text);
    else for (const element of item.elements) if (ts.isBindingElement(element)) pending.push(element.name);
  }
  return names;
}
function optionalDisposition(node: ts.CallExpression | ts.NewExpression, locals: Map<string, string>, objects: Map<string, ts.ObjectLiteralExpression>): "present" | "absent" | "unknown" | undefined {
  if (!ts.isCallExpression(node) || !(node.questionDotToken || (ts.isPropertyAccessExpression(node.expression) && node.expression.questionDotToken))) return undefined;
  if (ts.isPropertyAccessExpression(node.expression)) {
    const receiver = unwrapExpression(node.expression.expression);
    if (receiver.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(receiver) && receiver.text === "undefined")) return "absent";
    if (ts.isIdentifier(receiver)) return locals.has(receiver.text) || objects.has(receiver.text) ? "present" : "unknown";
  }
  return "unknown";
}
function unwrapExpression(expression: ts.Expression): ts.Expression { let current = expression; while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression; return current; }
/** Object dispatch requires plain own data/method members with no spread or accessor behavior. */
function safeObjectLiteral(object: ts.ObjectLiteralExpression): boolean { return object.properties.every((property) => (ts.isMethodDeclaration(property) || ts.isPropertyAssignment(property)) && Boolean(property.name) && ts.isIdentifier(property.name)); }
function collectFieldInitializers(parent: ts.Node | undefined): Array<{ key: string; range: import("../../../shared/types").SourceRange; value: FunctionTutorExpression }> {
  if (!parent || !ts.isClassDeclaration(parent)) return [];
  const fields: Array<{ key: string; range: import("../../../shared/types").SourceRange; value: FunctionTutorExpression }> = [];
  for (const member of parent.members) if (ts.isPropertyDeclaration(member) && member.initializer && member.name && ts.isIdentifier(member.name)) {
    const value = safeFieldValue(member.initializer);
    if (value) fields.push({ key: member.name.text, range: toSourceRange(parent.getSourceFile(), member.initializer), value });
  }
  return fields;
}

/** Field initializers are deliberately literal-only: no reads or effects occur before construction. */
function safeFieldValue(node: ts.Expression): FunctionTutorExpression | undefined {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { kind: "literal", value: { kind: "boolean", value: true } };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { kind: "literal", value: { kind: "boolean", value: false } };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: "literal", value: { kind: "null" } };
  if (ts.isIdentifier(node) && node.text === "undefined") return { kind: "literal", value: { kind: "undefined" } };
  if (ts.isNumericLiteral(node)) return { kind: "literal", value: { kind: "number", value: Number(node.text) } };
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { kind: "literal", value: { kind: "string", value: node.text } };
  return undefined;
}
