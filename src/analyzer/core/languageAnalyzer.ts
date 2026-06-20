/**
 * Language analyzer contracts. Each concrete analyzer owns parser-specific
 * behavior while the core pipeline coordinates scanning, caching, and graph merge.
 */

import type { GraphEdge, SourceFile, SymbolNode } from "../../shared/types";

/** Parsed representation is intentionally opaque outside each language plugin. */
export type ParsedFile = {
  file: SourceFile;
  ast: unknown;
};

/** Context shared with language analyzers during edge extraction. */
export type AnalysisContext = {
  sourceFiles: readonly SourceFile[];
  workspaceRoot: string;
};

/** Common interface implemented by TypeScript, JavaScript, Python, and future analyzers. */
export interface LanguageAnalyzer {
  languageId: string;
  extensions: readonly string[];
  parse(file: SourceFile): Promise<ParsedFile>;
  extractSymbols(parsed: ParsedFile): Promise<SymbolNode[]>;
  extractEdges(parsed: ParsedFile, context: AnalysisContext): Promise<GraphEdge[]>;
  resolveReferences?(context: AnalysisContext): Promise<GraphEdge[]>;
}
