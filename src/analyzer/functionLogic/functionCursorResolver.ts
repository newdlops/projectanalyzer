/**
 * Public language-dispatching cursor resolver. Parser-specific implementations
 * remain isolated while editor commands consume one stable function contract.
 */

import type { FunctionCursorTarget, FunctionCursorTargetInput } from "./types";
import { findJavaFunctionAtPosition } from "./languages/java/javaFunctionCursorResolver";
import { findFunctionalFunctionAtPosition } from "./languages/functional/functionalFunctionCursorResolver";
import { findPythonFunctionAtPosition } from "./languages/python/pythonFunctionCursorResolver";
import { findKotlinFunctionAtPosition } from "./languages/kotlin";
import { findFunctionAtPosition as findTypeScriptFunctionAtPosition } from "./typescriptFunctionCursorResolver";

/** Finds the innermost callable supported by the active editor language. */
export function findFunctionAtPosition(
  input: FunctionCursorTargetInput
): FunctionCursorTarget | undefined {
  if (/\.kts?$/iu.test(input.filePath)) return findKotlinFunctionAtPosition(input);
  switch (input.languageId) {
    case "kotlin":
      return findKotlinFunctionAtPosition(input);
    case "python":
      return findPythonFunctionAtPosition(input);
    case "java":
      return findJavaFunctionAtPosition(input);
    case "fsharp":
    case "ocaml":
    case "elixir":
      return findFunctionalFunctionAtPosition(input);
    default:
      return findTypeScriptFunctionAtPosition(input);
  }
}
