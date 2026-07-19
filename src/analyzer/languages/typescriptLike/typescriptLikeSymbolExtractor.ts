/**
 * TypeScript compiler API based symbol extraction shared by TypeScript and
 * JavaScript analyzers. Traversal is iterative to keep graph construction safe
 * for large files and deeply nested declarations.
 */

import * as ts from "typescript";
import { createFileNodeId } from "../../core/graphNodes";
import { createNodeId } from "../../../shared/ids";
import type { SourceRange, SymbolKind, SymbolNode } from "../../../shared/types";
import type { ParsedFile } from "../../core/languageAnalyzer";
import { findTypeScriptLikeWrappedComponentFunction } from "./typescriptLikeJsxSyntax";

/** Options that distinguish TypeScript, TSX, JavaScript, and JSX parsing. */
export type TypeScriptLikeParseOptions = {
  scriptKind: ts.ScriptKind;
};

/** Internal stack entry used by iterative AST traversal. */
type TraversalEntry = {
  node: ts.Node;
  parentId: string;
  scopeNames: string[];
};

/** Description of a symbol-bearing AST node. */
type SymbolDescriptor = {
  kind: SymbolKind;
  name: string;
  nameNode?: ts.Node;
  metadata?: Record<string, unknown>;
};

/**
 * Parses a TypeScript-like source file with the TypeScript compiler API.
 */
export function parseTypeScriptLikeSource(
  fileName: string,
  content: string,
  options: TypeScriptLikeParseOptions
): ts.SourceFile {
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, options.scriptKind);
}

/**
 * Extracts symbol nodes from a parsed TypeScript-like source file.
 */
export function extractTypeScriptLikeSymbols(parsed: ParsedFile): SymbolNode[] {
  const sourceFile = asTypeScriptSourceFile(parsed.ast);
  const symbols: SymbolNode[] = [];
  const stack = createInitialTraversalStack(sourceFile, createFileNodeId(parsed.file.path));

  while (stack.length > 0) {
    const entry = stack.pop();

    if (!entry) {
      continue;
    }

    const descriptor = getSymbolDescriptor(entry.node, sourceFile);
    const nextParentId = descriptor
      ? createSymbol(entry, descriptor, parsed, sourceFile, symbols).id
      : entry.parentId;
    const nextScopeNames = descriptor ? [...entry.scopeNames, descriptor.name] : entry.scopeNames;
    const children = getImmediateChildren(entry.node);

    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        node: children[index],
        parentId: nextParentId,
        scopeNames: nextScopeNames
      });
    }
  }

  return symbols;
}

/**
 * Converts the opaque parsed AST into a TypeScript source file.
 */
function asTypeScriptSourceFile(ast: unknown): ts.SourceFile {
  if (!ast || typeof ast !== "object" || !("kind" in ast)) {
    throw new Error("Parsed AST is not a TypeScript source file.");
  }

  return ast as ts.SourceFile;
}

/**
 * Creates traversal entries for top-level AST children.
 */
function createInitialTraversalStack(sourceFile: ts.SourceFile, fileNodeId: string): TraversalEntry[] {
  const children = getImmediateChildren(sourceFile);
  const stack: TraversalEntry[] = [];

  for (let index = children.length - 1; index >= 0; index -= 1) {
    stack.push({
      node: children[index],
      parentId: fileNodeId,
      scopeNames: []
    });
  }

  return stack;
}

/**
 * Returns immediate children without recursively descending into the subtree.
 */
function getImmediateChildren(node: ts.Node): ts.Node[] {
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    children.push(child);
    return undefined;
  });
  return children;
}

/**
 * Creates and records a graph symbol node from a symbol-bearing AST node.
 */
