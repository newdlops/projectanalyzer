/**
 * Host-independent Java cursor resolver. It selects the smallest executable
 * method, constructor, or lambda declaration containing the editor position.
 */

import type {
  FunctionCursorTarget,
  FunctionCursorTargetInput
} from "../../types";
import {
  collectJavaCallables,
  parseJavaLezerSource
} from "../../../languages/java/javaLezerSyntax";
import {
  lezerNodeRange,
  lezerOffsetsRange,
  lezerPositionOffset
} from "../../../core/lezerSource";

/** Finds the innermost Java callable containing the cursor. */
export function findJavaFunctionAtPosition(
  input: FunctionCursorTargetInput
): FunctionCursorTarget | undefined {
  if (input.languageId !== "java") {
    return undefined;
  }
  const source = parseJavaLezerSource(input.sourceText);
  const cursorOffset = lezerPositionOffset(source, input.position);
  const candidates = collectJavaCallables(source)
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
        language: "java",
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
