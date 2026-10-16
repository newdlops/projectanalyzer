/**
 * Public complete-source action API. Construct one graph authority, capture all
 * required root/caller/parent IDs, recheck after asynchronous model work, then
 * dispose. Internal traversal and range resolution never author response values.
 */
export { createWorkspaceSourceGraph } from "./graphAuthority";
export type { WorkspaceSourceGraphInput } from "./graphAuthority";
export { captureNarrativeSources } from "./capture";
export type { CaptureNarrativeSourcesOptions } from "./capture";
export { extractWholeSourceRange } from "./ranges";
export { readWholeCallableSource } from "./declaration";
export type { SourceDeclarationResolver, WholeDeclarationSource } from "./declaration";
export { createNarrativeSourceAccess, getNarrativeSourceRoots } from "./access";
export { createCapturedNarrativeContext } from "./context";
export { getNarrativeSourceFailureStatus } from "./failure";
export { sealNarrativeModelContext } from "./modelContext";
