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

/** Lexical environment used when an immediate text consumer evaluates code. */
export type TypeScriptEmbeddedExecutionScope =
  | "host-lexical"
  | "global"
  | "isolated"
  | "not-executed";

/** Parser grammar selected from the runtime API rather than the host file extension. */
export type TypeScriptEmbeddedParseGoal = "script" | "function-body";

/** A host binding that an unshadowed direct eval may read or write. */
export type TypeScriptEmbeddedHostBinding = {
  id: string;
  name: string;
  kind: "parameter" | "local" | "constant";
  confidence: FunctionLogicConfidence;
  valueRole?: "component";
};

/** One statically complete text value that can be parsed as a JavaScript program. */
export type TypeScriptEmbeddedCodeRequest = {
  anchorBlockId: string;
  code: string;
  /** Function-constructor parameter grammar, retained separately from the body. */
  parameterSource?: string;
  consumer: string;
  mode: TypeScriptEmbeddedCodeMode;
  executionScope: TypeScriptEmbeddedExecutionScope;
  parseGoal: TypeScriptEmbeddedParseGoal;
  confidence: FunctionLogicConfidence;
  /** Range of the consuming call; it determines execution order and CFG placement. */
  invocationRange: SourceRange;
  /** Range of the literal or constant initializer that supplied the text. */
  codeRange: SourceRange;
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
  /** Host binding identities whose flows must be recomputed across direct eval regions. */
  hostBindingIds: string[];
};
