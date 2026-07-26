/**
 * Source documentation adapter for Function Guide.
 *
 * This adapter discovers only documentation directly attached to the selected
 * callable. It returns normalized text plus exact source ranges and never
 * upgrades authored documentation into runtime or architecture truth.
 */

import type { SourceRange, SymbolNode } from "../../../shared/types";
import {
  readFunctionTutorDocumentationSummary,
  readFunctionTutorDocumentationTags
} from "./functionTutorDocumentationText";
import type {
  FunctionTutorDocumentationFact,
  FunctionTutorDocumentationKind,
  FunctionTutorEvidence
} from "../types";

export type FunctionTutorDocumentationInput = {
  functionNode: SymbolNode;
  sourceText: string;
  language: string;
};

/** Finds and normalizes source-authored documentation for the selected callable only. */
export function analyzeFunctionTutorDocumentation(
  input: FunctionTutorDocumentationInput
): FunctionTutorDocumentationFact | undefined {
  const lines = input.sourceText.split(/\r?\n/);
  const language = input.language.toLowerCase();
  const located = language === "python"
    ? readPythonDocstring(lines, input.functionNode.range.startLine)
    : language === "elixir"
      ? readElixirDocumentation(lines, input.functionNode.range.startLine)
      : language === "fsharp"
        ? readLineDocumentation(lines, input.functionNode.range.startLine, "///", "xml-doc")
        : language === "ocaml"
          ? readBlockDocumentation(lines, input.functionNode.range.startLine, "(**", "*)", "comment")
          : language === "java"
            ? readBlockDocumentation(lines, input.functionNode.range.startLine, "/**", "*/", "javadoc")
            : readBlockDocumentation(lines, input.functionNode.range.startLine, "/**", "*/", "jsdoc");
  if (!located) return undefined;
  const summary = readFunctionTutorDocumentationSummary(located.text);
  const tags = readFunctionTutorDocumentationTags(located.text);
  if (!summary.summary && tags.tags.length === 0) return undefined;
  const range = createRange(lines, located.startLine, located.endLine);
  const evidence: FunctionTutorEvidence = {
    kind: "source-documentation",
    certainty: "exact",
    filePath: input.functionNode.filePath,
    range,
    summary: "Source documentation attached to the selected function."
  };
  return {
    kind: located.kind,
    summary: summary.summary,
    tags: tags.tags,
    truncated: summary.truncated || tags.truncated,
    evidence: [evidence]
  };
}

type LocatedDocumentation = {
  kind: FunctionTutorDocumentationKind;
  text: string;
  startLine: number;
  endLine: number;
};

/** Reads an immediately preceding block comment without crossing a blank source line. */
function readBlockDocumentation(
  lines: string[],
  declarationLine: number,
  open: string,
  close: string,
  kind: FunctionTutorDocumentationKind
): LocatedDocumentation | undefined {
  let endLine = declarationLine - 1;
  if (endLine < 0 || !lines[endLine].includes(close)) return undefined;
  let startLine = endLine;
  while (startLine >= 0 && !lines[startLine].includes(open)) startLine -= 1;
  if (startLine < 0) return undefined;
  const between = lines.slice(endLine + 1, declarationLine);
  if (between.some((line) => line.trim())) return undefined;
  return { kind, text: lines.slice(startLine, endLine + 1).join("\n"), startLine, endLine };
}

/** Reads contiguous XML-style documentation lines directly above a functional declaration. */
function readLineDocumentation(
  lines: string[],
  declarationLine: number,
  marker: string,
  kind: FunctionTutorDocumentationKind
): LocatedDocumentation | undefined {
  const endLine = declarationLine - 1;
  if (endLine < 0 || !lines[endLine].trimStart().startsWith(marker)) return undefined;
  let startLine = endLine;
  while (startLine > 0 && lines[startLine - 1].trimStart().startsWith(marker)) startLine -= 1;
  return { kind, text: lines.slice(startLine, endLine + 1).join("\n"), startLine, endLine };
}

/** Reads an Elixir @doc string immediately before the selected def/defp declaration. */
function readElixirDocumentation(lines: string[], declarationLine: number): LocatedDocumentation | undefined {
  const endLine = declarationLine - 1;
  if (endLine < 0 || !/^\s*@doc\b/.test(lines[endLine])) return undefined;
  const line = lines[endLine];
  if (/^\s*@doc\s+false\b/.test(line)) return undefined;
  const triple = /@doc\s+\"\"\"/.test(line);
  if (!triple) return { kind: "elixir-doc", text: line, startLine: endLine, endLine };
  let startLine = endLine;
  let finish = endLine;
  while (finish + 1 < lines.length) {
    finish += 1;
    if (lines[finish].includes('\"\"\"')) break;
  }
  if (!lines[finish]?.includes('\"\"\"')) return undefined;
  return { kind: "elixir-doc", text: lines.slice(startLine, finish + 1).join("\n"), startLine, endLine: finish };
}

/** Reads only the first logical statement of a Python function as its docstring. */
function readPythonDocstring(lines: string[], declarationLine: number): LocatedDocumentation | undefined {
  let startLine = declarationLine + 1;
  while (startLine < lines.length && !lines[startLine].trim()) startLine += 1;
  const first = lines[startLine]?.trimStart();
  if (!first || (!first.startsWith('\"\"\"') && !first.startsWith("'''"))) return undefined;
  const delimiter = first.startsWith('\"\"\"') ? '\"\"\"' : "'''";
  let endLine = startLine;
  if (first.slice(delimiter.length).includes(delimiter)) return { kind: "docstring", text: lines[startLine], startLine, endLine };
  while (endLine + 1 < lines.length) {
    endLine += 1;
    if (lines[endLine].includes(delimiter)) break;
  }
  if (!lines[endLine]?.includes(delimiter)) return undefined;
  return { kind: "docstring", text: lines.slice(startLine, endLine + 1).join("\n"), startLine, endLine };
}

/** Converts inclusive line bounds into the product's editor-compatible source range. */
function createRange(lines: string[], startLine: number, endLine: number): SourceRange {
  return {
    startLine,
    startCharacter: 0,
    endLine,
    endCharacter: lines[endLine]?.length ?? 0
  };
}
