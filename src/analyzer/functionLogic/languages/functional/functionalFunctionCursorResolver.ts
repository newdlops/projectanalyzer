/**
 * Host-independent cursor selection for named F#, OCaml, and Elixir functions.
 * The narrowest containing callable wins without recursive syntax traversal.
 */

import type { FunctionCursorTarget, FunctionCursorTargetInput } from "../../types";
import {
  functionalOffsetsRange,
  functionalPositionOffset
} from "../../../languages/functional/functionalSourceText";
import { parseFunctionalSource } from "../../../languages/functional/functionalSyntax";

/** Finds the selected named functional-language callable at an editor position. */
export function findFunctionalFunctionAtPosition(
  input: FunctionCursorTargetInput
): FunctionCursorTarget | undefined {
  const source = parseFunctionalSource(input.sourceText, input.languageId, input.filePath);
  if (!source) {
    return undefined;
  }
  const cursorOffset = functionalPositionOffset(
    source.lines,
    input.position.line,
    input.position.character
  );
  const selected = source.callables
    .filter((callable) =>
      callable.declarationFrom <= cursorOffset && cursorOffset <= callable.declarationTo
    )
    .sort((left, right) =>
      (left.declarationTo - left.declarationFrom)
        - (right.declarationTo - right.declarationFrom)
      || right.qualifiedName.split(".").length - left.qualifiedName.split(".").length
      || left.declarationFrom - right.declarationFrom
    )[0];
  return selected
    ? {
        kind: "function",
        name: selected.name,
        qualifiedName: selected.qualifiedName,
        filePath: input.filePath,
        language: source.profile.language,
        range: functionalOffsetsRange(
          source.lines,
          selected.declarationFrom,
          selected.declarationTo
        ),
        selectionRange: functionalOffsetsRange(
          source.lines,
          selected.selectionFrom,
          selected.selectionTo
        ),
        anonymous: false
      }
    : undefined;
}
