/**
 * Bounded TypeScript parameter-type classification for Function Tutor inputs.
 * It resolves only same-file aliases/interfaces and uses an iterative
 * post-order stack so aliases cannot recurse indefinitely or execute code.
 */

import * as ts from "typescript";
import {
  isFunctionTutorSafeObjectKey,
  stringifyFunctionTutorStaticValue
} from "./staticValue";
import type {
  FunctionTutorMemberFact,
  FunctionTutorObjectEntry,
  FunctionTutorParameterTypeKind,
  FunctionTutorStaticValue
} from "./types";

const MAX_TYPE_RESOLUTION_DEPTH = 8;
const MAX_TYPE_RESOLUTION_STEPS = 96;
const MAX_MEMBER_DEPTH = 2;
const MAX_MEMBER_FACTS = 16;
const MAX_MEMBER_RESOLUTION_STEPS = 64;

type ParameterTypeFacts = {
  kind: FunctionTutorParameterTypeKind;
  literalValues: FunctionTutorStaticValue[];
  representative?: FunctionTutorStaticValue;
};

type LocalTypeDeclaration =
  | ts.TypeAliasDeclaration
  | ts.InterfaceDeclaration
  | ts.EnumDeclaration;

type MemberSource = ts.TypeNode | ts.InterfaceDeclaration;

type TypeComposite = {
  mode: "passthrough" | "union" | "intersection";
  children: ts.TypeNode[];
};

const UNKNOWN_TYPE_FACTS: ParameterTypeFacts = { kind: "unknown", literalValues: [] };

/** Classifies a declared type without requiring a Program or following imports. */
export function readFunctionTutorParameterTypeFacts(
  type: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile
): ParameterTypeFacts {
  if (!type) return UNKNOWN_TYPE_FACTS;
  const declarations = collectLocalTypeDeclarations(sourceFile);
  const factsByNode = new Map<ts.TypeNode, ParameterTypeFacts>();
  const visiting = new Set<ts.TypeNode>();
  const pending: Array<{ node: ts.TypeNode; depth: number; expanded: boolean }> = [
    { node: type, depth: 0, expanded: false }
  ];
  let steps = 0;

  while (pending.length > 0 && steps < MAX_TYPE_RESOLUTION_STEPS) {
    steps += 1;
    const frame = pending.pop()!;
    if (factsByNode.has(frame.node) && !frame.expanded) continue;
    if (frame.depth > MAX_TYPE_RESOLUTION_DEPTH) {
      factsByNode.set(frame.node, UNKNOWN_TYPE_FACTS);
      continue;
    }
    const terminal = readTerminalTypeFacts(frame.node, declarations);
    if (terminal) {
      factsByNode.set(frame.node, terminal);
      continue;
    }
    const composite = readTypeComposite(frame.node, declarations);
    if (!composite) {
      factsByNode.set(frame.node, UNKNOWN_TYPE_FACTS);
      continue;
    }
    if (!frame.expanded) {
      if (visiting.has(frame.node)) {
        factsByNode.set(frame.node, UNKNOWN_TYPE_FACTS);
        continue;
      }
      visiting.add(frame.node);
      pending.push({ ...frame, expanded: true });
      for (let index = composite.children.length - 1; index >= 0; index -= 1) {
        pending.push({ node: composite.children[index], depth: frame.depth + 1, expanded: false });
      }
      continue;
    }
    visiting.delete(frame.node);
    const children = composite.children.map((child) => factsByNode.get(child) ?? UNKNOWN_TYPE_FACTS);
    factsByNode.set(frame.node, combineTypeFacts(composite.mode, children));
  }
  const facts = pending.length > 0 ? UNKNOWN_TYPE_FACTS : factsByNode.get(type) ?? UNKNOWN_TYPE_FACTS;
  // The classifier owns the same-file syntax boundary, so a representative
  // cannot accidentally resolve imports or execute a checker/program lookup.
  return { ...facts, representative: readTypeRepresentative(type, sourceFile, declarations) };
}

/**
 * Produces one JSON-safe same-file example with an explicit iterative post-order
 * traversal. A missing child makes a shaped type unavailable instead of silently
 * replacing it with an empty object or array.
 */
