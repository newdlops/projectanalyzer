/**
 * JavaScript analyzer placeholder. This is separate from the TypeScript analyzer
 * so CommonJS, ESM, and JS-specific inference can evolve independently.
 */

import type { GraphEdge, SourceFile, SymbolNode } from "../../../shared/types";
import type { AnalysisContext, LanguageAnalyzer, ParsedFile } from "../../core/languageAnalyzer";

/** Language analyzer for `.js` and `.jsx` files. */
export class JavaScriptAnalyzer implements LanguageAnalyzer {
  public readonly languageId = "javascript";

  public readonly extensions = [".js", ".jsx"] as const;

  /**
   * Wraps the source file in an opaque parsed representation for now.
   */
  public async parse(file: SourceFile): Promise<ParsedFile> {
    return { file, ast: undefined };
  }

  /**
   * Extracts JavaScript symbols. Full extraction is planned for the analyzer milestone.
   */
  public async extractSymbols(_parsed: ParsedFile): Promise<SymbolNode[]> {
    return [];
  }

  /**
   * Extracts JavaScript relationship edges. Full extraction is planned for the analyzer milestone.
   */
  public async extractEdges(_parsed: ParsedFile, _context: AnalysisContext): Promise<GraphEdge[]> {
    return [];
  }
}
