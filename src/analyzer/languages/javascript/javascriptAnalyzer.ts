/**
 * JavaScript analyzer. It uses the TypeScript compiler parser for JavaScript AST
 * support while keeping JavaScript-specific behavior isolated from TypeScript.
 */

import * as ts from "typescript";
import type { GraphEdge, SourceFile, SymbolNode } from "../../../shared/types";
import type { AnalysisContext, LanguageAnalyzer, ParsedFile } from "../../core/languageAnalyzer";
import {
  extractTypeScriptLikeSymbols,
  parseTypeScriptLikeSource
} from "../typescriptLike/typescriptLikeSymbolExtractor";

/** Language analyzer for `.js` and `.jsx` files. */
export class JavaScriptAnalyzer implements LanguageAnalyzer {
  public readonly languageId = "javascript";

  public readonly extensions = [".js", ".jsx"] as const;

  /**
   * Parses JavaScript or JSX source using the TypeScript compiler API.
   */
  public async parse(file: SourceFile): Promise<ParsedFile> {
    const scriptKind = file.path.toLowerCase().endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
    return {
      file,
      ast: parseTypeScriptLikeSource(file.path, file.content, { scriptKind })
    };
  }

  /**
   * Extracts JavaScript declarations into normalized graph nodes.
   */
  public async extractSymbols(parsed: ParsedFile): Promise<SymbolNode[]> {
    return extractTypeScriptLikeSymbols(parsed);
  }

  /**
   * Extracts JavaScript relationship edges. Full extraction is planned for the analyzer milestone.
   */
  public async extractEdges(_parsed: ParsedFile, _context: AnalysisContext): Promise<GraphEdge[]> {
    return [];
  }
}
