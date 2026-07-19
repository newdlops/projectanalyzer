/**
 * Lightweight callable discovery for F#, OCaml, and Elixir. The scanner is
 * iterative, source-range preserving, and deliberately limited to named funcs.
 */

import { resolveFunctionalLanguageProfile } from "./functionalLanguageProfiles";
import { createFunctionalSourceLines, trimFunctionalSpan } from "./functionalSourceText";
import type {
  FunctionalCallableSyntax,
  FunctionalSourceLine,
  FunctionalSourceSnapshot
} from "./types";

type MlCallableDraft = FunctionalCallableSyntax & {
  indent: number;
};

type ElixirFunctionDraft = Omit<FunctionalCallableSyntax, "declarationTo" | "bodyTo">;

type ElixirBlock = {
  kind: "module" | "function" | "generic";
  name?: string;
  functionDraft?: ElixirFunctionDraft;
};

/** Parses a supported functional source snapshot for all downstream adapters. */
export function parseFunctionalSource(
  text: string,
  languageId: string | undefined,
  filePath: string
): FunctionalSourceSnapshot | undefined {
  const profile = resolveFunctionalLanguageProfile(languageId, filePath);
  if (!profile) {
    return undefined;
  }
  const lines = createFunctionalSourceLines(text);
  const callables = profile.language === "elixir"
    ? collectElixirCallables(text, lines)
    : collectMlFamilyCallables(text, lines);
  return { text, profile, lines, callables };
}

/** Discovers indentation-owned `let name parameters =` functions. */
function collectMlFamilyCallables(
  text: string,
  lines: readonly FunctionalSourceLine[]
): FunctionalCallableSyntax[] {
  const drafts: MlCallableDraft[] = [];
  const owners: MlCallableDraft[] = [];
  const sourceEnd = lines.at(-1)?.to ?? text.length;
  let moduleName = "";
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) {
      continue;
    }
    const declarationBoundary = /^\s*(?:let|type|module|namespace|exception|in)\b/u
      .test(line.text);
    if (declarationBoundary) {
      while (owners.length > 0 && line.indent <= (owners.at(-1)?.indent ?? -1)) {
        const closed = owners.pop();
        if (closed) {
          closed.declarationTo = line.from;
          closed.bodyTo = line.from;
        }
      }
    }
    const moduleMatch = line.text.match(/^\s*(?:module|namespace)\s+(?:rec\s+)?([A-Z][\w.]*)/u);
    if (moduleMatch && line.indent === 0) {
      moduleName = moduleMatch[1] ?? moduleName;
    }
    const match = line.text.match(
      /^(\s*)let\s+(?:(?:rec|inline|private)\s+)*([\p{L}_][\p{L}\p{N}_']*)\s+(.+?)\s*=\s*(.*)$/u
    );
    const name = match?.[2];
    const parameters = match?.[3]?.trim();
    if (!match || !name || !parameters || parameters.startsWith("=")) {
      continue;
    }
    const declarationFrom = line.from + (match[1]?.length ?? 0);
    const selectionFrom = line.from + line.text.indexOf(name, match[1]?.length ?? 0);
    const equalsOffset = line.text.indexOf("=", selectionFrom - line.from + name.length);
    if (equalsOffset < 0) {
      continue;
    }
    const inlineBody = trimFunctionalSpan(text, line.from + equalsOffset + 1, line.to);
    const bodyFrom = inlineBody.text
      ? inlineBody.from
      : lines[lineIndex + 1]?.from ?? line.to;
    const draft: MlCallableDraft = {
      name,
      qualifiedName: [
        moduleName,
        ...owners.map((owner) => owner.name),
        name
      ].filter(Boolean).join("."),
      signature: line.text.trim(),
      declarationFrom,
      declarationTo: sourceEnd,
      selectionFrom,
      selectionTo: selectionFrom + name.length,
      bodyFrom,
      bodyTo: sourceEnd,
      indent: line.indent
    };
    drafts.push(draft);
    owners.push(draft);
  }
  return drafts.map(({ indent: _indent, ...callable }) => callable);
}

