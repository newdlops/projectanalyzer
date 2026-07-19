/**
 * Public language-dispatching cursor resolver. Parser-specific implementations
 * remain isolated while editor commands consume one stable function contract.
 */

import type { FunctionCursorTarget, FunctionCursorTargetInput } from "./types";
import { findJavaFunctionAtPosition } from "./languages/java/javaFunctionCursorResolver";
import { findPythonFunctionAtPosition } from "./languages/python/pythonFunctionCursorResolver";
import { findFunctionAtPosition as findTypeScriptFunctionAtPosition } from "./typescriptFunctionCursorResolver";

/** Finds the innermost callable supported by the active editor language. */
export function findFunctionAtPosition(
  input: FunctionCursorTargetInput
): FunctionCursorTarget | undefined {
  switch (input.languageId) {
    case "python":
      return findPythonFunctionAtPosition(input);
    case "java":
      return findJavaFunctionAtPosition(input);
    default:
      return findTypeScriptFunctionAtPosition(input);
  }
}
