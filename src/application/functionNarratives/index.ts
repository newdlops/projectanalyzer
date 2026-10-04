/** Public source-reading API; internal helpers never depend on VS Code or Webview state. */
export { buildFunctionNarrativeContext } from "./sourceContext";
export { parseFunctionNarrative, buildFunctionNarrativePrompt } from "./structuredResponse";
export { FunctionNarrativeError, type FunctionNarrativeProvider } from "./provider";
