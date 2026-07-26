/**
 * Bounded documentation text normalization for Function Guide.
 *
 * The helpers intentionally retain only plain text and a small fixed tag set.
 * They never parse or render Markdown/HTML as executable or rich content.
 */

import type {
  FunctionTutorDocumentationTag
} from "../types";

export const MAX_FUNCTION_TUTOR_DOCUMENTATION_SUMMARY_CHARS = 480;
export const MAX_FUNCTION_TUTOR_DOCUMENTATION_TAGS = 8;
export const MAX_FUNCTION_TUTOR_DOCUMENTATION_TAG_CHARS = 180;

/** Converts comment syntax and markup-looking text into bounded display-safe plain text. */
export function normalizeFunctionTutorDocumentationText(value: string, limit: number): {
  text: string;
  truncated: boolean;
} {
  const plain = stripFunctionTutorDocumentationMarkers(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/[`*_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= limit) return { text: plain, truncated: false };
  return { text: `${plain.slice(0, Math.max(0, limit - 1)).trimEnd()}…`, truncated: true };
}

/** Returns the first non-empty paragraph before a documentation tag. */
export function readFunctionTutorDocumentationSummary(raw: string): {
  summary: string;
  truncated: boolean;
} {
  const beforeTag = stripFunctionTutorDocumentationMarkers(raw)
    .split(/(?:^|\n)\s*(?:@(?:param|returns?|throws?|exception|remarks?)|:(?:param|returns?|raises?):)/i)[0] ?? "";
  const normalized = normalizeFunctionTutorDocumentationText(
    beforeTag,
    MAX_FUNCTION_TUTOR_DOCUMENTATION_SUMMARY_CHARS
  );
  return { summary: normalized.text, truncated: normalized.truncated };
}

/** Extracts only input/output/exception/remarks tags with independently bounded content. */
export function readFunctionTutorDocumentationTags(raw: string): {
  tags: FunctionTutorDocumentationTag[];
  truncated: boolean;
} {
  const tags: FunctionTutorDocumentationTag[] = [];
  let truncated = false;
  const lines = stripFunctionTutorDocumentationMarkers(raw).split(/\r?\n/);
  for (const line of lines) {
    if (tags.length >= MAX_FUNCTION_TUTOR_DOCUMENTATION_TAGS) {
      truncated = true;
      break;
    }
    const cleaned = line.trim();
    const js = /^@(param|returns?|throws?|exception|remarks?)\b\s*(?:\{[^}]*\}\s*)?(?:([A-Za-z_$][\w$']*)\s*)?(.*)$/i.exec(cleaned);
    const python = /^:(param|returns?|raises?)\s*([A-Za-z_$][\w$']*)?\s*:\s*(.*)$/i.exec(cleaned);
    const match = js ?? python;
    if (!match) continue;
    const sourceKind = match[1].toLowerCase();
    const kind = sourceKind === "param" ? "parameter"
      : sourceKind === "return" || sourceKind === "returns" ? "returns"
        : sourceKind === "throw" || sourceKind === "throws" || sourceKind === "exception" || sourceKind === "raises" ? "throws"
          : "remarks";
    const parameterName = kind === "parameter" ? match[2] : undefined;
    const tagText = kind === "parameter"
      ? match[3] ?? ""
      : [match[2], match[3]].filter((value): value is string => Boolean(value)).join(" ");
    const normalized = normalizeFunctionTutorDocumentationText(tagText, MAX_FUNCTION_TUTOR_DOCUMENTATION_TAG_CHARS);
    if (!normalized.text) continue;
    truncated ||= normalized.truncated;
    tags.push({ kind, ...(parameterName ? { parameterName } : {}), text: normalized.text });
  }
  return { tags, truncated };
}

/** Removes only syntax delimiters while preserving line breaks for summary/tag parsing. */
function stripFunctionTutorDocumentationMarkers(value: string): string {
  return value
    .replace(/\*\/\s*$/gm, "")
    .replace(/\*\)\s*$/gm, "")
    .replace(/^\s*\/\*\*?\s?/gm, "")
    .replace(/^\s*\*\s?/gm, "")
    .replace(/^\s*\/\/\/\s?/gm, "")
    .replace(/^\s*#\s?/gm, "")
    .replace(/^\s*\(\*\*?\s?/gm, "")
    .replace(/\"\"\"|'''/g, "");
}
