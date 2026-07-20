/**
 * Public contracts for TypeScript/JavaScript code embedded in static text.
 * Discovery, program planning, and CFG integration communicate only through
 * these bounded records; no module evaluates or imports the embedded source.
 */

import type { SourceRange } from "../../../shared/types";
import type {
  FunctionLogicBlock,
  FunctionLogicCallsite,
  FunctionLogicConfidence,
  FunctionLogicEdge,
  FunctionLogicGap,
  FunctionLogicValueBinding,
  FunctionLogicValueFlow
} from "../types";

/** Runtime relationship between the host statement and its static code text. */
export type TypeScriptEmbeddedCodeMode =
  | "immediate"
  | "deferred"
  | "callable"
  | "stored";

/** One statically complete text value that can be parsed as a JavaScript program. */
export type TypeScriptEmbeddedCodeRequest = {
  anchorBlockId: string;
  code: string;
  /** Function-constructor parameter grammar, retained separately from the body. */
  parameterSource?: string;
  consumer: string;
  mode: TypeScriptEmbeddedCodeMode;
  confidence: FunctionLogicConfidence;
  range: SourceRange;
  sourceOrder: number;
};

/** Statement-local discovery plus explicit unknown/limit accounting. */
export type TypeScriptEmbeddedCodeDiscovery = {
  requests: TypeScriptEmbeddedCodeRequest[];
  dynamicConsumerCount: number;
};

/** Complete bounded additions produced after every embedded request is planned. */
export type TypeScriptEmbeddedCodeExpansion = {
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  callsites: FunctionLogicCallsite[];
  valueBindings: FunctionLogicValueBinding[];
  valueFlows: FunctionLogicValueFlow[];
  gaps: FunctionLogicGap[];
  addedBlockCount: number;
};

