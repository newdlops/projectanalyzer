/**
 * Host-independent Python cursor resolver. It selects the smallest callable
 * declaration containing the editor position, including methods and lambdas.
 */

import type {
  FunctionCursorTarget,
  FunctionCursorTargetInput
} from "../../types";
import {
  collectPythonCallables,
  parsePythonLezerSource
} from "../../../languages/python/pythonLezerSyntax";
import {
  lezerNodeRange,
  lezerOffsetsRange,
  lezerPositionOffset
} from "../../../core/lezerSource";

/** Finds the innermost Python callable containing the cursor. */
export function findPythonFunctionAtPosition(
  input: FunctionCursorTargetInput
): FunctionCursorTarget | undefined {
  if (input.languageId !== "python") {
    return undefined;
  }
  const source = parsePythonLezerSource(input.sourceText);
  const cursorOffset = lezerPositionOffset(source, input.position);
  const candidates = collectPythonCallables(source)
    .filter((callable) =>
      callable.declarationNode.from <= cursorOffset
        && cursorOffset <= callable.declarationNode.to
    )
    .sort((left, right) =>
      (left.declarationNode.to - left.declarationNode.from)
        - (right.declarationNode.to - right.declarationNode.from)
      || right.qualifiedName.split(".").length - left.qualifiedName.split(".").length
      || left.declarationNode.from - right.declarationNode.from
    );
  const selected = candidates[0];
  return selected
    ? {
        kind: selected.kind,
        name: selected.name,
        qualifiedName: selected.qualifiedName,
        filePath: input.filePath,
        language: "python",
        range: lezerNodeRange(source, selected.declarationNode),
        selectionRange: lezerOffsetsRange(
          source,
          selected.selectionFrom,
          selected.selectionTo
        ),
        anonymous: selected.anonymous
      }
    : undefined;
}
