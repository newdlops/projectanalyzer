/** Browser-safe contracts for source-order navigation over a delivered graph. */
import type { FunctionLogicBlockPayload } from "../../../protocol/functionLogic";

/** These filters affect the outline only, never control-flow or value semantics. */
export type FunctionReadingFilter = "all" | "decisions" | "calls" | "exits";

/** Compound graphs carry a display-only function label alongside opaque identity. */
export type FunctionReadingBlock = FunctionLogicBlockPayload & { functionLabel?: string };

export type FunctionReadingRow = {
  block: FunctionReadingBlock;
  ordinal: number;
  categories: FunctionReadingFilter[];
};

/** Counts describe the listed source blocks, not possible runtime executions. */
export type FunctionReadingOutline = {
  rows: FunctionReadingRow[];
  counts: Record<FunctionReadingFilter, number>;
  omittedCount: number;
};
