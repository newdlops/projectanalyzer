/**
 * Python analyzer placeholder. The module keeps Python parsing and import
 * resolution isolated from TypeScript/JavaScript analyzer choices.
 */

import type { GraphEdge, SourceFile, SymbolNode } from "../../../shared/types";
import type { AnalysisContext, LanguageAnalyzer, ParsedFile } from "../../core/languageAnalyzer";

/** Language analyzer for `.py` files. */
export class PythonAnalyzer implements LanguageAnalyzer {
  public readonly languageId = "python";

  public readonly extensions = [".py"] as const;

  /**
   * Wraps the source file in an opaque parsed representation for now.
   */
  public async parse(file: SourceFile): Promise<ParsedFile> {
    return { file, ast: undefined };
  }

  /**
   * Extracts Python symbols. Full extraction is planned for the analyzer milestone.
   */
  public async extractSymbols(_parsed: ParsedFile): Promise<SymbolNode[]> {
    return [];
  }

  /**
   * Extracts Python relationship edges. Full extraction is planned for the analyzer milestone.
   */
  public async extractEdges(_parsed: ParsedFile, _context: AnalysisContext): Promise<GraphEdge[]> {
    return [];
  }
}
