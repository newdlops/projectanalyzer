/** Sequential same-action call inference for a later complete root, with whole raw fields retained and no separate flow-summary or source answer pass. */
import type { FunctionNarrativeCallRequest, FunctionNarrativeModelResponse } from "../../functionNarratives/provider";
import { FunctionNarrativeError, type FunctionNarrativeCallPriors, type FunctionNarrativeSnippet } from "../../../shared/functionNarratives";
import type { FunctionCallReading } from "../../../shared/functionCallNarratives";
import type { CapturedFunctionCallPlan } from "../captured";
import { createCompleteFunctionCallNarrative } from "./packet";

/** Generation is supplied by the already-owned root transport; this helper never queues or starts a worker. */
export async function collectFunctionNarrativeCallPriors(plan: CapturedFunctionCallPlan, locale: "ko" | "en", signal: AbortSignal,
  generate: (request: FunctionNarrativeCallRequest, validate: (response: FunctionNarrativeModelResponse) => void) => Promise<FunctionNarrativeModelResponse>,
  assertCurrent: () => Promise<void>): Promise<{ priors?: FunctionNarrativeCallPriors; snippets: FunctionNarrativeSnippet[] }> {
  if (!plan.count) return { snippets: [] };
  const readings: FunctionCallReading[] = [], targets: FunctionNarrativeCallPriors["targets"] = [], limitations: string[][] = [], snippets = new Map<string, FunctionNarrativeSnippet>();
  let signature = "", sequence: FunctionNarrativeCallPriors["sequence"] = [];
  while (readings.length < plan.count) {
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    const context = await plan.context(readings.length, readings, signal), task = createCompleteFunctionCallNarrative(context, locale);
    if (!readings.length) { signature = task.sourceTask.signature; sequence = structuredClone(task.sourceTask.sequence); }
    else if (signature !== task.sourceTask.signature || JSON.stringify(sequence) !== JSON.stringify(task.sourceTask.sequence)) throw new FunctionNarrativeError("invalid-response");
    await assertCurrent(); const response = await generate(task.request, reply => { task.decode(reply.text); });
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    const chunk = task.decode(response.text); await assertCurrent();
    if (!chunk.calls.length || readings.length + chunk.calls.length > plan.count || task.sourceTask.includeSummary) throw new FunctionNarrativeError("invalid-response");
    targets.push(...task.sourceTask.targets); readings.push(...chunk.calls); limitations.push(chunk.limitations);
    for (const snippet of context.snippets.filter(row => row.role === "caller")) {
      const previous = snippets.get(snippet.id); if (previous && JSON.stringify(previous) !== JSON.stringify(snippet)) throw new FunctionNarrativeError("invalid-response");
      snippets.set(snippet.id, snippet);
    }
  }
  return { priors: { basis: "model-inference", signature, sequence, targets, readings, limitations }, snippets: [...snippets.values()] };
}
