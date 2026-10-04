/** Source-backed Kotlin graph adapter with lexical symbols and conservative direct-call targets. */
import * as path from "node:path";
import { createFileNodeId } from "../../core/graphNodes";
import type { AnalysisContext, LanguageAnalyzer, ParsedFile } from "../../core/languageAnalyzer";
import { createContentHash } from "../../../shared/hash";
import { createNodeId } from "../../../shared/ids";
import type { GraphEdge, SourceFile, SourceRange, SymbolNode } from "../../../shared/types";
import {
  collectKotlinCalls, collectKotlinFunctionDeclarations, collectKotlinOwners, isKotlinNestedScope
} from "./kotlinSyntaxFacts";
import { parseKotlinSource } from "./kotlinSyntaxSource";
import { findKotlinDescendants, getKotlinChildNamed, kotlinNodeRange, kotlinNodeText, kotlinOffsetsRange } from "./kotlinSyntaxTree";
import type { KotlinCallSyntax, KotlinFunctionDeclarationSyntax, KotlinSource } from "./kotlinSyntaxTypes";

type ImportFact = { path: string; alias?: string; wildcard: boolean };
type FileFacts = { packageName: string; imports: ImportFact[] };
/** The workspace index retains value facts only, never source snapshots or parser tree nodes. */
type CallableRecord = {
  node: SymbolNode; from: number; to: number; parentScope: string; lexicalTypeOwner: string;
  /** Original UTF-16 block bounds constrain local visibility independently of graph ownership. */
  scopeFrom: number; scopeTo: number;
  /** Value-binding names remain primitive facts for captured-callable shadowing checks. */
  shadowedNames: ReadonlySet<string>;
  receiverType?: string; minArity: number; maxArity: number; private: boolean; fileFacts: FileFacts;
};

/** Adds Kotlin declaration/call symbols to the existing in-process supplemental graph pipeline. */
export class KotlinAnalyzer implements LanguageAnalyzer {
  public readonly languageId = "kotlin";
  public readonly extensions = [".kt", ".kts"] as const;
  private workspaceIndex?: { key: string; records: CallableRecord[] };

  /** Shares dirty/content snapshots with synchronous cursor, Logic, and Tutor parsing. */
  public async parse(file: SourceFile): Promise<ParsedFile> {
    return { file, ast: parseKotlinSource(file.content, file.path) };
  }

  /** Extracts lexical classes, objects, interfaces, and named function declarations. */
  public async extractSymbols(parsed: ParsedFile): Promise<SymbolNode[]> {
    return createKotlinSymbols(parsed.file, asKotlinSource(parsed.ast));
  }

  /** Resolves source-local or explicitly imported targets and leaves ambiguous receivers unresolved. */
  public async extractEdges(parsed: ParsedFile, context: AnalysisContext): Promise<GraphEdge[]> {
    const source = asKotlinSource(parsed.ast);
    // Error-recovered syntax remains useful for source navigation. Call targets
    // from invalid grammar are not promoted into reliable project relations.
    if (source.diagnostics.length > 0) return [];
    const records = this.getWorkspaceRecords(context.sourceFiles);
    const sourceRecords = records.filter((record) => samePath(record.node.filePath, parsed.file.path));
    const bySelection = new Map(sourceRecords.map((record) => [selectionKey(record.node.selectionRange), record]));
    const edges: GraphEdge[] = [];
    for (const syntax of collectKotlinFunctionDeclarations(source)) {
      if (!syntax.body) continue;
      const caller = bySelection.get(selectionKey(kotlinOffsetsRange(source, syntax.selectionFrom, syntax.selectionTo)));
      if (!caller) continue;
      for (const call of collectKotlinCalls(source, syntax.body)) {
        const target = resolveKotlinCall(caller, call, records);
        if (target) edges.push(createCallEdge(caller.node, target.node, kotlinNodeRange(source, call.node)));
      }
    }
    return edges;
  }

  /** Drops workspace value indices; shared syntax lifecycle is owned by the extension composition root. */
  public dispose(): void {
    this.workspaceIndex = undefined;
  }

