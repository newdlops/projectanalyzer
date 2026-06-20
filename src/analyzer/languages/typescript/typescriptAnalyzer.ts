/**
 * TypeScript analyzer placeholder. The module establishes the language plugin
 * boundary before TypeScript compiler API integration is implemented.
 */

import type { GraphEdge, SymbolNode } from "../../../shared/types";
import type { AnalysisContext, LanguageAnalyzer, ParsedFile } from "../../core/languageAnalyzer";
import type { SourceFile } from "../../../shared/types";

/** Language analyzer for `.ts` and `.tsx` files. */
export class TypeScriptAnalyzer implements LanguageAnalyzer {
  public readonly languageId = "typescript";

  public readonly extensions = [".ts", ".tsx"] as const;

  /**
   * Wraps the source file in an opaque parsed representation for now.
   */
  public async parse(file: SourceFile): Promise<ParsedFile> {
    return { file, ast: undefined };
  }

  /**
   * Extracts TypeScript symbols. Full extraction is planned for the analyzer milestone.
   */
  public async extractSymbols(_parsed: ParsedFile): Promise<SymbolNode[]> {
    return [];
  }

  /**
   * Extracts TypeScript relationship edges. Full extraction is planned for the analyzer milestone.
   */
  public async extractEdges(_parsed: ParsedFile, _context: AnalysisContext): Promise<GraphEdge[]> {
    return [];
  }
}
