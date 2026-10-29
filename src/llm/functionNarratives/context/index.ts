/** Public context admission boundary shared by the private server and legacy CLI; no source is retained here. */
export { LOCAL_NARRATIVE_BASE_CONTEXT, LOCAL_NARRATIVE_OUTPUT_TOKENS, assertLocalNarrativeMemory,
  estimateLocalNarrativePromptTokens, localNarrativeContextSettings, selectLocalNarrativeContext } from "./policy";
export { readLocalNarrativeMemory } from "./memory";
export type { LocalNarrativeContextOptions, LocalNarrativeContextSettings, LocalNarrativeMemory, LocalNarrativeMemoryProbe } from "./types";
