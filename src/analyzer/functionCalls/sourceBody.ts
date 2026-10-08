/** Complete bounded callee syntax paths: local changes, conditional returns and opaque call values with explicit normal-return assumptions. */
import type { SymbolNode } from "../../shared/types";
import { analyzeFunctionLogic } from "../functionLogic";
import { analyzeFunctionTutorDeclaration } from "../functionTutor";
import { readFunctionCallSourceRange } from "./sourceSyntax";
import { createFunctionCallSourceValueReader } from "./sourceCallValues";
import { readFunctionCallSourceDeclaredParameters } from "./sourceParameters";
import { readFunctionCallSourceExecution, type FunctionCallSourceExecution } from "./sourceExecution";

/** Keys distinguish equal text at different source statements; they remain inside Host proof storage. */
export type FunctionCallSourceBodyStep = { key: string; kind: "change" | "condition" | "return" | "call"; source: string; outcome?: "true" | "false";
  /** Exact nested invocations in source evaluation order; results/types/effects remain unreviewed. */
  calls?: string[];
  /** Source member paths have unknown getter/receiver/state behavior and never become primitive proof. */
  accesses?: string[];
  /** Inferred receiver dispatch remains inferred even when its invocation syntax is fully matched. */
  inferredCalls?: string[];
  /** Captured/module/external bindings retain source names while all values and effects stay unknown. */
  externalReads?: string[];
  /** Syntactic await occurrences; completion, rejection and timing are not evaluated. */
  awaits?: number };
export type FunctionCallSourceBodyFacts = { parameters: string[]; parameterTypes: string[]; returnExpression: string; returnSource: string;
  /** Candidate method syntax never proves receiver identity, dispatch or primitive evaluation safety. */
  methodSource?: true;
  /** Retains Promise/suspend return semantics even for a primitive-looking body. */
  execution?: Exclude<FunctionCallSourceExecution, "sync">;
  /** Declared reference/other types describe syntax, not known runtime values or safe primitive operands. */
  opaqueParameters?: string[];
  /** Absent for the established single-return leaf; every extended path retains all steps in order. */
  bodyPaths?: FunctionCallSourceBodyStep[][] };
type Route = { current: string; visited: Set<string>; names: Set<string>; mutable: Set<string>; steps: FunctionCallSourceBodyStep[]; returned: boolean };
const identifier = "[\\p{L}_$][\\p{L}\\p{N}_$]*";

