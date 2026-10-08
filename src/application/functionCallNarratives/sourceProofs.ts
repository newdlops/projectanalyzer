/** Compact Host proof certificates across call batches; identity and snapshot checks prevent model-authored or borrowed evidence. */
import type { FunctionNarrativeContext, FunctionCallSourceProofHandle } from "../../shared/functionNarratives";
import type { SymbolNode } from "../../shared/types";
import { createContentHash } from "../../shared/hash";
import type { SourceCallSummaryProof } from "./sourceSummary";

type Certificate = { owner: string; calls: SourceCallSummaryProof[] };
// A handle contains no source or graph identities. Dropping the bounded Host
// reading allows its facts to be collected without a second persistent cache.
const certificates = new WeakMap<FunctionCallSourceProofHandle, Certificate>();

/** All batches must belong to the same caller source and unchanged route/structure, independently of model text. */
function ownerKey(context: FunctionNarrativeContext, parent: SymbolNode, source: string): string {
  const task = context.callTask!;
  return createContentHash(JSON.stringify([parent.id, createContentHash(source), task.scope, task.signature,
    task.sequence, task.conditions, task.routeStatus, task.terminal]));
}

/** Retain copied symbolic facts only; full callee source and the context's lazy reader are deliberately not captured. */
export function captureSourceCallProofs(context: FunctionNarrativeContext, parent: SymbolNode, source: string,
  calls: SourceCallSummaryProof[]): FunctionCallSourceProofHandle | undefined {
  if (!calls.length || calls.length > 2 || !context.callTask || context.callTask.includeSummary) return;
  const handle = Object.freeze({ kind: "function-call-source-proof" as const });
  certificates.set(handle, { owner: ownerKey(context, parent, source), calls: JSON.parse(JSON.stringify(calls)) });
  return handle;
}

/** Identity-only lookup, exact task ownership and complete ordered coverage reject forged, duplicate, missing or foreign batches. */
export function readSourceCallProofs(context: FunctionNarrativeContext, parent: SymbolNode, source: string): SourceCallSummaryProof[] | undefined {
  const task = context.callTask!, handles = context.sourceCallFlowProof?.batches;
  if (!handles?.length || handles.length > 4 || task.targets.length || task.sequence.length > 8) return;
  const owner = ownerKey(context, parent, source), calls: SourceCallSummaryProof[] = [];
  const visited = new Set<FunctionCallSourceProofHandle>();
  for (const handle of handles) {
    const certificate = certificates.get(handle);
    if (!certificate || certificate.owner !== owner || visited.has(handle)) return;
    visited.add(handle); calls.push(...certificate.calls);
  }
  if (calls.length !== task.sequence.length || calls.some((call, index) => call.target.callId !== task.sequence[index].callId
    || call.target.expression !== task.sequence[index].expression || call.target.callee !== task.sequence[index].callee)) return;
  return calls;
}
