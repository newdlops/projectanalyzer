/** Parser-owned full callable extent and independent direct-call coverage. */
import { analyzeFunctionLogic, findFunctionAtPosition } from "../../analyzer/functionLogic";
import { readTypeScriptSourceCalls, type SourceCallEvidence } from "../../analyzer/sourceEvidence";
import { SourceCaptureError } from "../../shared/narrativeSources";
import type { SourceRange, SymbolNode } from "../../shared/types";

/** Parser facts remain source-only; no source program or model is executed. */
export type WholeDeclarationSource = {
  range: SourceRange;
  callsites: SourceCallEvidence[];
  limited: boolean;
  caveats: Array<{ code: string; message: string }>;
};
export type SourceDeclarationResolver = (node: SymbolNode, source: string) => WholeDeclarationSource | undefined;

/** Reject mismatched/header-only fallback instead of calling it a whole body. */
export const readWholeCallableSource: SourceDeclarationResolver = (node, source) => {
  if (!["function", "method", "constructor"].includes(node.kind)) return undefined;
  try {
    const target = findFunctionAtPosition({ filePath: node.filePath, languageId: node.language, sourceText: source,
      position: { line: node.selectionRange.startLine, character: node.selectionRange.startCharacter } });
    if (!target || target.name !== node.name || target.kind !== node.kind
      || target.selectionRange.startLine !== node.selectionRange.startLine
      || target.selectionRange.startCharacter !== node.selectionRange.startCharacter) return undefined;
    // Direct callsite discovery precedes the bounded statement projection in
    // existing analyzers. Its full positions detect missing graph call edges.
    const analysis = analyzeFunctionLogic({ functionNode: { ...node, range: target.range }, sourceText: source, maxBlocks: 1 });
    // Projection/CFG caveats are retained separately. Whole source coverage
    // depends on actual source/parser availability and all callsite positions.
    const limited = analysis.gaps.some((gap) => ["languageUnsupported", "sourceUnavailable", "functionNotFound"].includes(gap.code)
      || gap.presentation?.key === "logic-gap-parser-recovered");
    const isTypeScript = ["typescript", "typescriptreact", "javascript", "javascriptreact"].includes(node.language);
    const typescript = isTypeScript
      ? readTypeScriptSourceCalls(node, source, target.range, { maxNodes: 500_000, maxDepth: 1024 }) : undefined;
    if (isTypeScript && !typescript) return undefined;
    const callsites = typescript?.calls ?? analysis.callsites.map((site) => ({ range: site.range, evidenceRanges: [site.range] }));
    // Render/event/embedded relations retain their source position and remain
    // unresolved unless the graph supplies matching evidence for that relation.
    for (const site of analysis.callsites) if (!callsites.some((call) => JSON.stringify(call.range) === JSON.stringify(site.range))) {
      callsites.push({ range: site.range, evidenceRanges: [site.range] });
    }
    return { range: target.range, callsites, limited: limited || Boolean(typescript?.limited),
      caveats: analysis.gaps.map(({ code, message }) => ({ code, message })) };
  } catch (error) { if (error instanceof SourceCaptureError) throw error; return undefined; }
};
