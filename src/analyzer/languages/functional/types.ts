/**
 * Shared contracts for pipe-forward functional languages. Syntax discovery,
 * graph extraction, cursor selection, and Function Logic consume these types.
 */

import type { SourceRange } from "../../../shared/types";

/** Languages whose pipe-forward evaluation order is modeled explicitly. */
export type FunctionalPipelineLanguage = "fsharp" | "ocaml" | "elixir";

/** Where a pipe operator inserts the value produced by the previous stage. */
export type FunctionalPipeInsertion = "firstArgument" | "lastArgument";

/** Stable language behavior used by syntax and visualization adapters. */
export type FunctionalLanguageProfile = {
  language: FunctionalPipelineLanguage;
  extensions: readonly string[];
  languageIds: readonly string[];
  lineComment?: "//" | "#";
  pipeInsertion: FunctionalPipeInsertion;
};

/** One physical source line with offsets that preserve UTF-16 positions. */
export type FunctionalSourceLine = {
  index: number;
  from: number;
  to: number;
  text: string;
  indent: number;
};

/** One source-backed named function discovered without executing the module. */
export type FunctionalCallableSyntax = {
  name: string;
  qualifiedName: string;
  signature: string;
  declarationFrom: number;
  declarationTo: number;
  selectionFrom: number;
  selectionTo: number;
  bodyFrom: number;
  bodyTo: number;
};

/** Parsed immutable source shared by every functional-language adapter. */
export type FunctionalSourceSnapshot = {
  text: string;
  profile: FunctionalLanguageProfile;
  lines: FunctionalSourceLine[];
  callables: FunctionalCallableSyntax[];
};

/** One exact stage to which the previous pipeline value is passed. */
export type FunctionalPipelineStage = {
  text: string;
  calleeName?: string;
  calleeText?: string;
  range: SourceRange;
  from: number;
  to: number;
};

/** One complete pipe-forward expression in runtime evaluation order. */
export type FunctionalPipelineChain = {
  inputText: string;
  inputRange: SourceRange;
  inputFrom: number;
  inputTo: number;
  stages: FunctionalPipelineStage[];
  from: number;
  to: number;
};