/** A complete acyclic CFG and full expression/callsite coverage certify source syntax, never unknown call results or runtime effects. */
export function readFunctionCallSourceBody(callee: SymbolNode, source: string, maxDepth = 32): FunctionCallSourceBodyFacts | undefined {
  // Callers may lower the traversal depth, never raise the closed proof budget.
  const depthLimit = Number.isFinite(maxDepth) ? Math.max(1, Math.min(32, Math.floor(maxDepth))) : 32;
  const logic = analyzeFunctionLogic({ functionNode: callee, sourceText: source, maxBlocks: 32 });
  if (logic.blocks.some(block => block.confidence !== "exact"
    || !["entry", "exit", "mutation", "condition", "return", "call"].includes(block.kind))
    || logic.gaps.some(gap => !["parseLimited", "dynamicBehavior"].includes(gap.code))) return;
  const tutor = analyzeFunctionTutorDeclaration({ functionNode: callee, sourceText: source, functionLogic: logic });
  const methodSource = callee.kind === "method";
  const execution = readFunctionCallSourceExecution(tutor, logic.signature);
  // The concrete Tutor intentionally cannot evaluate a standalone await.
  // Its unrelated body gap cannot hide an exact formal declaration: the closed
  // CFG/expression pass below independently covers every operation and call.
  const declared = readFunctionCallSourceDeclaredParameters(tutor, { sourceOnlyMethod: methodSource, allowBodyGaps: execution === "promise" });
  if (!execution || !declared) return;
  const declaration = readFunctionCallSourceRange(source, logic.sourceRange ?? callee.range);
  if (!declaration || declaration.length > 1800) return;
  const entry = logic.blocks.find(block => block.kind === "entry"); if (!entry) return;
  const blocks = new Map(logic.blocks.map(block => [block.id, block])), outgoing = new Map<string, typeof logic.edges>();
  for (const edge of logic.edges) {
    if (edge.confidence !== "exact" || !["next", "true", "false", "return"].includes(edge.kind)
      || !blocks.has(edge.sourceId) || !blocks.has(edge.targetId)) return;
    const edges = outgoing.get(edge.sourceId) ?? []; edges.push(edge); outgoing.set(edge.sourceId, edges);
  }
  const parameters = tutor.parameters.map(p => p.name), covered = new Set<string>(), paths: FunctionCallSourceBodyStep[][] = [];
  const calls = new Set<typeof logic.callsites[number]>();
  const readValue = createFunctionCallSourceValueReader(callee, source, logic, execution);
  const queue: Route[] = [{ current: entry.id, visited: new Set(), names: new Set(parameters), mutable: new Set(), steps: [], returned: false }];
  let firstReturn: { expression: string; source: string } | undefined;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    if (cursor >= 128 || queue.length > 128 || paths.length >= 4) return;
    const route = queue[cursor], block = blocks.get(route.current);
    if (!block || route.visited.has(block.id) || route.visited.size >= depthLimit) return;
    route.visited.add(block.id); covered.add(block.id);
    const edges = outgoing.get(block.id) ?? [];
    if (block.kind === "exit") {
      if (!route.returned || edges.length) return;
      paths.push(route.steps); continue;
    }
    if (route.returned) return;
    const raw = readFunctionCallSourceRange(source, block.range)?.trim();
    if (block.kind === "return") {
      if (!raw || !/^return\s+/u.test(raw) || callee.language === "kotlin" && raw.includes("$")) return;
      const value = readValue(raw.replace(/^return\s+/u, "").replace(/;\s*$/u, "").trim(), block, route.names);
      if (!value || edges.length !== 1 || edges[0].kind !== "return") return;
      value.sites.forEach(site => calls.add(site));
      firstReturn ??= { expression: value.expression, source: raw };
      route.steps.push({ key: block.id, kind: "return", source: value.expression, ...(value.calls.length ? { calls: value.calls } : {}),
        ...(value.accesses?.length ? { accesses: value.accesses } : {}), ...(value.inferredCalls?.length ? { inferredCalls: value.inferredCalls } : {}),
        ...(value.externalReads?.length ? { externalReads: value.externalReads } : {}), ...(value.awaits ? { awaits: value.awaits } : {}) }); route.returned = true;
    } else if (block.kind === "mutation") {
      if (!raw || callee.language === "kotlin" && raw.includes("$")) return;
      const statement = raw.replace(/;\s*$/u, "");
      const declaration = new RegExp("^(const|let|val|var)\\s+(" + identifier + ")(?:\\s*:\\s*(?:number|boolean|string|Int|Double|Boolean|String))?\\s*=\\s*([\\s\\S]+)$", "u").exec(statement);
      const assignment = new RegExp("^(" + identifier + ")\\s*([+*/%-]?=)\\s*([\\s\\S]+)$", "u").exec(statement);
      const name = declaration?.[2] ?? assignment?.[1], value = declaration?.[3] ?? assignment?.[3];
      // Parameter/captured/member writes and writes to immutable locals are outside this primitive local contract.
      if (!name || !value || declaration && route.names.has(name) || !declaration && !route.mutable.has(name)) return;
      const result = readValue(value.trim(), block, route.names); if (!result) return;
      result.sites.forEach(site => calls.add(site));
      if (declaration) { route.names.add(name); if (["let", "var"].includes(declaration[1])) route.mutable.add(name); }
      route.steps.push({ key: block.id, kind: "change", source: statement, ...(result.calls.length ? { calls: result.calls } : {}),
        ...(result.accesses?.length ? { accesses: result.accesses } : {}), ...(result.inferredCalls?.length ? { inferredCalls: result.inferredCalls } : {}),
        ...(result.externalReads?.length ? { externalReads: result.externalReads } : {}), ...(result.awaits ? { awaits: result.awaits } : {}) });
    } else if (block.kind === "call") {
      // An ignored invocation has source syntax, not a proved implementation.
      const statement = raw?.replace(/;\s*$/u, "");
      const value = statement && readValue(statement, block, route.names);
      const awaitedInvocation = execution === "promise" && /^await\s+/u.test(statement ?? "")
        ? statement!.replace(/^await\s+/u, "").trim() : undefined;
      if (!value || !value.calls.length || value.calls.at(-1) !== statement && value.calls.at(-1) !== awaitedInvocation) return;
      value.sites.forEach(site => calls.add(site));
      route.steps.push({ key: block.id, kind: "call", source: statement!, calls: value.calls,
        ...(value.accesses?.length ? { accesses: value.accesses } : {}), ...(value.inferredCalls?.length ? { inferredCalls: value.inferredCalls } : {}),
        ...(value.externalReads?.length ? { externalReads: value.externalReads } : {}), ...(value.awaits ? { awaits: value.awaits } : {}) });
    } else if (block.kind === "condition") {
      const predicate = block.condition?.expression;
      const value = predicate && readValue(predicate, block, route.names);
      if (!value || edges.length !== 2
        || !edges.some(edge => edge.kind === "true") || !edges.some(edge => edge.kind === "false")) return;
      value.sites.forEach(site => calls.add(site));
      for (const edge of edges) queue.push({ current: edge.targetId, visited: new Set(route.visited), names: new Set(route.names),
        mutable: new Set(route.mutable), returned: false, steps: [...route.steps,
          { key: block.id, kind: "condition", source: predicate!, outcome: edge.kind as "true" | "false", ...(value.calls.length ? { calls: value.calls } : {}),
            ...(value.accesses?.length ? { accesses: value.accesses } : {}), ...(value.inferredCalls?.length ? { inferredCalls: value.inferredCalls } : {}),
            ...(value.externalReads?.length ? { externalReads: value.externalReads } : {}), ...(value.awaits ? { awaits: value.awaits } : {}) }] });
      continue;
    } else if (block.kind !== "entry") return;
    if (edges.length !== 1 || !["next", "return"].includes(edges[0].kind)) return;
    queue.push({ ...route, current: edges[0].targetId });
  }
  if (!firstReturn || !paths.length || covered.size !== blocks.size || calls.size !== logic.callsites.length) return;
  return { parameters, parameterTypes: declared.parameters.map(parameter => parameter.type), returnExpression: firstReturn.expression,
    ...(methodSource ? { methodSource: true } : {}),
    ...(execution !== "sync" ? { execution } : {}),
    ...(declared.opaqueParameters.length ? { opaqueParameters: declared.opaqueParameters } : {}),
    // Even an opaque identity return must retain uncertainty and cannot enter
    // the legacy primitive leaf/guarded recipe by dropping its body paths.
    returnSource: firstReturn.source, ...(paths.length === 1 && paths[0].length === 1 && execution === "sync" && !methodSource && !declared.opaqueParameters.length
      && !paths[0][0].calls?.length && !paths[0][0].accesses?.length && !paths[0][0].externalReads?.length ? {} : { bodyPaths: paths }) };
}
