/**
 * In-process Java graph analyzer. It supplements the file-only Rust path with
 * Lezer-backed type/callable symbols and conservative workspace direct calls.
 */

import type { SyntaxNode } from "@lezer/common";
import { createFileNodeId } from "../../core/graphNodes";
import type { AnalysisContext, LanguageAnalyzer, ParsedFile } from "../../core/languageAnalyzer";
import { createNodeId } from "../../../shared/ids";
import type {
  EdgeConfidence,
  GraphEdge,
  SourceFile,
  SourceRange,
  SymbolKind,
  SymbolNode
} from "../../../shared/types";
import {
  collectJavaCallables,
  collectJavaCalls,
  isJavaOwnerNode,
  parseJavaLezerSource,
  readJavaDefinitionName,
  type JavaCallableSyntax
} from "./javaLezerSyntax";
import {
  getLezerChildren,
  lezerNodeRange,
  lezerOffsetsRange,
  type LezerSource
} from "../../core/lezerSource";

/** Parsed-source cache entry keyed by immutable content hash. */
type JavaSourceCacheEntry = {
  contentHash: string;
  source: LezerSource;
};

/** Candidate callable retained for direct-call resolution. */
type JavaCallableRecord = {
  syntax: JavaCallableSyntax;
  node: SymbolNode;
};

/** Language analyzer for `.java` files. */
export class JavaAnalyzer implements LanguageAnalyzer {
  public readonly languageId = "java";

  public readonly extensions = [".java"] as const;

  /** Parser snapshots are reused while the shared pipeline extracts symbols and edges. */
  private readonly sourceCache = new Map<string, JavaSourceCacheEntry>();

  /** Workspace callable index is rebuilt only when a path/content hash changes. */
  private workspaceIndex?: { key: string; records: JavaCallableRecord[] };

  /** Parses Java with the same syntax tree used by Function Logic. */
  public async parse(file: SourceFile): Promise<ParsedFile> {
    return { file, ast: this.getSource(file) };
  }

  /** Extracts class/interface/enum, method, constructor, and named-lambda symbols. */
  public async extractSymbols(parsed: ParsedFile): Promise<SymbolNode[]> {
    return createJavaSymbols(parsed.file, asJavaSource(parsed.ast));
  }

  /** Extracts conservative calls using owner, arity, file, then workspace evidence. */
  public async extractEdges(
    parsed: ParsedFile,
    context: AnalysisContext
  ): Promise<GraphEdge[]> {
    const source = asJavaSource(parsed.ast);
    const records = this.getWorkspaceRecords(context.sourceFiles);
    const sourceRecords = records.filter((record) =>
      samePath(record.node.filePath, parsed.file.path)
    );
    const edges: GraphEdge[] = [];

    for (const caller of sourceRecords) {
      for (const call of collectJavaCalls(source, caller.syntax.body)) {
        const resolution = resolveJavaCall(caller, call, records);
        if (!resolution) {
          continue;
        }
        edges.push(createJavaCallEdge(
          caller.node,
          resolution.node,
          lezerNodeRange(source, call.node),
          resolution.confidence
        ));
      }
    }
    return edges;
  }

  /** Returns one immutable syntax snapshot, reparsing only when content changes. */
  private getSource(file: SourceFile): LezerSource {
    const cached = this.sourceCache.get(file.path);
    if (cached?.contentHash === file.contentHash) {
      return cached.source;
    }
    const source = parseJavaLezerSource(file.content);
    this.sourceCache.set(file.path, { contentHash: file.contentHash, source });
    return source;
  }

  /** Builds one bounded workspace index and reuses it for every file extraction pass. */
  private getWorkspaceRecords(files: readonly SourceFile[]): JavaCallableRecord[] {
    const javaFiles = files.filter((file) =>
      file.languageId === "java" || file.path.endsWith(".java")
    );
    const key = javaFiles
      .map((file) => `${file.path}\0${file.contentHash}`)
      .sort()
      .join("\0");
    if (this.workspaceIndex?.key === key) {
      return this.workspaceIndex.records;
    }
    const records = javaFiles.flatMap((file) =>
      createJavaCallableRecords(file, this.getSource(file))
    );
    this.workspaceIndex = { key, records };
    return records;
  }
}

