/**
 * In-process Python graph analyzer. Lezer syntax supplies fallback symbols and
 * direct calls when the primary Rust engine is unavailable.
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
  SymbolNode
} from "../../../shared/types";
import {
  collectPythonCallables,
  collectPythonCalls,
  parsePythonLezerSource,
  type PythonCallableSyntax
} from "./pythonLezerSyntax";
import {
  getLezerChildNamed,
  getLezerChildren,
  lezerNodeRange,
  lezerOffsetsRange,
  type LezerSource
} from "../../core/lezerSource";

/** Parsed-source cache entry keyed by immutable content hash. */
type PythonSourceCacheEntry = {
  contentHash: string;
  source: LezerSource;
};

/** Candidate callable retained for direct-call resolution. */
type PythonCallableRecord = {
  syntax: PythonCallableSyntax;
  node: SymbolNode;
};

/** Language analyzer for `.py` files. */
export class PythonAnalyzer implements LanguageAnalyzer {
  public readonly languageId = "python";

  public readonly extensions = [".py"] as const;

  /** Parser snapshots are reused while the shared pipeline extracts symbols and edges. */
  private readonly sourceCache = new Map<string, PythonSourceCacheEntry>();

  /** Workspace callable index is rebuilt only when a path/content hash changes. */
  private workspaceIndex?: { key: string; records: PythonCallableRecord[] };

  /** Parses Python with the same syntax tree used by Function Logic. */
  public async parse(file: SourceFile): Promise<ParsedFile> {
    const source = this.getSource(file);
    return { file, ast: source };
  }

  /** Extracts class, function, method, constructor, and named-lambda symbols. */
  public async extractSymbols(parsed: ParsedFile): Promise<SymbolNode[]> {
    return createPythonSymbols(parsed.file, asPythonSource(parsed.ast));
  }

