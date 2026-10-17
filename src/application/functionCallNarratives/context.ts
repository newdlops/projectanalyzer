/** Whole caller/callee declarations and action-owned helper closure; identities remain Host-only. */
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionNarrativeContext, FunctionNarrativeSnippet } from "../../shared/functionNarratives";
import type { SymbolNode, SourceRange } from "../../shared/types";
import type { FunctionCallNarrativePlan } from "./plan";
import { readFunctionCallArguments, readFunctionCallSourceParameters, readFunctionCallSourceSyntax, createFunctionCallSourceReader } from "../../analyzer/functionCalls";
import type { FunctionCallNarrativeTarget } from "../../shared/functionCallNarratives";
import { attachFunctionCallSourceReading, type FunctionCallSourceCandidate } from "./sourceReading";
import { findFunctionAtPosition } from "../../analyzer/functionLogic";
import { createCapturedNarrativeContext, extractWholeSourceRange } from "../narrativeSources";
import type { NarrativeSourceLease } from "../../shared/narrativeSources";

/** Native graph extents may stop at the header; use the same declaration's parser-owned bounds. */
export function resolveFunctionCallDeclarationRange(node: SymbolNode, source: string): SourceRange {
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

/** Preserve exact CR/LF/UTF16 source for an acquired lease; standalone legacy callers retain their bounded API. */
function excerpt(id: string, role: FunctionNarrativeSnippet["role"], source: string, range: SourceRange,
  whole: boolean, budget: number, maximumLines: number): FunctionNarrativeSnippet | undefined {
  if (!whole) return legacyExcerpt(id, role, source, range, budget, maximumLines);
  const text = extractWholeSourceRange(source, range);
  if (!text) return undefined;
  return { id, role, startLine: range.startLine + 1, endLine: range.endLine + (range.endCharacter === 0 ? 0 : 1), text, truncated: false };
}

/** Compatibility for source-reading adapters without graph/file authority; this path cannot claim complete action sources. */
function legacyExcerpt(id: string, role: FunctionNarrativeSnippet["role"], source: string, range: SourceRange, budget: number, maximumLines: number): FunctionNarrativeSnippet | undefined {
  const end = range.endLine - (range.endCharacter === 0 ? 1 : 0);
  let cursor = 0;
  for (let line = 0; line < range.startLine; line++) { const newline = source.indexOf("\n", cursor); if (newline < 0) return undefined; cursor = newline + 1; }
  const chunks: string[] = []; let count = 0, last = range.startLine - 1, truncated = false;
  for (let line = range.startLine; line <= end && line < range.startLine + maximumLines; line++) {
    if (cursor >= source.length) break;
    const newline = source.indexOf("\n", cursor), stop = newline < 0 ? source.length : newline;
    const owned = source.slice(cursor, stop).replace(/\r$/u, "");
    const text = owned.slice(line === range.startLine ? range.startCharacter : 0, line === range.endLine ? range.endCharacter : undefined);
    const available = budget - count - (chunks.length ? 1 : 0); if (available <= 0) break;
    chunks.push(text.slice(0, available)); count += chunks.at(-1)!.length + (chunks.length > 1 ? 1 : 0); last = line;
    if (text.length > available) { truncated = true; break; }
    if (newline < 0) break; cursor = newline + 1;
  }
  return chunks.length ? { id, role, startLine: range.startLine + 1, endLine: last + 1, text: chunks.join("\n"), truncated: truncated || last < end } : undefined;
}

/** Two output targets per chunk; all captured source and prior facts remain available. */
export async function buildFunctionCallNarrativeContext(parent: SymbolNode, source: string, slice: FunctionCallsResponse, plan: FunctionCallNarrativePlan, offset: number,
  readCallee: (token: string) => Promise<{ node: SymbolNode; source: string } | undefined>,
  callerRange: (token: string) => SourceRange | undefined, sourceLease?: NarrativeSourceLease, primarySnippetId = "parent"): Promise<FunctionNarrativeContext> {
  const parentRange = sourceLease?.capture.declarations.find(declaration => declaration.id === parent.id)?.range;
  const snippets: FunctionNarrativeSnippet[] = [], root = excerpt(primarySnippetId, "function", source, parentRange ?? resolveFunctionCallDeclarationRange(parent, source), Boolean(sourceLease), 4200, 100);
  if (root) snippets.push(root);
  let limited = plan.facts.sourceLimited || !root || Boolean(root.truncated);
  const names = new Map(slice.nodes.map(node => [node.id, node]));
  const targets: FunctionCallNarrativeTarget[] = [];
  const candidates: FunctionCallSourceCandidate[] = [];
  const targetOwners = new Map<string, string>();
  let callerSyntax: ReturnType<typeof createFunctionCallSourceReader> | undefined;
  for (const row of plan.rows.slice(offset, offset + 2)) {
    const connection = row.connection, target = names.get(connection.to);
    const range = connection.evidenceToken && callerRange(connection.evidenceToken);
    const caller = range && excerpt(row.callId + "-caller", "caller", source, range, Boolean(sourceLease), 600, 12);
    if (caller) snippets.push(caller);
    const callee = target?.sourceToken ? await readCallee(target.sourceToken) : undefined;
    const captured = callee && sourceLease?.capture.declarations.find(declaration => declaration.id === callee.node.id);
    const helper = callee && (!sourceLease || captured) && excerpt(row.callId + "-callee", "helper", callee.source,
      captured?.range ?? resolveFunctionCallDeclarationRange(callee.node, callee.source), Boolean(sourceLease), 1800, 60);
    if (helper) snippets.push(helper);
    const sourceLimited = connection.limited || !caller || caller.truncated || !helper || helper.truncated;
    const guards = connection.guards.map(guard => ({ expression: guard.expression, outcome: guard.outcome }));
    const loops = [...connection.loops];
    limited ||= sourceLimited;
    targets.push({ callId: row.callId, caller: parent.name, callee: target?.name ?? "unknown",
      ...(callee?.node.kind === "method" ? { sourceKind: "method" as const } : {}),
      language: callee?.node.language ?? parent.language, expression: row.expression,
      relation: connection.relation, confidence: connection.confidence, guards, loops,
      deferred: connection.deferred || connection.relation !== "call", callerSnippet: caller?.id, calleeSnippet: helper?.id, sourceLimited: Boolean(sourceLimited) });
    if (callee && helper) targetOwners.set(row.callId, callee.node.id);
    if(range&&connection.relation==="call")targets.at(-1)!.arguments=readFunctionCallArguments(parent.language,source,parent.filePath,range);
    const arguments_ = targets.at(-1)!.arguments;
    if (callee && helper && !sourceLimited && !helper.truncated && connection.relation === "call" && !connection.deferred
      && arguments_?.length && !arguments_.some(argument => /^(?:\.\.\.|\*)|=/u.test(argument))) {
      // The Host supplies this declaration evidence before the source reader
      // fingerprints its targets; model prose cannot create or replace it.
      const parameters = readFunctionCallSourceParameters(callee.node, callee.source);
      if (parameters?.length === arguments_.length) targets.at(-1)!.parameters = parameters;
    }
    if (callee && helper && !helper.truncated) {
      // Add syntax anchors only from this provided declaration. They do not
      // repair CFG cleanup routing or turn a catch statement into an observed
      // result. A limited list stays explicitly limited; source caps are intact.
      const syntax = readFunctionCallSourceSyntax(callee.node, callee.source);
      if (syntax?.returns.sites.every(site => helper.text.includes(site.code))) targets.at(-1)!.returnSyntax = syntax.returns;
      if (syntax?.effects.sites.every(site => helper.text.includes(site.code))) targets.at(-1)!.effectSyntax = syntax.effects;
    }
    if (caller && !caller.truncated && range && connection.relation === "call" && !connection.deferred) {
      callerSyntax ??= createFunctionCallSourceReader(parent, source);
      const use = callerSyntax.readUse(range, row.expression);
      if (use) targets.at(-1)!.resultUse = use;
    }
    candidates.push({ target: targets.at(-1)!, callerRange: range || undefined, callee });
  }
  let context: FunctionNarrativeContext = { functionName: parent.name, language: parent.language, snippets, limited: Boolean(limited),
    callTask: { ...plan.facts, includeSummary: offset === 0, sourceLimited: Boolean(limited), targets } };
  if (sourceLease) {
    const captured = createCapturedNarrativeContext(context, sourceLease, parent.id); context = captured.context;
    for (const target of targets) {
      const owner = targetOwners.get(target.callId); if (owner) target.calleeSnippet = captured.snippetIds.get(owner);
    }
    context.callTask!.sourceLimited ||= !sourceLease.capture.complete;
  }
  if (!sourceLease) attachFunctionCallSourceReading(context, parent, source, candidates);
  return context;
}