function readTypeRepresentative(
  root: ts.TypeNode,
  sourceFile: ts.SourceFile,
  declarations: Map<string, LocalTypeDeclaration>
): FunctionTutorStaticValue | undefined {
  type Frame = { node: ts.TypeNode | ts.InterfaceDeclaration; depth: number; expanded: boolean };
  const values = new Map<ts.Node, FunctionTutorStaticValue | undefined>();
  const visiting = new Set<ts.Node>();
  const pending: Frame[] = [{ node: root, depth: 0, expanded: false }];
  let steps = 0;
  while (pending.length > 0 && steps < MAX_TYPE_RESOLUTION_STEPS) {
    steps += 1;
    const frame = pending.pop()!;
    if (values.has(frame.node)) continue;
    if (frame.depth > MAX_TYPE_RESOLUTION_DEPTH || (!frame.expanded && visiting.has(frame.node))) {
      values.set(frame.node, undefined);
      continue;
    }
    const node = frame.node;
    if (!frame.expanded) {
      const children = representativeChildren(node, declarations);
      if (!children) {
        values.set(node, readRepresentativeLeaf(node, declarations));
        continue;
      }
      visiting.add(node);
      pending.push({ ...frame, expanded: true });
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push({ node: children[index], depth: frame.depth + 1, expanded: false });
      }
      continue;
    }
    visiting.delete(node);
    values.set(node, combineRepresentative(node, representativeChildren(node, declarations) ?? [], values, sourceFile));
  }
  return pending.length === 0 ? values.get(root) : undefined;
}

/** Identifies syntax children without following imported/global declarations. */
function representativeChildren(node: ts.TypeNode | ts.InterfaceDeclaration, declarations: Map<string, LocalTypeDeclaration>): Array<ts.TypeNode | ts.InterfaceDeclaration> | undefined {
  if (ts.isInterfaceDeclaration(node)) return requiredPropertyTypes(node.members);
  if (ts.isTypeLiteralNode(node)) return requiredPropertyTypes(node.members);
  if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node)) return [node.type];
  if (ts.isArrayTypeNode(node)) return [node.elementType];
  if (ts.isTupleTypeNode(node)) return node.elements.flatMap((element) => {
    const type = ts.isNamedTupleMember(element) ? element.type : element;
    return ts.isOptionalTypeNode(type) ? [] : [type];
  });
  if (ts.isUnionTypeNode(node)) return [...node.types];
  if (ts.isIntersectionTypeNode(node)) return [...node.types];
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const declaration = declarations.get(node.typeName.text);
    if (declaration && ts.isTypeAliasDeclaration(declaration)) return [declaration.type];
    if (declaration && ts.isInterfaceDeclaration(declaration)) return [declaration];
    if ((node.typeName.text === "Array" || node.typeName.text === "ReadonlyArray") && node.typeArguments?.[0]) return [node.typeArguments[0]];
  }
  return undefined;
}

/** Returns only required, safe own properties in their source order. */
function requiredPropertyTypes(members: ts.NodeArray<ts.TypeElement>): ts.TypeNode[] {
  const result: ts.TypeNode[] = [];
  for (const member of members) {
    const property = readMemberProperty(member);
    if (!property || property.optional || property.callable || !property.type || !isFunctionTutorSafeObjectKey(property.name)) continue;
    result.push(property.type);
  }
  return result;
}

/** Reads one supported primitive/literal or broad unshaped object leaf. */
function readRepresentativeLeaf(node: ts.TypeNode | ts.InterfaceDeclaration, declarations: Map<string, LocalTypeDeclaration>): FunctionTutorStaticValue | undefined {
  if (ts.isInterfaceDeclaration(node)) return { kind: "object", entries: [], truncated: false };
  if (node.kind === ts.SyntaxKind.BooleanKeyword) return { kind: "boolean", value: false };
  if (node.kind === ts.SyntaxKind.NumberKeyword || node.kind === ts.SyntaxKind.BigIntKeyword) return { kind: "number", value: 0 };
  if (node.kind === ts.SyntaxKind.StringKeyword) return { kind: "string", value: "sample" };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: "null" };
  if (node.kind === ts.SyntaxKind.UndefinedKeyword || node.kind === ts.SyntaxKind.VoidKeyword) return { kind: "undefined" };
  if (node.kind === ts.SyntaxKind.ObjectKeyword) return { kind: "object", entries: [], truncated: false };
  if (ts.isLiteralTypeNode(node)) return readTypeLiteralValue(node.literal);
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    if (node.typeName.text === "Object" || node.typeName.text === "Record") return { kind: "object", entries: [], truncated: false };
    const declaration = declarations.get(node.typeName.text);
    if (declaration && ts.isEnumDeclaration(declaration)) return undefined;
  }
  return undefined;
}