  /** Extracts conservative direct calls against a workspace-wide Python index. */
  public async extractEdges(
    parsed: ParsedFile,
    context: AnalysisContext
  ): Promise<GraphEdge[]> {
    const source = asPythonSource(parsed.ast);
    const workspaceRecords = this.getWorkspaceRecords(context.sourceFiles);
    const sourceRecords = workspaceRecords.filter((record) =>
      samePath(record.node.filePath, parsed.file.path)
    );
    const edges: GraphEdge[] = [];

    for (const caller of sourceRecords) {
      for (const call of collectPythonCalls(source, caller.syntax.body)) {
        const resolution = resolvePythonCall(caller, call, workspaceRecords);
        if (!resolution) {
          continue;
        }
        const range = lezerNodeRange(source, call.node);
        edges.push(createPythonCallEdge(
          caller.node,
          resolution.node,
          range,
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
    const source = parsePythonLezerSource(file.content);
    this.sourceCache.set(file.path, { contentHash: file.contentHash, source });
    return source;
  }

  /** Builds one workspace index and reuses it for every file extraction pass. */
  private getWorkspaceRecords(files: readonly SourceFile[]): PythonCallableRecord[] {
    const pythonFiles = files.filter((file) =>
      file.languageId === "python" || file.path.endsWith(".py")
    );
    const key = pythonFiles
      .map((file) => `${file.path}\0${file.contentHash}`)
      .sort()
      .join("\0");
    if (this.workspaceIndex?.key === key) {
      return this.workspaceIndex.records;
    }
    const records = pythonFiles.flatMap((file) =>
      createPythonCallableRecords(file, this.getSource(file))
    );
    this.workspaceIndex = { key, records };
    return records;
  }
}

/** Builds all source-backed Python symbols with lexical containment. */
function createPythonSymbols(file: SourceFile, source: LezerSource): SymbolNode[] {
  const fileId = createFileNodeId(file.path);
  const symbols: SymbolNode[] = [];
  const symbolByQualifiedName = new Map<string, SymbolNode>();
  const classNodes = collectPythonClassNodes(source);
  const callables = collectPythonCallables(source);
  const descriptors: Array<{
    kind: SymbolNode["kind"];
    name: string;
    qualifiedName: string;
    declaration: SyntaxNode;
    selectionFrom: number;
    selectionTo: number;
    anonymous?: boolean;
  }> = [
    ...classNodes.map((node) => {
      const nameNode = getLezerChildNamed(node, "VariableName");
      const name = nameNode ? source.text.slice(nameNode.from, nameNode.to) : "anonymous class";
      const ownerNames = getPythonOwnerNames(source, node);
      return {
        kind: "class" as const,
        name,
        qualifiedName: [...ownerNames, name].join("."),
        declaration: node.parent?.name === "DecoratedStatement" ? node.parent : node,
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
      anonymous: callable.anonymous
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
      id: createPythonSymbolId(file.path, descriptor.kind, descriptor.qualifiedName, selectionRange),
      kind: descriptor.kind,
      name: descriptor.name,
      qualifiedName: descriptor.qualifiedName,
      filePath: file.path,
      range,
      selectionRange,
      language: "python",
      parentId: symbolByQualifiedName.get(parentQualifiedName)?.id ?? fileId,
      metadata: descriptor.anonymous ? { anonymous: true } : undefined
    };
    symbols.push(node);
    symbolByQualifiedName.set(descriptor.qualifiedName, node);
  }
  return symbols;
}

/** Pairs callable syntax with its deterministic graph node. */
function createPythonCallableRecords(
  file: SourceFile,
  source: LezerSource
): PythonCallableRecord[] {
  const symbols = createPythonSymbols(file, source);
  const nodeBySelection = new Map(symbols
    .filter(isConcreteCallable)
    .map((node) => [rangeStartKey(node.selectionRange), node]));
  return collectPythonCallables(source).flatMap((syntax) => {
    const selection = lezerOffsetsRange(source, syntax.selectionFrom, syntax.selectionTo);
    const node = nodeBySelection.get(rangeStartKey(selection));
    return node ? [{ syntax, node }] : [];
  });
}

/** Resolves self/member, same-file, then unique workspace Python calls. */
function resolvePythonCall(
  caller: PythonCallableRecord,
  call: ReturnType<typeof collectPythonCalls>[number],
  records: readonly PythonCallableRecord[]
): { node: SymbolNode; confidence: EdgeConfidence } | undefined {
  const candidates = records.filter((record) => record.node.id !== caller.node.id);
  const ownerPrefix = caller.syntax.lexicalClassOwner;
  if (call.calleeText.startsWith("self.") && ownerPrefix) {
    const owned = candidates.filter((record) =>
      record.node.qualifiedName === `${ownerPrefix}.${call.calleeName}`
    );
    if (owned.length === 1) {
      return { node: owned[0].node, confidence: "resolved" };
    }
  }
  const constructor = candidates.filter((record) =>
    record.node.kind === "constructor"
      && record.node.qualifiedName.split(".").slice(-2, -1)[0] === call.calleeName
  );
  if (constructor.length === 1) {
    return { node: constructor[0].node, confidence: "inferred" };
  }
  const sameFile = candidates.filter((record) =>
    samePath(record.node.filePath, caller.node.filePath)
      && record.node.name === call.calleeName
  );
  if (sameFile.length === 1) {
    return { node: sameFile[0].node, confidence: "inferred" };
  }
  const workspace = candidates.filter((record) => record.node.name === call.calleeName);
  return workspace.length === 1
    ? { node: workspace[0].node, confidence: "inferred" }
    : undefined;
}

/** Collects class definitions without descending recursively. */
function collectPythonClassNodes(source: LezerSource): SyntaxNode[] {
  const classes: SyntaxNode[] = [];
  const pending = getLezerChildren(source.tree.topNode).reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (node.name === "ClassDefinition") {
      classes.push(node);
    }
    const children = getLezerChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return classes;
}

/** Reads lexical class/function owners through a bounded parent loop. */
function getPythonOwnerNames(source: LezerSource, node: SyntaxNode): string[] {
  const names: string[] = [];
  let current = node.parent;
  while (current) {
    if (current.name === "ClassDefinition" || current.name === "FunctionDefinition") {
      const nameNode = getLezerChildNamed(current, "VariableName");
      if (nameNode) {
        names.push(source.text.slice(nameNode.from, nameNode.to));
      }
    }
    current = current.parent;
  }
  return names.reverse();
}

/** Creates a ranged edge so repeated calls retain independent source evidence. */
function createPythonCallEdge(
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

/** Creates stable parser-independent Python symbol identity. */
function createPythonSymbolId(
  filePath: string,
  kind: SymbolNode["kind"],
  qualifiedName: string,
  selection: SourceRange
): string {
  return createNodeId([
    "symbol", filePath, kind, qualifiedName,
    String(selection.startLine), String(selection.startCharacter)
  ]);
}

/** Converts the opaque parsed AST into the shared Lezer source snapshot. */
function asPythonSource(ast: unknown): LezerSource {
  if (!ast || typeof ast !== "object" || !("tree" in ast) || !("text" in ast)) {
    throw new Error("Parsed AST is not a Python Lezer source snapshot.");
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
