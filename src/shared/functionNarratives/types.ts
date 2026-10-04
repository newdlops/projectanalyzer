/** Portable, bounded descriptions of hypothetical behavior; these are never execution observations. */

/** Model references are relative to supplied snippets and use one-based source line numbers. */
export type FunctionNarrativeSource = { snippetId: string; startLine: number; endLine: number };
export type FunctionNarrativeStep = { text: string; source: FunctionNarrativeSource };
export type FunctionNarrativeScenario = {
  title: string;
  when: string[];
  steps: FunctionNarrativeStep[];
  outcome: string;
  assumptions: string[];
};
export type FunctionNarrative = {
  summary: string;
  scenarios: FunctionNarrativeScenario[];
  limitations: string[];
};

/** Only source excerpts, never workspace paths or analyzer identities, reach the language model. */
export type FunctionNarrativeSnippet = {
  id: string;
  role: "function" | "nearby" | "helper" | "caller";
  startLine: number;
  endLine: number;
  text: string;
  truncated: boolean;
};
export type FunctionNarrativeContext = {
  functionName: string;
  language: string;
  snippets: FunctionNarrativeSnippet[];
  limited: boolean;
};
