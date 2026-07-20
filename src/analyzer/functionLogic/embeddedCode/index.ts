/**
 * Embedded-code Function Logic public surface. Compiler-specific discovery and
 * planning internals remain inside this feature folder.
 */

export { discoverTypeScriptEmbeddedCode } from "./typescriptEmbeddedCodeDiscovery";
export { expandTypeScriptEmbeddedCode } from "./typescriptEmbeddedCodeExpansion";
export type {
  TypeScriptEmbeddedCodeDiscovery,
  TypeScriptEmbeddedCodeExpansion,
  TypeScriptEmbeddedCodeMode,
  TypeScriptEmbeddedCodeRequest
} from "./types";