  /** Rebuilds the workspace signature index only when source path/content identities change. */
  private getWorkspaceRecords(files: readonly SourceFile[]): CallableRecord[] {
    const kotlinFiles = files.filter((file) => file.languageId === "kotlin" || /\.kts?$/iu.test(file.path));
    const key = createContentHash(kotlinFiles.map((file) => `${file.path}\0${file.contentHash}`).sort().join("\0"));
    if (this.workspaceIndex?.key === key) return this.workspaceIndex.records;
    const records = kotlinFiles.flatMap((file) => createCallableRecords(file, parseKotlinSource(file.content, file.path)));
    this.workspaceIndex = { key, records };
    return records;
  }
}

/** Creates symbols in source order, preserving parent identity even for overloaded scopes. */
function createKotlinSymbols(file: SourceFile, source: KotlinSource): SymbolNode[] {
  const descriptors = [
    ...collectKotlinOwners(source).map((owner) => ({ ...owner, metadata: { kotlinOwner: true } })),
    ...collectKotlinFunctionDeclarations(source).map((syntax) => ({
      ...syntax, metadata: { parameterCount: syntax.parameterCount, suspend: syntax.suspend,
        ...(syntax.receiverType ? { receiverType: syntax.receiverType } : {}),
        ...(!syntax.body ? { abstract: true } : {}) }
    }))
  ].sort((left, right) => left.node.from - right.node.from || right.node.to - left.node.to);
  const symbols: SymbolNode[] = [];
  const scopeStack: Array<{ from: number; to: number; symbol: SymbolNode }> = [];
  for (const descriptor of descriptors) {
    while (scopeStack.length > 0 && (descriptor.node.from < scopeStack[scopeStack.length - 1].from
      || descriptor.node.to > scopeStack[scopeStack.length - 1].to
      || descriptor.node.from >= scopeStack[scopeStack.length - 1].to)) scopeStack.pop();
    const selectionRange = kotlinOffsetsRange(source, descriptor.selectionFrom, descriptor.selectionTo);
    const symbol: SymbolNode = {
      id: symbolId(file.path, descriptor.kind, descriptor.qualifiedName, selectionRange),
      kind: descriptor.kind, name: descriptor.name, qualifiedName: descriptor.qualifiedName,
      filePath: file.path, range: kotlinNodeRange(source, descriptor.node), selectionRange,
      language: "kotlin", parentId: scopeStack.at(-1)?.symbol.id ?? createFileNodeId(file.path),
      metadata: { ...descriptor.metadata,
        ...(source.diagnostics.length ? { partial: true, kotlinDiagnosticCount: source.diagnostics.length } : {}) }
    };
    symbols.push(symbol);
    scopeStack.push({ from: descriptor.node.from, to: descriptor.node.to, symbol });
  }
  return symbols;
}

/** Copies callable signatures into primitive workspace facts, releasing tree references afterward. */
function createCallableRecords(file: SourceFile, source: KotlinSource): CallableRecord[] {
  if (source.diagnostics.length > 0) return [];
  const symbols = createKotlinSymbols(file, source);
  const bySelection = new Map(symbols.filter((node) => node.kind === "function" || node.kind === "method")
    .map((node) => [selectionKey(node.selectionRange), node]));
  const fileFacts = collectFileFacts(source);
  return collectKotlinFunctionDeclarations(source).flatMap((syntax) => {
    const node = bySelection.get(selectionKey(kotlinOffsetsRange(source, syntax.selectionFrom, syntax.selectionTo)));
    if (!node) return [];
    const segment = syntax.receiverType ? `${syntax.receiverType}.${syntax.name}` : syntax.name;
    const parentScope = syntax.qualifiedName.slice(0, Math.max(0, syntax.qualifiedName.length - segment.length - 1));
    const modifiers = getKotlinChildNamed(syntax.node, "modifiers");
    return [{ node, from: syntax.node.from, to: syntax.node.to, parentScope,
      scopeFrom: syntax.lexicalScope?.from ?? source.root.from,
      scopeTo: syntax.lexicalScope?.to ?? source.root.to,
      shadowedNames: collectShadowedNames(source, syntax),
      lexicalTypeOwner: syntax.lexicalTypeOwner, receiverType: syntax.receiverType,
      minArity: syntax.parameters.filter((parameter) => parameter.defaultText === undefined && !parameter.vararg).length,
      maxArity: syntax.parameters.some((parameter) => parameter.vararg) ? Number.POSITIVE_INFINITY : syntax.parameterCount,
      private: modifiers ? findKotlinDescendants(modifiers, (child) => child.name === "PRIVATE").length > 0 : false,
      fileFacts }];
  });
}