/** Builds all source-backed Java symbols with lexical containment. */
function createJavaSymbols(file: SourceFile, source: LezerSource): SymbolNode[] {
  const fileId = createFileNodeId(file.path);
  const symbols: SymbolNode[] = [];
  const symbolByQualifiedName = new Map<string, SymbolNode>();
  const ownerNodes = collectJavaOwnerNodes(source);
  const callables = collectJavaCallables(source);
  const descriptors: Array<{
    kind: SymbolKind;
    name: string;
    qualifiedName: string;
    declaration: SyntaxNode;
    selectionFrom: number;
    selectionTo: number;
    metadata?: Record<string, unknown>;
  }> = [
    ...ownerNodes.map((node) => {
      const name = readJavaDefinitionName(source, node, "AnonymousType");
      const nameNode = getDirectJavaNameNode(node);
      const ownerNames = getJavaOwnerNames(source, node);
      return {
        kind: getJavaOwnerKind(node),
        name,
        qualifiedName: [...ownerNames, name].join("."),
        declaration: node,
        selectionFrom: nameNode?.from ?? node.from,
        selectionTo: nameNode?.to ?? node.from
      };
    }),
    ...callables.map((callable) => ({
      kind: callable.kind,
      name: callable.name,
      qualifiedName: callable.qualifiedName,
      declaration: callable.declarationNode,
      selectionFrom: callable.selectionFrom,
      selectionTo: callable.selectionTo,
      metadata: {
        parameterCount: callable.parameterCount,
        ...(callable.anonymous ? { anonymous: true } : {})
      }
    }))
  ].sort((left, right) =>
    left.qualifiedName.split(".").length - right.qualifiedName.split(".").length
    || left.declaration.from - right.declaration.from
  );

  for (const descriptor of descriptors) {
    const range = lezerNodeRange(source, descriptor.declaration);
    const selectionRange = lezerOffsetsRange(
      source,
      descriptor.selectionFrom,
      descriptor.selectionTo
    );
    const parentQualifiedName = descriptor.qualifiedName.split(".").slice(0, -1).join(".");
    const node: SymbolNode = {
      id: createJavaSymbolId(file.path, descriptor.kind, descriptor.qualifiedName, selectionRange),
      kind: descriptor.kind,
      name: descriptor.name,
      qualifiedName: descriptor.qualifiedName,
      filePath: file.path,
      range,
      selectionRange,
      language: "java",
      parentId: symbolByQualifiedName.get(parentQualifiedName)?.id ?? fileId,
      metadata: descriptor.metadata
    };
    symbols.push(node);
    symbolByQualifiedName.set(descriptor.qualifiedName, node);
  }
  return symbols;
}

/** Pairs callable syntax with its deterministic graph node. */
function createJavaCallableRecords(
  file: SourceFile,
  source: LezerSource
): JavaCallableRecord[] {
  const symbols = createJavaSymbols(file, source);
  const nodeBySelection = new Map(symbols
    .filter(isConcreteCallable)
    .map((node) => [rangeStartKey(node.selectionRange), node]));
  return collectJavaCallables(source).flatMap((syntax) => {
    const selection = lezerOffsetsRange(source, syntax.selectionFrom, syntax.selectionTo);
    const node = nodeBySelection.get(rangeStartKey(selection));
    return node ? [{ syntax, node }] : [];
  });
}

/** Resolves owner/qualified, same-file, then unique workspace Java calls. */
function resolveJavaCall(
  caller: JavaCallableRecord,
  call: ReturnType<typeof collectJavaCalls>[number],
  records: readonly JavaCallableRecord[]
): { node: SymbolNode; confidence: EdgeConfidence } | undefined {
  const candidates = records.filter((record) =>
    record.node.id !== caller.node.id
      && record.node.name === call.calleeName
      && matchesJavaArity(record, call.argumentCount)
  );
  if (call.constructor) {
    const constructors = records.filter((record) =>
      record.node.kind === "constructor"
        && record.node.qualifiedName.split(".").slice(-2, -1)[0] === call.calleeName
        && matchesJavaArity(record, call.argumentCount)
    );
    return constructors.length === 1
      ? { node: constructors[0].node, confidence: "resolved" }
      : undefined;
  }

  const ownerPrefix = caller.syntax.lexicalTypeOwner;
  if (!call.calleeText.includes(".") || call.calleeText.startsWith("this.")) {
    const owned = candidates.filter((record) =>
      record.node.qualifiedName === `${ownerPrefix}.${call.calleeName}`
    );
    if (owned.length === 1) {
      return { node: owned[0].node, confidence: "resolved" };
    }
  }
  if (call.calleeText.includes(".")) {
    const qualified = candidates.filter((record) =>
      record.node.qualifiedName.endsWith(call.calleeText)
    );
    if (qualified.length === 1) {
      return { node: qualified[0].node, confidence: "resolved" };
    }
  }
  const sameFile = candidates.filter((record) =>
    samePath(record.node.filePath, caller.node.filePath)
  );
  if (sameFile.length === 1) {
    return { node: sameFile[0].node, confidence: "inferred" };
  }
  return candidates.length === 1
    ? { node: candidates[0].node, confidence: "inferred" }
    : undefined;
}

