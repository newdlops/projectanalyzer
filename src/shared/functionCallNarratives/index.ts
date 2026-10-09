/** Public portable call-reading model contract; no Host, filesystem or model dependencies. */
export type { FunctionCallNarrativeScope, FunctionCallNarrativeTarget, FunctionCallNarrativeTask, FunctionCallReading, FunctionCallNarrativeChunk } from "./types";
export { createFunctionCallNarrativeSchema } from "./schema";
export { getFunctionCallFixedInputs, formatFunctionCallDeclaredType } from "./fixedInputs";
export { getFunctionCallFixedReason } from "./fixedReason";
export { getFunctionCallFixedOutput } from "./fixedOutput";
export type { FunctionCallReturnSyntax, FunctionCallReturnSite, FunctionCallReturnRegion, FunctionCallResultUse } from "./sourceSyntaxTypes";
export { isFunctionCallNarrativeChunk, isFunctionCallNarrativeLanguage } from "./validation";
