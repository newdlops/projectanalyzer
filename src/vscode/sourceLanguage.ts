/**
 * Pure source-language selection for saved files and open documents without a registered editor language.
 * Keeping this independent from the VS Code API makes transient file reads
 * testable without constructing TextDocument objects.
 */

/** Analyzer-supported VS Code language IDs keyed by lowercase extension. */
const SOURCE_LANGUAGE_BY_EXTENSION = new Map<string, string>([
  [".ts", "typescript"],
  [".tsx", "typescriptreact"],
  [".js", "javascript"],
  [".jsx", "javascriptreact"],
  [".py", "python"],
  [".java", "java"],
  [".kt", "kotlin"],
  [".kts", "kotlin"],
  [".fs", "fsharp"],
  [".fsx", "fsharp"],
  [".ml", "ocaml"],
  [".mli", "ocaml"],
  [".ex", "elixir"],
  [".exs", "elixir"]
]);

/** Infers the supported language without opening a persistent VS Code document. */
export function inferSourceLanguageId(filePath: string): string {
  const normalized = filePath.toLowerCase();
  const extensionIndex = normalized.lastIndexOf(".");
  const extension = extensionIndex >= 0 ? normalized.slice(extensionIndex) : "";
  return SOURCE_LANGUAGE_BY_EXTENSION.get(extension) ?? "plaintext";
}

/** Preserve explicit editor modes; Plain Text must not disable a supported filename's analyzer or drop unsaved Kotlin symbols. */
export function resolveSourceLanguageId(filePath: string, editorLanguageId: string): string {
  return editorLanguageId === "plaintext" ? inferSourceLanguageId(filePath) : editorLanguageId;
}