/** Discovers Elixir `def`/`defp` blocks while balancing nested do/fn/end tokens. */
function collectElixirCallables(
  text: string,
  lines: readonly FunctionalSourceLine[]
): FunctionalCallableSyntax[] {
  const callables: FunctionalCallableSyntax[] = [];
  const blocks: ElixirBlock[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) {
      continue;
    }
    const sanitized = sanitizeElixirLine(line.text);
    const moduleHeader = readElixirModuleHeader(sanitized);
    const functionHeader = readElixirFunctionHeader(text, line, sanitized, blocks);
    if (functionHeader?.oneLine) {
      callables.push(functionHeader.oneLine);
    }
    let pendingBlock: ElixirBlock | undefined = moduleHeader
      ? { kind: "module", name: moduleHeader }
      : functionHeader?.block
        ? { kind: "function", functionDraft: functionHeader.block }
        : undefined;
    let claimedPending = false;
    const tokens = sanitized.matchAll(/\b(?:do|fn|end)\b/gu);
    for (const token of tokens) {
      const value = token[0];
      const tokenTo = (token.index ?? 0) + value.length;
      if (value === "do" && sanitized.slice(tokenTo).trimStart().startsWith(":")) {
        continue;
      }
      if (value === "do") {
        if (pendingBlock && !claimedPending) {
          blocks.push(pendingBlock);
          claimedPending = true;
        } else {
          blocks.push({ kind: "generic" });
        }
      } else if (value === "fn") {
        blocks.push({ kind: "generic" });
      } else {
        const closed = blocks.pop();
        if (closed?.kind === "function" && closed.functionDraft) {
          callables.push({
            ...closed.functionDraft,
            declarationTo: line.to,
            bodyTo: line.from
          });
        }
      }
    }
  }

  const sourceEnd = lines.at(-1)?.to ?? text.length;
  while (blocks.length > 0) {
    const unclosed = blocks.pop();
    if (unclosed?.kind === "function" && unclosed.functionDraft) {
      callables.push({
        ...unclosed.functionDraft,
        declarationTo: sourceEnd,
        bodyTo: sourceEnd
      });
    }
  }
  return callables.sort((left, right) =>
    left.declarationFrom - right.declarationFrom
    || left.declarationTo - right.declarationTo
  );
}

/** Reads a module owner only when its declaration opens a balanced block. */
function readElixirModuleHeader(line: string): string | undefined {
  const match = line.match(/^\s*defmodule\s+([A-Z][\w.]*)\s+do\s*$/u);
  return match?.[1];
}

/** Creates either a block draft or a complete one-line Elixir function. */
function readElixirFunctionHeader(
  text: string,
  line: FunctionalSourceLine,
  sanitized: string,
  blocks: readonly ElixirBlock[]
): { block?: ElixirFunctionDraft; oneLine?: FunctionalCallableSyntax } | undefined {
  const match = sanitized.match(/^\s*defp?\s+([\p{L}_][\p{L}\p{N}_?!]*)/u);
  const name = match?.[1];
  if (!match || !name) {
    return undefined;
  }
  const nameInLine = line.text.indexOf(name, match.index ?? 0);
  const selectionFrom = line.from + Math.max(0, nameInLine);
  const owners = blocks
    .filter((block) => block.kind === "module" && block.name)
    .map((block) => block.name as string);
  const qualifiedName = [...owners, name].join(".");
  const declarationFrom = line.from + (line.text.match(/^\s*/u)?.[0].length ?? 0);
  const doColon = sanitized.indexOf("do:");
  if (doColon >= 0) {
    const body = trimFunctionalSpan(text, line.from + doColon + 3, line.to);
    return {
      oneLine: {
        name,
        qualifiedName,
        signature: sanitized.slice(0, doColon + 3).trim(),
        declarationFrom,
        declarationTo: line.to,
        selectionFrom,
        selectionTo: selectionFrom + name.length,
        bodyFrom: body.from,
        bodyTo: body.to
      }
    };
  }
  if (!/\bdo\s*$/u.test(sanitized)) {
    return undefined;
  }
  return {
    block: {
      name,
      qualifiedName,
      signature: sanitized.trim(),
      declarationFrom,
      selectionFrom,
      selectionTo: selectionFrom + name.length,
      bodyFrom: line.to < text.length ? line.to + newlineWidth(text, line.to) : line.to
    }
  };
}

/** Removes quoted and commented text while retaining token positions. */
function sanitizeElixirLine(line: string): string {
  const output = [...line];
  let quote: "\"" | "'" | undefined;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      output[index] = " ";
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      output[index] = " ";
    } else if (character === "#") {
      for (let tail = index; tail < output.length; tail += 1) {
        output[tail] = " ";
      }
      break;
    }
  }
  return output.join("");
}

/** Returns the exact newline width following one indexed physical line. */
function newlineWidth(text: string, lineTo: number): number {
  if (text.slice(lineTo, lineTo + 2) === "\r\n") {
    return 2;
  }
  return text[lineTo] === "\n" || text[lineTo] === "\r" ? 1 : 0;
}
