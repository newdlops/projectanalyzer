/**
 * TypeScript analyzer. It delegates compiler-API traversal to the shared
 * TypeScript-like extractor while preserving a TypeScript-specific plugin boundary.
 */

import * as ts from "typescript";
import type { GraphEdge, SymbolNode } from "../../../shared/types";
import type { AnalysisContext, LanguageAnalyzer, ParsedFile } from "../../core/languageAnalyzer";
import type { SourceFile } from "../../../shared/types";
import {
  extractTypeScriptLikeSymbols,
  parseTypeScriptLikeSource
} from "../typescriptLike/typescriptLikeSymbolExtractor";

/** Language analyzer for `.ts` and `.tsx` files. */
export class TypeScriptAnalyzer implements LanguageAnalyzer {
  public readonly languageId = "typescript";

  public readonly extensions = [".ts", ".tsx"] as const;

  /**
   * Parses TypeScript or TSX source using the TypeScript compiler API.
   */
  public async parse(file: SourceFile): Promise<ParsedFile> {
    const scriptKind = file.path.toLowerCase().endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    return {
      file,
      ast: parseTypeScriptLikeSource(file.path, file.content, { scriptKind })
    };
  }

  /**
   * Extracts TypeScript declarations into normalized graph nodes.
   */
  public async extractSymbols(parsed: ParsedFile): Promise<SymbolNode[]> {
    return extractTypeScriptLikeSymbols(parsed);
  }

  /**
   * Extracts TypeScript relationship edges. Full extraction is planned for the analyzer milestone.
   */
  public async extractEdges(_parsed: ParsedFile, _context: AnalysisContext): Promise<GraphEdge[]> {
    return [];
  }
}
