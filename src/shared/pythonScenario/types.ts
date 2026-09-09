/** Portable Python subset bytecode. No source execution, imports, attributes or host objects are exposed. */
export type PythonValue = null | boolean | number | string | PythonValue[];
export type PythonInstruction = {
  op: "literal" | "load" | "store" | "list" | "unpack" | "binary" | "unary" | "index" | "slice"
    | "call" | "method" | "pop" | "dup" | "jump" | "branch" | "iterate" | "next" | "return" | "trace" | "scope" | "gap";
  name?: string;
  count?: number;
  value?: PythonValue;
  target?: number;
  blockId?: string;
  /** Branch truth for conditional jumps. Short circuit reads without consuming the operand. */
  when?: boolean;
  keep?: boolean;
};
export type PythonScenarioProgram = {
  version: 1;
  root: string;
  functions: Array<{ id: string; parameters: string[]; instructions: PythonInstruction[] }>;
  globals: Array<{ name: string; instructions: PythonInstruction[] }>;
  bindings: Array<{ name: string; bindingId: string; parameterId?: string }>;
  entryBlockId: string;
  edges: Array<{ edgeId: string; sourceBlockId: string; targetBlockId: string; kind: string }>;
  /** Regex-derived candidates are source evidence, never a claimed accepted input. */
  stringCandidates: string[];
  regexPatterns: string[];
};
export type PythonObservation = {
  blockId: string; operator: string; left: number; right: number; outcome: boolean;
  metric?: "numeric" | "string-distance";
  leftValue?: PythonValue;
  rightValue?: PythonValue;
};
export type PythonScenarioResult = {
  status: "verified" | "partial";
  reason?: "unknown-input" | "unsupported-expression" | "external-state" | "control-gap" | "loop-budget" | "step-budget";
  blockIds: string[];
  edgeIds: string[];
  decisions: Array<{ blockId: string; edgeId: string; outcome: string }>;
  observations: PythonObservation[];
  transitions: Array<{ blockId: string; occurrence: number; bindingId: string; before?: PythonValue; after: PythonValue }>;
  terminal?: { blockId: string; kind: "return"; value: PythonValue };
};