/** Combines child examples while retaining tuple order and all required shape fields. */
function combineRepresentative(node: ts.TypeNode | ts.InterfaceDeclaration, children: Array<ts.TypeNode | ts.InterfaceDeclaration>, values: Map<ts.Node, FunctionTutorStaticValue | undefined>, sourceFile: ts.SourceFile): FunctionTutorStaticValue | undefined {
  const childValues = children.map((child) => values.get(child));
  if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node)) return childValues[0];
  if (ts.isArrayTypeNode(node) || (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && (node.typeName.text === "Array" || node.typeName.text === "ReadonlyArray"))) {
    return childValues[0] ? { kind: "array", items: [childValues[0]], truncated: false } : undefined;
  }
  if (ts.isTupleTypeNode(node)) return childValues.every(Boolean) ? { kind: "array", items: childValues as FunctionTutorStaticValue[], truncated: false } : undefined;
  if (ts.isUnionTypeNode(node)) return childValues.find(Boolean);
  if (ts.isIntersectionTypeNode(node)) {
    if (!childValues.every((value) => value?.kind === "object")) return undefined;
    const entries: FunctionTutorObjectEntry[] = [];
    const seen = new Set<string>();
    for (const value of childValues as Array<FunctionTutorStaticValue & { kind: "object" }>) for (const entry of value.entries) {
      if (!seen.has(entry.key)) { seen.add(entry.key); entries.push(entry); }
    }
    return { kind: "object", entries, truncated: false };
  }
  if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
    if (hasUnsupportedRequiredMember(node.members)) return undefined;
    if (!childValues.every(Boolean)) return undefined;
    const entries: FunctionTutorObjectEntry[] = [];
    const memberByName = new Map<string, FunctionTutorStaticValue>();
    for (let index = 0; index < children.length; index += 1) memberByName.set(requiredPropertyName(node, index, sourceFile), childValues[index]!);
    for (const [key, value] of memberByName) entries.push({ key, value });
    return { kind: "object", entries, truncated: false };
  }
  return childValues[0];
}

/** Callable, computed, and unknown required members make a shape unavailable. */
function hasUnsupportedRequiredMember(members: ts.NodeArray<ts.TypeElement>): boolean {
  for (const member of members) {
    const property = readMemberProperty(member);
    if (!property) return true;
    if (property.optional) continue;
    if (property.callable || !property.type || !isFunctionTutorSafeObjectKey(property.name)) return true;
  }
  return false;
}

/** Re-reads the source-ordered safe key paired with a required property child. */
function requiredPropertyName(node: ts.TypeLiteralNode | ts.InterfaceDeclaration, index: number, _sourceFile: ts.SourceFile): string {
  let seen = -1;
  for (const member of node.members) {
    const property = readMemberProperty(member);
    if (!property || property.optional || property.callable || !property.type || !isFunctionTutorSafeObjectKey(property.name)) continue;
    seen += 1;
    if (seen === index) return property.name;
  }
  return "";
}

