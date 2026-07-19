/**
 * Pipe-forward expression extraction shared by F#, OCaml, and Elixir. It keeps
 * exact stage ranges and never equates pipelines with composition or monadic bind.
 */

import {
  findFunctionalLine,
  functionalOffsetsRange,
  trimFunctionalSpan
} from "./functionalSourceText";
import type {
  FunctionalCallableSyntax,
  FunctionalPipelineChain,
  FunctionalPipelineStage,
  FunctionalSourceSnapshot
} from "./types";

/** Finds every source-ordered `|>` chain owned by one selected function body. */
export function collectFunctionalPipelineChains(
  source: FunctionalSourceSnapshot,
  callable: FunctionalCallableSyntax
): FunctionalPipelineChain[] {
  const pipeOffsets = findPipeOperatorOffsets(source, callable.bodyFrom, callable.bodyTo);
  if (pipeOffsets.length === 0) {
    return [];
  }
  const groups: number[][] = [];
  for (const pipeOffset of pipeOffsets) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (group && previous !== undefined && continuesPipeGroup(source, previous, pipeOffset)) {
      group.push(pipeOffset);
    } else {
      groups.push([pipeOffset]);
    }
  }
  return groups.flatMap((group) => {
    const input = readPipelineInput(source, callable, group[0] ?? callable.bodyFrom);
    const stages = createPipelineStages(source, group);
    const lastStage = stages.at(-1);
    return input && lastStage
      ? [{
          inputText: input.text,
          inputRange: functionalOffsetsRange(source.lines, input.from, input.to),
          inputFrom: input.from,
          inputTo: input.to,
          stages,
          from: input.from,
          to: lastStage.to
        }]
      : [];
  });
}

/** Scans strings/comments iteratively so decorative `|>` text is never a stage. */
function findPipeOperatorOffsets(
  source: FunctionalSourceSnapshot,
  from: number,
  to: number
): number[] {
  const offsets: number[] = [];
  let quote: "\"" | "'" | undefined;
  let escaped = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  for (let offset = from; offset < to; offset += 1) {
    const character = source.text[offset] ?? "";
    const next = source.text[offset + 1] ?? "";
    if (lineComment) {
      if (character === "\n" || character === "\r") {
        lineComment = false;
      }
      continue;
    }
    if (blockCommentDepth > 0) {
      if (character === "(" && next === "*") {
        blockCommentDepth += 1;
        offset += 1;
      } else if (character === "*" && next === ")") {
        blockCommentDepth -= 1;
        offset += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "\"" || (source.profile.language === "elixir" && character === "'")) {
      quote = character;
      continue;
    }
    if (character === "(" && next === "*") {
      blockCommentDepth = 1;
      offset += 1;
      continue;
    }
    if (source.profile.lineComment
      && source.text.startsWith(source.profile.lineComment, offset)) {
      lineComment = true;
      offset += source.profile.lineComment.length - 1;
      continue;
    }
    if (character === "|" && next === ">") {
      offsets.push(offset);
      offset += 1;
    }
  }
  return offsets;
}

/** Separates a new same-line input from indented continuation operators. */
function continuesPipeGroup(
  source: FunctionalSourceSnapshot,
  previousOffset: number,
  currentOffset: number
): boolean {
  const previousLine = findFunctionalLine(source.lines, previousOffset);
  const currentLine = findFunctionalLine(source.lines, currentOffset);
  if (previousLine.index === currentLine.index) {
    return true;
  }
  if (source.text.slice(currentLine.from, currentOffset).trim()) {
    return false;
  }
  for (let index = previousLine.index + 1; index < currentLine.index; index += 1) {
    const line = source.lines[index];
    const trimmed = line?.text.trim() ?? "";
    if (!line || !trimmed || isCommentLine(source, trimmed)) {
      continue;
    }
    if (line.indent <= currentLine.indent && !/^[)\]}]/u.test(trimmed)) {
      return false;
    }
  }
  return true;
}

/** Recovers the expression feeding the first operator on its line or just above it. */
function readPipelineInput(
  source: FunctionalSourceSnapshot,
  callable: FunctionalCallableSyntax,
  pipeOffset: number
): { from: number; to: number; text: string } | undefined {
  const pipeLine = findFunctionalLine(source.lines, pipeOffset);
  const sameLine = trimFunctionalSpan(source.text, pipeLine.from, pipeOffset);
  if (sameLine.text) {
    return removeInputBinding(source.text, sameLine.from, sameLine.to);
  }
  for (let index = pipeLine.index - 1; index >= 0; index -= 1) {
    const line = source.lines[index];
    if (!line || line.to < callable.bodyFrom) {
      break;
    }
    const candidate = trimFunctionalSpan(source.text, line.from, line.to);
    if (!candidate.text || isCommentLine(source, candidate.text)) {
      continue;
    }
    return removeInputBinding(source.text, candidate.from, candidate.to);
  }
  return undefined;
}

/** Removes a surrounding `let result =`/`result =` binding from an input line. */
function removeInputBinding(
  text: string,
  from: number,
  to: number
): { from: number; to: number; text: string } {
  const value = text.slice(from, to);
  let assignment = -1;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "=") {
      continue;
    }
    const previous = value[index - 1] ?? "";
    const next = value[index + 1] ?? "";
    if (!"=!<>".includes(previous) && next !== "=" && next !== ">") {
      assignment = index;
    }
  }
  return assignment >= 0
    ? trimFunctionalSpan(text, from + assignment + 1, to)
    : trimFunctionalSpan(text, from, to);
}

/** Creates complete stage labels and optional stable callee identities. */
function createPipelineStages(
  source: FunctionalSourceSnapshot,
  pipeOffsets: readonly number[]
): FunctionalPipelineStage[] {
  return pipeOffsets.flatMap((pipeOffset, index) => {
    const pipeLine = findFunctionalLine(source.lines, pipeOffset);
    const nextPipe = pipeOffsets[index + 1];
    const rawTo = nextPipe ?? pipeLine.to;
    const span = trimFunctionalSpan(source.text, pipeOffset + 2, rawTo);
    if (!span.text) {
      return [];
    }
    const calleeText = readPipelineCallee(span.text);
    const calleeName = calleeText?.split(".").at(-1);
    return [{
      text: span.text,
      calleeName,
      calleeText,
      range: functionalOffsetsRange(source.lines, span.from, span.to),
      from: span.from,
      to: span.to
    }];
  });
}

/** Reads only named local/module stages; lambdas remain visible but non-drillable. */
function readPipelineCallee(stage: string): string | undefined {
  const match = stage.match(
    /^\(*\s*([\p{L}_][\p{L}\p{N}_?!']*(?:\.[\p{L}_][\p{L}\p{N}_?!']*)*)/u
  );
  const candidate = match?.[1];
  return candidate && candidate !== "fn" && candidate !== "fun"
    ? candidate
    : undefined;
}

/** Recognizes only the active profile's source comment marker. */
function isCommentLine(source: FunctionalSourceSnapshot, value: string): boolean {
  return value.startsWith("(*")
    || Boolean(source.profile.lineComment && value.startsWith(source.profile.lineComment));
}