/** Resolves only unique compatible lexical candidates, preserving overload ambiguity. */
function resolveKotlinCall(caller: CallableRecord, call: KotlinCallSyntax,
  records: readonly CallableRecord[]): CallableRecord | undefined {
  const simple = call.calleeText === call.calleeName || call.calleeText === `\`${call.calleeName}\``;
  const thisCall = call.calleeText === `this.${call.calleeName}`;
  if (!simple && !thisCall) return undefined;
  const candidates = records.filter((record) => (record.node.name === call.calleeName
    || caller.fileFacts.imports.some((item) => matchesImport(record, item, call.calleeName))) && !record.receiverType
    && record.minArity <= call.argumentCount && record.maxArity >= call.argumentCount);
  const scopes: CallableRecord[] = [];
  const visited = new Set<string>();
  let scopeRecord: CallableRecord | undefined = caller;
  let hasExtensionReceiver = false;
  while (scopeRecord && !visited.has(scopeRecord.node.id) && visited.size < 128) {
    visited.add(scopeRecord.node.id);
    scopes.push(scopeRecord);
    hasExtensionReceiver ||= Boolean(scopeRecord.receiverType);
    const parentId: string | undefined = scopeRecord.node.parentId;
    scopeRecord = records.find((record) => record.node.id === parentId);
  }
  if (simple) {
    // Search the callable's nested local scope, then enclosing callable scopes.
    // Parent identity prevents sibling-overload leakage; block bounds prevent
    // sibling branches and completed inner scopes from exporting local names.
    for (const scope of scopes) {
      // A nested function can capture a parameter/value from an enclosing
      // callable. Preserve that uncertainty before looking beyond its scope.
      if (scope.shadowedNames.has(call.calleeName)) return undefined;
      const local = candidates.filter((record) => samePath(record.node.filePath, caller.node.filePath)
        && record.node.name === call.calleeName && record.node.parentId === scope.node.id && record.from <= call.node.from
        && record.scopeFrom <= call.node.from && call.node.to <= record.scopeTo);
      if (local.length > 0) {
        // Nested blocks shadow enclosing blocks. Only an overload family in
        // the same innermost visible block remains ambiguous.
        const smallestScope = local.reduce((span, record) => Math.min(span, record.scopeTo - record.scopeFrom), Infinity);
        return unique(local.filter((record) => record.scopeTo - record.scopeFrom === smallestScope));
      }
    }
  }
  // Plain this denotes the extension receiver, and implicit calls can search
  // that receiver before Host members. A nested local inherits that receiver
  // context. Keep dispatch unresolved without type evidence after allowing
  // the proven lexical local-function candidates above.
  if (hasExtensionReceiver) return undefined;
  if (caller.lexicalTypeOwner) {
    const members = candidates.filter((record) => samePath(record.node.filePath, caller.node.filePath)
      && record.parentScope === caller.lexicalTypeOwner);
    if (members.length > 0 || thisCall) return unique(members);
  } else if (thisCall) return undefined;
  const sameFile = candidates.filter((record) => samePath(record.node.filePath, caller.node.filePath)
    && record.parentScope === "");
  if (sameFile.length > 0) return unique(sameFile);
  const imported = candidates.filter((record) => record.parentScope === "" && !record.private
    && caller.fileFacts.imports.some((item) => matchesImport(record, item, call.calleeName)));
  if (imported.length > 0) return unique(imported);
  return unique(candidates.filter((record) => record.parentScope === "" && !record.private
    && record.fileFacts.packageName === caller.fileFacts.packageName));
}

