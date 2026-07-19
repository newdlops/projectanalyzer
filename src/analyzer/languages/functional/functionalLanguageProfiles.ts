/**
 * Registry for functional languages that share `|>` syntax while retaining
 * their different argument-insertion semantics.
 */

import type {
  FunctionalLanguageProfile,
  FunctionalPipelineLanguage
} from "./types";

const PROFILES: readonly FunctionalLanguageProfile[] = [{
  language: "fsharp",
  extensions: [".fs", ".fsx"],
  languageIds: ["fsharp"],
  lineComment: "//",
  pipeInsertion: "lastArgument"
}, {
  language: "ocaml",
  extensions: [".ml", ".mli"],
  languageIds: ["ocaml"],
  pipeInsertion: "lastArgument"
}, {
  language: "elixir",
  extensions: [".ex", ".exs"],
  languageIds: ["elixir"],
  lineComment: "#",
  pipeInsertion: "firstArgument"
}];

/** All file extensions owned by the shared fallback analyzer. */
export const FUNCTIONAL_PIPELINE_EXTENSIONS = PROFILES.flatMap((profile) =>
  [...profile.extensions]
);

/** All canonical language IDs accepted by editor and analyzer dispatchers. */
export const FUNCTIONAL_PIPELINE_LANGUAGE_IDS = new Set<FunctionalPipelineLanguage>(
  PROFILES.map((profile) => profile.language)
);

/** Resolves editor aliases first, then a lowercase file extension. */
export function resolveFunctionalLanguageProfile(
  languageId: string | undefined,
  filePath: string
): FunctionalLanguageProfile | undefined {
  const normalizedLanguage = languageId?.toLowerCase();
  const byLanguage = PROFILES.find((profile) =>
    profile.languageIds.includes(normalizedLanguage ?? "")
  );
  if (byLanguage) {
    return byLanguage;
  }
  const normalizedPath = filePath.toLowerCase();
  return PROFILES.find((profile) =>
    profile.extensions.some((extension) => normalizedPath.endsWith(extension))
  );
}

/** Narrows an arbitrary graph/editor language to the supported union. */
export function isFunctionalPipelineLanguage(
  language: string
): language is FunctionalPipelineLanguage {
  return FUNCTIONAL_PIPELINE_LANGUAGE_IDS.has(language.toLowerCase() as FunctionalPipelineLanguage);
}
