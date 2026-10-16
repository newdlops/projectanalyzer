/** Project every captured declaration into source snippets; graph/file identities remain in the Host lease. */
import type { FunctionNarrativeContext, FunctionNarrativeSnippet } from "../../shared/functionNarratives";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import type { NarrativeSourceLease, NarrativeSourceEvidence } from "../../shared/narrativeSources";

/** Whole raw text shares its owned immutable string; neither source nor prior prose is shortened. */
export function createCapturedNarrativeContext(base: FunctionNarrativeContext, lease: NarrativeSourceLease, primaryId: string): {
  context: FunctionNarrativeContext; snippetIds: ReadonlyMap<string, string>;
} {
  const capture = lease.capture, primary = capture.declarations.find(declaration => declaration.id === primaryId);
  if (!primary) throw new FunctionNarrativeError("unavailable");
  const identities = new Map<string, string>([[primaryId, base.snippets.find(snippet => snippet.role === "function")?.id ?? "root"]]);
  const alias = (id: string): string => {
    let value = identities.get(id); if (!value) { value = "source-" + identities.size; identities.set(id, value); } return value;
  };
  const snippets: FunctionNarrativeSnippet[] = capture.declarations.map(declaration => ({ id: alias(declaration.id),
    role: declaration.id === primaryId ? "function" : "helper", startLine: declaration.range.startLine + 1,
    endLine: declaration.range.endLine + (declaration.range.endCharacter === 0 ? 0 : 1), text: declaration.text, truncated: false }));
  const relations: NarrativeSourceEvidence["relations"] = capture.edges.map(edge => ({ from: alias(edge.sourceId), to: alias(edge.targetId),
    kind: edge.kind, confidence: edge.confidence, ...(edge.range ? { range: { ...edge.range } } : {}) }));
  const edgeIndices = new Map(capture.edges.map((edge, index) => [edge.id, index]));
  const sourceEvidence: NarrativeSourceEvidence = {
    complete: capture.complete,
    declarations: capture.declarations.map(declaration => ({ snippetId: alias(declaration.id), name: declaration.name,
      kind: declaration.kind, language: declaration.language, range: { ...declaration.range }, graphRange: { ...declaration.graphNode.range },
      selectionRange: { ...declaration.graphNode.selectionRange }, depth: declaration.depth,
      ...(declaration.graphNode.parentId ? { parent: alias(declaration.graphNode.parentId) } : {}) })),
    relations,
    gaps: capture.gaps.map(gap => ({ ...(gap.from ? { from: alias(gap.from) } : {}), target: alias(gap.targetId), reason: gap.reason,
      ...(gap.edgeId && edgeIndices.has(gap.edgeId) ? { relation: edgeIndices.get(gap.edgeId) } : {}) })),
    analysisCaveats: capture.analysisCaveats.map(caveat => ({ declaration: alias(caveat.declarationId), code: caveat.code, message: caveat.message }))
  };
  const callers = base.snippets.filter(snippet => snippet.role === "caller");
  if (callers.some(snippet => snippet.truncated)) throw new FunctionNarrativeError("context-too-large");
  return { context: { ...base, functionName: primary.name, language: primary.language, snippets: [...snippets, ...callers],
    sourceEvidence, limited: base.limited || !capture.complete }, snippetIds: identities };
}