/** Matches source import aliases explicitly instead of treating their names as runtime receivers. */
function matchesImport(record: CallableRecord, item: ImportFact, calleeName: string): boolean {
  if (record.parentScope !== "") return false;
  if (item.wildcard) return item.path === record.fileFacts.packageName && record.node.name === calleeName;
  const qualified = `${record.fileFacts.packageName ? `${record.fileFacts.packageName}.` : ""}${record.node.name}`;
  return item.path === qualified && (item.alias ?? record.node.name) === calleeName;
}

/** Captures parameters and local values that may shadow a statically named function. */
function collectShadowedNames(source: KotlinSource, syntax: KotlinFunctionDeclarationSyntax): ReadonlySet<string> {
  const names = new Set(syntax.parameters.map((parameter) => parameter.name));
  if (!syntax.body) return names;
  for (const declaration of findKotlinDescendants(syntax.body, (node) => node.name === "variableDeclaration", isKotlinNestedScope)) {
    const name = getKotlinChildNamed(declaration, "simpleIdentifier");
    if (name) names.add(kotlinNodeText(source, name).replace(/^`|`$/gu, ""));
  }
  return names;
}

/** Reads package/import grammar facts without interpreting receiver/type semantics. */
function collectFileFacts(source: KotlinSource): FileFacts {
  const packageHeader = getKotlinChildNamed(source.root, "packageHeader");
  const packageNode = packageHeader && getKotlinChildNamed(packageHeader, "identifier");
  const imports = getKotlinChildNamed(source.root, "importList");
  return { packageName: packageNode ? compactIdentifier(source, packageNode) : "",
    imports: (imports?.children.filter((node) => node.name === "importHeader") ?? []).flatMap((node) => {
      const identifier = getKotlinChildNamed(node, "identifier");
      if (!identifier) return [];
      const aliasNode = getKotlinChildNamed(node, "importAlias");
      const alias = aliasNode && getKotlinChildNamed(aliasNode, "simpleIdentifier");
      return [{ path: compactIdentifier(source, identifier),
        ...(alias ? { alias: compactIdentifier(source, alias) } : {}), wildcard: Boolean(getKotlinChildNamed(node, "MULT")) }];
    }) };
}

/** Keeps package names canonical while preserving source grammar as the authority. */
function compactIdentifier(source: KotlinSource, node: Parameters<typeof kotlinNodeText>[1]): string {
  return kotlinNodeText(source, node).replace(/\s+|`/gu, "");
}

/** Static lexical target certainty is distinct from exact runtime dispatch/execution. */
function createCallEdge(source: SymbolNode, target: SymbolNode, range: SourceRange): GraphEdge {
  return { id: createNodeId(["edge", "calls", source.id, target.id, String(range.startLine),
    String(range.startCharacter), String(range.endLine), String(range.endCharacter)]),
    kind: "calls", sourceId: source.id, targetId: target.id, filePath: source.filePath,
    range, confidence: "resolved", metadata: { lexical: true } };
}

/** Matches graph/cursor symbol identity conventions used by the other language adapters. */
function symbolId(filePath: string, kind: string, qualifiedName: string, range: SourceRange): string {
  return createNodeId(["symbol", filePath, kind, qualifiedName, String(range.startLine), String(range.startCharacter)]);
}

/** Validates the opaque analyzer AST at its module boundary. */
function asKotlinSource(ast: unknown): KotlinSource {
  if (!ast || typeof ast !== "object" || !("root" in ast) || !("text" in ast) || !("diagnostics" in ast)) {
    throw new Error("Parsed AST is not a Kotlin source snapshot.");
  }
  return ast as KotlinSource;
}

/** Keeps selection keys compact while preserving overloads at different declarations. */
function selectionKey(range: SourceRange): string { return `${range.startLine}:${range.startCharacter}`; }

/** Returns a target only if the complete lexical candidate set contains exactly one entry. */
function unique(records: readonly CallableRecord[]): CallableRecord | undefined { return records.length === 1 ? records[0] : undefined; }

/** Compares normalized workspace paths without filesystem access. */
function samePath(left: string, right: string): boolean { return path.resolve(left) === path.resolve(right); }