/** Collects bounded object-shape members, then adds destructuring-only fallbacks. */
export function readFunctionTutorParameterMembers(
  parameter: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile
): FunctionTutorMemberFact[] {
  const members: FunctionTutorMemberFact[] = [];
  const seenPaths = new Set<string>();
  const declarations = collectLocalTypeDeclarations(sourceFile);
  const pending: Array<{ source: MemberSource; path: string[]; depth: number; optionalAncestor: boolean }> = parameter.type
    ? [{ source: parameter.type, path: [], depth: 0, optionalAncestor: false }]
    : [];
  const visited = new Set<string>();
  let steps = 0;

  while (pending.length > 0
    && members.length < MAX_MEMBER_FACTS
    && steps < MAX_MEMBER_RESOLUTION_STEPS) {
    steps += 1;
    const frame = pending.pop()!;
    const visitKey = `${frame.source.pos}:${frame.source.end}:${frame.path.join(".")}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    const declarationsToRead = ts.isInterfaceDeclaration(frame.source)
      ? frame.source.members
      : ts.isTypeLiteralNode(frame.source)
        ? frame.source.members
        : undefined;
    if (declarationsToRead) {
      for (const declaration of declarationsToRead) {
        if (members.length >= MAX_MEMBER_FACTS) break;
        const property = readMemberProperty(declaration);
        if (!property || !isFunctionTutorSafeObjectKey(property.name)) continue;
        const path = [...frame.path, property.name];
        const pathKey = path.join(".");
        const optional = frame.optionalAncestor || property.optional;
        const facts = property.type
          ? readFunctionTutorParameterTypeFacts(property.type, sourceFile)
          : property.callable
            ? { kind: "callable" as const, literalValues: [] }
            : UNKNOWN_TYPE_FACTS;
        if (!seenPaths.has(pathKey)) {
          seenPaths.add(pathKey);
          members.push({ path, typeKind: facts.kind, optional, literalValues: facts.literalValues });
        }
        if (property.type && facts.kind === "object" && frame.depth < MAX_MEMBER_DEPTH - 1) {
          pending.push({ source: property.type, path, depth: frame.depth + 1, optionalAncestor: optional });
        }
      }
      continue;
    }
    if (ts.isParenthesizedTypeNode(frame.source) || ts.isTypeOperatorNode(frame.source)) {
      pending.push({ ...frame, source: frame.source.type });
      continue;
    }
    if (ts.isIntersectionTypeNode(frame.source)) {
      for (let index = frame.source.types.length - 1; index >= 0; index -= 1) {
        pending.push({ ...frame, source: frame.source.types[index] });
      }
      continue;
    }
    if (ts.isTypeReferenceNode(frame.source) && ts.isIdentifier(frame.source.typeName)) {
      const declaration = declarations.get(frame.source.typeName.text);
      if (declaration && ts.isTypeAliasDeclaration(declaration)) pending.push({ ...frame, source: declaration.type });
      else if (declaration && ts.isInterfaceDeclaration(declaration)) pending.push({ ...frame, source: declaration });
    }
  }

  if (ts.isObjectBindingPattern(parameter.name)) {
    for (const element of parameter.name.elements.slice(0, 8)) {
      if (!ts.isIdentifier(element.name)) continue;
      const path = [element.propertyName?.getText(sourceFile) ?? element.name.text];
      const pathKey = path.join(".");
      if (seenPaths.has(pathKey) || !isFunctionTutorSafeObjectKey(path[0])) continue;
      seenPaths.add(pathKey);
      members.push({
        path,
        typeKind: "unknown",
        optional: Boolean(element.initializer),
        literalValues: []
      });
    }
  }
  return members;
}

/** Reads one property or method signature without interpreting computed names. */
function readMemberProperty(declaration: ts.TypeElement): {
  name: string;
  type?: ts.TypeNode;
  optional: boolean;
  callable: boolean;
} | undefined {
  if (!ts.isPropertySignature(declaration) && !ts.isMethodSignature(declaration)) return undefined;
  const name = ts.isIdentifier(declaration.name)
    || ts.isStringLiteral(declaration.name)
    || ts.isNumericLiteral(declaration.name)
    ? declaration.name.text
    : undefined;
  return name ? {
    name,
    type: ts.isPropertySignature(declaration) ? declaration.type : undefined,
    optional: Boolean(declaration.questionToken),
    callable: ts.isMethodSignature(declaration)
  } : undefined;
}

/** Indexes only top-level declarations in the same parser-owned source file. */
function collectLocalTypeDeclarations(sourceFile: ts.SourceFile): Map<string, LocalTypeDeclaration> {
  const declarations = new Map<string, LocalTypeDeclaration>();
  for (const statement of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(statement)
      && !ts.isInterfaceDeclaration(statement)
      && !ts.isEnumDeclaration(statement)) continue;
    if (!declarations.has(statement.name.text)) declarations.set(statement.name.text, statement);
  }
  return declarations;
}

/** Returns a leaf classification; aliases and composite types continue through the stack. */
function readTerminalTypeFacts(
  type: ts.TypeNode,
  declarations: Map<string, LocalTypeDeclaration>
): ParameterTypeFacts | undefined {
  if (type.kind === ts.SyntaxKind.BooleanKeyword) return { kind: "boolean", literalValues: [] };
  if (type.kind === ts.SyntaxKind.NumberKeyword || type.kind === ts.SyntaxKind.BigIntKeyword) return { kind: "number", literalValues: [] };
  if (type.kind === ts.SyntaxKind.StringKeyword) return { kind: "string", literalValues: [] };
  if (type.kind === ts.SyntaxKind.NullKeyword) return { kind: "null", literalValues: [{ kind: "null" }] };
  if (type.kind === ts.SyntaxKind.UndefinedKeyword || type.kind === ts.SyntaxKind.VoidKeyword) return { kind: "undefined", literalValues: [{ kind: "undefined" }] };
  if (type.kind === ts.SyntaxKind.ObjectKeyword || ts.isTypeLiteralNode(type)) return { kind: "object", literalValues: [] };
  if (ts.isArrayTypeNode(type)) return { kind: "array", literalValues: [] };
  if (ts.isTupleTypeNode(type)) return { kind: "tuple", literalValues: [] };
  if (ts.isFunctionTypeNode(type) || ts.isConstructorTypeNode(type)) return { kind: "callable", literalValues: [] };
  if (ts.isLiteralTypeNode(type)) {
    const value = readTypeLiteralValue(type.literal);
    return { kind: "literal-union", literalValues: value ? [value] : [] };
  }
  if (!ts.isTypeReferenceNode(type)) return undefined;
  const name = ts.isIdentifier(type.typeName) ? type.typeName.text : undefined;
  if (name === "Array" || name === "ReadonlyArray") return { kind: "array", literalValues: [] };
  if (name === "Record" || name === "Object") return { kind: "object", literalValues: [] };
  if (name === "Function") return { kind: "callable", literalValues: [] };
  const declaration = name ? declarations.get(name) : undefined;
  if (declaration && ts.isInterfaceDeclaration(declaration)) return { kind: "object", literalValues: [] };
  if (declaration && ts.isEnumDeclaration(declaration)) return { kind: "enum", literalValues: [] };
  return declaration && ts.isTypeAliasDeclaration(declaration) ? undefined : UNKNOWN_TYPE_FACTS;
}

/** Describes the children whose facts must be available before this type can be combined. */
function readTypeComposite(
  type: ts.TypeNode,
  declarations: Map<string, LocalTypeDeclaration>
): TypeComposite | undefined {
  if (ts.isParenthesizedTypeNode(type) || ts.isTypeOperatorNode(type)) {
    return { mode: "passthrough", children: [type.type] };
  }
  if (ts.isUnionTypeNode(type)) return { mode: "union", children: [...type.types] };
  if (ts.isIntersectionTypeNode(type)) return { mode: "intersection", children: [...type.types] };
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const declaration = declarations.get(type.typeName.text);
    if (declaration && ts.isTypeAliasDeclaration(declaration)) {
      return { mode: "passthrough", children: [declaration.type] };
    }
  }
  return undefined;
}

/** Combines child categories without broadening incompatible unions or intersections. */
function combineTypeFacts(mode: TypeComposite["mode"], children: ParameterTypeFacts[]): ParameterTypeFacts {
  if (mode === "passthrough") return children[0] ?? UNKNOWN_TYPE_FACTS;
  const literalValues = uniqueStaticValues(children.flatMap((child) => child.literalValues));
  const kinds = children.map((child) => child.kind);
  if (mode === "union"
    && literalValues.length > 0
    && kinds.every((kind) => kind === "literal-union" || kind === "null" || kind === "undefined")) {
    return { kind: "literal-union", literalValues };
  }
  if (mode === "intersection") {
    return kinds.length > 0 && kinds.every((kind) => kind === "object")
      ? { kind: "object", literalValues: [] }
      : UNKNOWN_TYPE_FACTS;
  }
  const materialKinds = kinds.filter((kind) => kind !== "null" && kind !== "undefined");
  const uniqueKinds = new Set(materialKinds);
  const materialKind = materialKinds[0];
  return materialKind && uniqueKinds.size === 1
    && kinds.every((kind) => kind === materialKind || kind === "null" || kind === "undefined")
    ? { kind: materialKind, literalValues: [] }
    : UNKNOWN_TYPE_FACTS;
}

/** Reads only literal syntax that is already representable by the Tutor protocol. */
function readTypeLiteralValue(literal: ts.LiteralTypeNode["literal"]): FunctionTutorStaticValue | undefined {
  if (literal.kind === ts.SyntaxKind.TrueKeyword) return { kind: "boolean", value: true };
  if (literal.kind === ts.SyntaxKind.FalseKeyword) return { kind: "boolean", value: false };
  if (literal.kind === ts.SyntaxKind.NullKeyword) return { kind: "null" };
  if (ts.isStringLiteral(literal)) return { kind: "string", value: literal.text };
  if (ts.isNumericLiteral(literal)) return { kind: "number", value: Number(literal.text) };
  if (ts.isPrefixUnaryExpression(literal)
    && literal.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(literal.operand)) return { kind: "number", value: -Number(literal.operand.text) };
  return undefined;
}

/** Keeps source order while removing structurally identical union literals. */
function uniqueStaticValues(values: FunctionTutorStaticValue[]): FunctionTutorStaticValue[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = stringifyFunctionTutorStaticValue(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