/** Collects Java type owners without recursive tree traversal. */
function collectJavaOwnerNodes(source: LezerSource): SyntaxNode[] {
  const owners: SyntaxNode[] = [];
  const pending = getLezerChildren(source.tree.topNode).reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (isJavaOwnerNode(node)) {
      owners.push(node);
    }
    const children = getLezerChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return owners;
}

/** Reads lexical type/callable owners through a bounded parent loop. */
function getJavaOwnerNames(source: LezerSource, node: SyntaxNode): string[] {
  const names: string[] = [];
  let current = node.parent;
  while (current) {
    if (isJavaOwnerNode(current)) {
      names.push(readJavaDefinitionName(source, current, "AnonymousType"));
    } else if (current.name === "MethodDeclaration"
      || current.name === "ConstructorDeclaration") {
      const definition = getDirectJavaNameNode(current);
      if (definition) {
        names.push(source.text.slice(definition.from, definition.to));
      }
    }
    current = current.parent;
  }
  return names.reverse();
}

/** Finds the first direct/nested definition before a declaration parameter list. */
function getDirectJavaNameNode(node: SyntaxNode): SyntaxNode | undefined {
  return getLezerChildren(node).find((child) =>
    child.name === "Definition" || child.name === "Identifier"
  );
}

/** Maps Java type syntax onto the shared graph node vocabulary. */
function getJavaOwnerKind(node: SyntaxNode): SymbolKind {
  if (node.name === "InterfaceDeclaration" || node.name === "AnnotationTypeDeclaration") {
    return "interface";
  }
  if (node.name === "EnumDeclaration") {
    return "enum";
  }
  return "class";
}

/** Uses parser-known parameter counts as a conservative overload discriminator. */
function matchesJavaArity(record: JavaCallableRecord, argumentCount: number): boolean {
  return record.syntax.parameterCount === argumentCount;
}

/** Creates a ranged edge so repeated calls retain independent source evidence. */
function createJavaCallEdge(
  source: SymbolNode,
  target: SymbolNode,
  range: SourceRange,
  confidence: EdgeConfidence
): GraphEdge {
  return {
    id: createNodeId([
      "edge", "calls", source.id, target.id,
      String(range.startLine), String(range.startCharacter)
    ]),
    kind: "calls",
    sourceId: source.id,
    targetId: target.id,
    filePath: source.filePath,
    range,
    confidence
  };
}

/** Creates stable parser-independent Java symbol identity. */
function createJavaSymbolId(
  filePath: string,
  kind: SymbolKind,
  qualifiedName: string,
  selection: SourceRange
): string {
  return createNodeId([
    "symbol", filePath, kind, qualifiedName,
    String(selection.startLine), String(selection.startCharacter)
  ]);
}

/** Converts the opaque parsed AST into the shared Lezer source snapshot. */
function asJavaSource(ast: unknown): LezerSource {
  if (!ast || typeof ast !== "object" || !("tree" in ast) || !("text" in ast)) {
    throw new Error("Parsed AST is not a Java Lezer source snapshot.");
  }
  return ast as LezerSource;
}

/** Returns a compact source-position key. */
function rangeStartKey(range: SourceRange): string {
  return `${range.startLine}:${range.startCharacter}`;
}

/** Allows direct graph calls only between concrete callable symbols. */
function isConcreteCallable(node: SymbolNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Compares normalized analyzer paths across host platforms. */
function samePath(left: string, right: string): boolean {
  return left.replace(/\\/gu, "/") === right.replace(/\\/gu, "/");
}
