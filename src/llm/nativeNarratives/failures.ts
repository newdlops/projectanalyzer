/** Preserve independent execution/cleanup failures and scheduler cancellation without serializing their private details. */
import { ModelTaskError } from "../../shared/modelTasks";
import { FunctionNarrativeError } from "../../shared/functionNarratives";

/** Deduplicate identical error objects while retaining nested aggregate context and every original cause. */
export function combineNativeFailures(errors: unknown[]): unknown {
  const distinct = [...new Set(errors.filter(error => error !== undefined))];
  if (distinct.length <= 1) return distinct[0];
  const error = new AggregateError(distinct, "Native narrative action or worker cleanup failed");
  const cancellation = distinct.find(item => item instanceof ModelTaskError) as ModelTaskError | undefined;
  const domain = distinct.find(item => item instanceof FunctionNarrativeError) as FunctionNarrativeError | undefined;
  return Object.assign(error, { code: cancellation?.code === "disposed" ? "cancelled" : cancellation?.code ?? domain?.code ?? "failed" });
}
