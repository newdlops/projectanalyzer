/** Bounded caller/callee source selection; absolute paths and graph identities never reach a model. */
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionNarrativeContext, FunctionNarrativeSnippet } from "../../shared/functionNarratives";
import type { SymbolNode, SourceRange } from "../../shared/types";
import type { FunctionCallNarrativePlan } from "./plan";
import { readFunctionCallArguments } from "../../analyzer/functionCalls";
import type { FunctionCallNarrativeTarget } from "../../shared/functionCallNarratives";
import { attachFunctionCallSourceReading, type FunctionCallSourceCandidate } from "./sourceReading";
import { findFunctionAtPosition } from "../../analyzer/functionLogic";

/** Native graph extents may stop at the header; use the same declaration's parser-owned bounds. */
function declarationRange(node: SymbolNode, source: string): SourceRange {
  try {
    const target = findFunctionAtPosition({ filePath: node.filePath, languageId: node.language, sourceText: source,
      position: { line: node.selectionRange.startLine, character: node.selectionRange.startCharacter } });
    return target?.name === node.name && target.kind === node.kind
      && target.selectionRange.startLine === node.selectionRange.startLine
      && target.selectionRange.startCharacter === node.selectionRange.startCharacter ? target.range : node.range;
  } catch {
    // An unavailable parser must retain the existing bounded model context.
    return node.range;
  }
}

/** Slices declaration-owned lines, preserving original positions and explicit truncation. */
function excerpt(id: string, role: FunctionNarrativeSnippet["role"], source: string, range: SourceRange, budget: number, lineLimit: number): FunctionNarrativeSnippet | undefined {
  const end = range.endLine - (range.endCharacter === 0 ? 1 : 0);
  // Scan newline offsets without allocating an array containing the entire
  // file for every root/call/callee excerpt in a long-running interpretation.
  let cursor = 0;
  for (let line = 0; line < range.startLine; line++) { const newline = source.indexOf("\n", cursor); if (newline < 0) return undefined; cursor = newline + 1; }
  const chunks: string[] = []; let count = 0, last = range.startLine - 1, truncated = false;
  for (let line = range.startLine; line <= end && line < range.startLine + lineLimit; line += 1) {
    if (cursor >= source.length) break;
    const newline = source.indexOf("\n", cursor), stop = newline < 0 ? source.length : newline;
    const owned = source.slice(cursor, stop).replace(/\r$/u, "");
    const text = owned.slice(line === range.startLine ? range.startCharacter : 0, line === range.endLine ? range.endCharacter : undefined);
    const available = budget - count - (chunks.length ? 1 : 0);
    if (available <= 0) break;
    chunks.push(text.slice(0, available)); count += chunks.at(-1)!.length + (chunks.length > 1 ? 1 : 0); last = line;
    if (text.length > available) { truncated = true; break; }
    if (newline < 0) break;
    cursor = newline + 1;
  }
  if (!chunks.length) return undefined;
  return { id, role, startLine: range.startLine + 1, endLine: last + 1, text: chunks.join("\n"), truncated: truncated || last < end };
}

/** At most two source sites/targets per request, within five snippets and unchanged model limits. */
export async function buildFunctionCallNarrativeContext(parent: SymbolNode, source: string, slice: FunctionCallsResponse, plan: FunctionCallNarrativePlan, offset: number,
  readCallee: (token: string) => Promise<{ node: SymbolNode; source: string } | undefined>,
  callerRange: (token: string) => SourceRange | undefined): Promise<FunctionNarrativeContext> {
  const snippets: FunctionNarrativeSnippet[] = [], root = excerpt("parent", "function", source, declarationRange(parent, source), 4200, 100);
  if (root) snippets.push(root);
  let limited = plan.facts.sourceLimited || !root || Boolean(root.truncated);
  const names = new Map(slice.nodes.map(node => [node.id, node]));
  const targets: FunctionCallNarrativeTarget[] = [];
  const candidates: FunctionCallSourceCandidate[] = [];
  for (const row of plan.rows.slice(offset, offset + 2)) {
    const connection = row.connection, target = names.get(connection.to);
    const range = connection.evidenceToken && callerRange(connection.evidenceToken);
    const caller = range && excerpt(row.callId + "-caller", "caller", source, range, 600, 12);
    if (caller) snippets.push(caller);
    const callee = target?.sourceToken ? await readCallee(target.sourceToken) : undefined;
    const helper = callee && excerpt(row.callId + "-callee", "helper", callee.source, declarationRange(callee.node, callee.source), 1800, 60);
    if (helper) snippets.push(helper);
    const sourceLimited = connection.limited || !caller || caller.truncated || !helper || helper.truncated;
    const guards = connection.guards.slice(0, 6).map(guard => ({ expression: guard.expression.slice(0, 240), outcome: guard.outcome.slice(0, 120) }));
    const loops = connection.loops.slice(0, 4).map(loop => loop.slice(0, 240));
    const factsLimited = guards.length !== connection.guards.length || loops.length !== connection.loops.length
      || connection.guards.some(guard => guard.expression.length > 240 || guard.outcome.length > 120) || connection.loops.some(loop => loop.length > 240);
    limited ||= sourceLimited || factsLimited;
    targets.push({ callId: row.callId, caller: parent.name.slice(0, 240), callee: (target?.name ?? "unknown").slice(0, 240),
      language: callee?.node.language ?? parent.language, expression: row.expression.slice(0, 1200),
      relation: connection.relation, confidence: connection.confidence, guards, loops,
      deferred: connection.deferred || connection.relation !== "call", callerSnippet: caller?.id, calleeSnippet: helper?.id, sourceLimited: Boolean(sourceLimited || factsLimited) });
    if(range&&connection.relation==="call")targets.at(-1)!.arguments=readFunctionCallArguments(parent.language,source,parent.filePath,range);
    candidates.push({ target: targets.at(-1)!, callerRange: range || undefined, callee });
  }
  const context: FunctionNarrativeContext = { functionName: parent.name.slice(0, 240), language: parent.language, snippets, limited: Boolean(limited),
    callTask: { ...plan.facts, includeSummary: offset === 0, sourceLimited: Boolean(limited), targets } };
  attachFunctionCallSourceReading(context, parent, source, candidates);
  return context;
}