function createSymbol(
  entry: TraversalEntry,
  descriptor: SymbolDescriptor,
  parsed: ParsedFile,
  sourceFile: ts.SourceFile,
  symbols: SymbolNode[]
): SymbolNode {
  const range = getNodeRange(sourceFile, entry.node);
  const selectionRange = descriptor.nameNode
    ? getNodeRange(sourceFile, descriptor.nameNode)
    : range;
  const qualifiedName = [...entry.scopeNames, descriptor.name].join(".");
  const symbol: SymbolNode = {
    id: createNodeId([
      "symbol",
      parsed.file.path,
      descriptor.kind,
      qualifiedName,
      String(range.startLine),
      String(range.startCharacter)
    ]),
    kind: descriptor.kind,
    name: descriptor.name,
    qualifiedName,
    filePath: parsed.file.path,
    range,
    selectionRange,
    language: parsed.file.languageId,
    parentId: entry.parentId,
    metadata: descriptor.metadata
  };

  symbols.push(symbol);
  return symbol;
}

/**
 * Detects symbol-bearing TypeScript AST nodes and extracts display metadata.
 */
function getSymbolDescriptor(node: ts.Node, sourceFile: ts.SourceFile): SymbolDescriptor | undefined {
  if (ts.isClassDeclaration(node) && node.name) {
    return createNamedDescriptor("class", node.name, node);
  }

  if (ts.isInterfaceDeclaration(node)) {
    return createNamedDescriptor("interface", node.name, node);
  }

  if (ts.isEnumDeclaration(node)) {
    return createNamedDescriptor("enum", node.name, node);
  }

  if (ts.isFunctionDeclaration(node) && node.name) {
    return createNamedDescriptor("function", node.name, node);
  }

  if (ts.isMethodDeclaration(node) && node.name) {
    return createNamedDescriptor("method", node.name, node);
  }

  if (ts.isConstructorDeclaration(node)) {
    return {
      kind: "constructor",
      name: "constructor",
      metadata: createModifierMetadata(node)
    };
  }

  if (ts.isPropertyDeclaration(node) && node.name) {
    return createNamedDescriptor("property", node.name, node);
  }

  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    const kind: SymbolKind = isFunctionLikeInitializer(node.initializer) ? "function" : "variable";
    return createNamedDescriptor(kind, node.name, node);
  }

  if (ts.isModuleDeclaration(node) && node.name) {
    return createNamedDescriptor("module", node.name, node);
  }

  if (ts.isFunctionExpression(node) && node.name) {
    return createNamedDescriptor("function", node.name, node);
  }

  if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    return createNamedDescriptor("property", node.name, node);
  }

  if (ts.isSourceFile(node)) {
    return undefined;
  }

  void sourceFile;
  return undefined;
}

/**
 * Creates a descriptor for nodes with a source-backed name node.
 */
function createNamedDescriptor(
  kind: SymbolKind,
  nameNode: ts.Node,
  declaration: ts.Node
): SymbolDescriptor {
  return {
    kind,
    name: nameNode.getText(),
    nameNode,
    metadata: createModifierMetadata(declaration)
  };
}

/**
 * Returns whether a variable initializer behaves like a function declaration.
 */
function isFunctionLikeInitializer(initializer: ts.Expression | undefined): boolean {
  return Boolean(
    initializer &&
      (ts.isArrowFunction(initializer)
        || ts.isFunctionExpression(initializer)
        || findTypeScriptLikeWrappedComponentFunction(initializer))
  );
}

/**
 * Captures modifiers that affect API surface and class member visibility.
 */
function createModifierMetadata(node: ts.Node): Record<string, unknown> | undefined {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;

  if (!modifiers || modifiers.length === 0) {
    return undefined;
  }

  return {
    modifiers: modifiers.map((modifier) => ts.SyntaxKind[modifier.kind])
  };
}

/**
 * Converts a TypeScript node span into the shared SourceRange model.
 */
function getNodeRange(sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

  return {
    startLine: start.line,
    startCharacter: start.character,
    endLine: end.line,
    endCharacter: end.character
  };
}
