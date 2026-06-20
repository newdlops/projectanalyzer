/**
 * TypeScript compiler API based import edge extraction shared by TypeScript and
 * JavaScript analyzers. It resolves project-local relative imports to file nodes.
 */

import * as path from "node:path";
import * as ts from "typescript";
import { createFileNodeId } from "../../core/graphNodes";
import type { AnalysisContext, ParsedFile } from "../../core/languageAnalyzer";
import { createEdgeId } from "../../../shared/ids";
import type { EdgeKind, GraphEdge, SourceRange } from "../../../shared/types";

/** File extensions checked when an import omits the concrete suffix. */
const RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

/**
 * Extracts project-local file-to-file import/export edges from a parsed source.
 */
export function extractTypeScriptLikeImportEdges(
  parsed: ParsedFile,
  context: AnalysisContext
): GraphEdge[] {
  const sourceFile = asTypeScriptSourceFile(parsed.ast);
  const sourceId = createFileNodeId(parsed.file.path);
  const sourceFileByPath = createSourceFilePathMap(context.sourceFiles);
  const edges: GraphEdge[] = [];

  sourceFile.forEachChild((node) => {
    const importEdge = createModuleEdge(node, "imports", parsed.file.path, sourceId, sourceFile, sourceFileByPath);
    const exportEdge = createModuleEdge(node, "exports", parsed.file.path, sourceId, sourceFile, sourceFileByPath);

    if (importEdge) {
      edges.push(importEdge);
    }

    if (exportEdge) {
      edges.push(exportEdge);
    }
  });

  return edges;
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
 * Creates a lookup from normalized absolute file path to original source file.
 */
function createSourceFilePathMap(sourceFiles: readonly { path: string }[]): Map<string, string> {
  return new Map(sourceFiles.map((file) => [normalizeFilePath(file.path), file.path]));
}

/**
 * Creates one graph edge for an import/export declaration with a local target.
 */
function createModuleEdge(
  node: ts.Node,
  kind: EdgeKind,
  sourceFilePath: string,
  sourceId: string,
  sourceFile: ts.SourceFile,
  sourceFileByPath: ReadonlyMap<string, string>
): GraphEdge | undefined {
  const moduleSpecifier = getModuleSpecifier(node, kind);

  if (!moduleSpecifier || !moduleSpecifier.text.startsWith(".")) {
    return undefined;
  }

  const targetFilePath = resolveLocalModulePath(sourceFilePath, moduleSpecifier.text, sourceFileByPath);

  if (!targetFilePath || targetFilePath === sourceFilePath) {
    return undefined;
  }

  const targetId = createFileNodeId(targetFilePath);

  return {
    id: createEdgeId(kind, sourceId, targetId),
    kind,
    sourceId,
    targetId,
    filePath: sourceFilePath,
    range: getNodeRange(sourceFile, moduleSpecifier),
    confidence: "resolved",
    metadata: {
      moduleSpecifier: moduleSpecifier.text
    }
  };
}

/**
 * Returns the string literal module specifier for import/export declarations.
 */
function getModuleSpecifier(node: ts.Node, kind: EdgeKind): ts.StringLiteral | undefined {
  if (kind === "imports" && ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier;
  }

  if (
    kind === "exports" &&
    ts.isExportDeclaration(node) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier;
  }

  return undefined;
}

/**
 * Resolves a relative module specifier to a project source file.
 */
function resolveLocalModulePath(
  sourceFilePath: string,
  moduleSpecifier: string,
  sourceFileByPath: ReadonlyMap<string, string>
): string | undefined {
  const basePath = path.resolve(path.dirname(sourceFilePath), moduleSpecifier);
  const candidates = createResolutionCandidates(basePath);

  for (const candidate of candidates) {
    const resolved = sourceFileByPath.get(normalizeFilePath(candidate));

    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

/**
 * Builds common TS/JS module resolution candidates without reading the file system.
 */
function createResolutionCandidates(basePath: string): string[] {
  const extension = path.extname(basePath);

  if (extension) {
    return [basePath];
  }

  return [
    ...RESOLVABLE_EXTENSIONS.map((extensionValue) => `${basePath}${extensionValue}`),
    ...RESOLVABLE_EXTENSIONS.map((extensionValue) => path.join(basePath, `index${extensionValue}`))
  ];
}

/**
 * Converts a node span into a zero-based source range.
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

/**
 * Normalizes paths for stable matching across platform-specific separators.
 */
function normalizeFilePath(filePath: string): string {
  return path.resolve(filePath);
}
