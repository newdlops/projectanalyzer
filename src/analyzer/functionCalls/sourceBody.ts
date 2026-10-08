/** Complete bounded callee paths with primitive local changes and conditional returns; exact syntax only, without source execution. */
import type { SymbolNode } from "../../shared/types";
import { analyzeFunctionLogic } from "../functionLogic";
import { analyzeFunctionTutorDeclaration } from "../functionTutor";
import { readFunctionCallSourceExpression, readFunctionCallSourceRange } from "./sourceSyntax";

/** Keys distinguish equal text at different source statements; they remain inside Host proof storage. */
export type FunctionCallSourceBodyStep = { key: string; kind: "change" | "condition" | "return"; source: string; outcome?: "true" | "false" };
export type FunctionCallSourceBodyFacts = { parameters: string[]; parameterTypes: string[]; returnExpression: string; returnSource: string;
  /** Absent for the established single-return leaf; every extended path retains all steps in order. */
  bodyPaths?: FunctionCallSourceBodyStep[][] };
type Route = { current: string; visited: Set<string>; names: Set<string>; mutable: Set<string>; steps: FunctionCallSourceBodyStep[]; returned: boolean };
const identifier = "[\\p{L}_$][\\p{L}\\p{N}_$]*";

/** A complete acyclic CFG, closed lexical expressions and full statement coverage certify all represented source paths. */
export function readFunctionCallSourceBody(callee: SymbolNode, source: string, maxDepth = 32): FunctionCallSourceBodyFacts | undefined {
  // Callers may lower the traversal depth, never raise the closed proof budget.
  const depthLimit = Number.isFinite(maxDepth) ? Math.max(1, Math.min(32, Math.floor(maxDepth))) : 32;
  const logic = analyzeFunctionLogic({ functionNode: callee, sourceText: source, maxBlocks: 32 });
  if (logic.callsites.length || logic.blocks.some(block => block.confidence !== "exact"
    || !["entry", "exit", "mutation", "condition", "return"].includes(block.kind))
    || logic.gaps.some(gap => !["parseLimited", "dynamicBehavior"].includes(gap.code))) return;
  const tutor = analyzeFunctionTutorDeclaration({ functionNode: callee, sourceText: source, functionLogic: logic });
  if (tutor.executionKind !== "sync" || tutor.inputSummarySafe === false || tutor.parameters.length > 8
    || tutor.parameters.some(p => p.rest || p.optional || p.defaultValue !== undefined || p.callingMode !== "positional"
      || !/^(?:number|boolean|string|Int|Double|Boolean|String)$/u.test(p.typeText ?? ""))
    || tutor.gaps.some(gap => gap.kind !== "language-support")) return;
  const declaration = readFunctionCallSourceRange(source, logic.sourceRange ?? callee.range);
  if (!declaration || declaration.length > 1800 || /\b(?:suspend|inline|operator|external|expect)\b/u.test(declaration)) return;
  const entry = logic.blocks.find(block => block.kind === "entry"); if (!entry) return;
  const blocks = new Map(logic.blocks.map(block => [block.id, block])), outgoing = new Map<string, typeof logic.edges>();
  for (const edge of logic.edges) {
    if (edge.confidence !== "exact" || !["next", "true", "false", "return"].includes(edge.kind)
      || !blocks.has(edge.sourceId) || !blocks.has(edge.targetId)) return;
    const edges = outgoing.get(edge.sourceId) ?? []; edges.push(edge); outgoing.set(edge.sourceId, edges);
  }
  const parameters = tutor.parameters.map(p => p.name), covered = new Set<string>(), paths: FunctionCallSourceBodyStep[][] = [];
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
      const expression = readFunctionCallSourceExpression(raw.replace(/^return\s+/u, "").replace(/;\s*$/u, "").trim(), route.names);
      if (expression === undefined || edges.length !== 1 || edges[0].kind !== "return") return;
      firstReturn ??= { expression, source: raw };
      route.steps.push({ key: block.id, kind: "return", source: expression }); route.returned = true;
    } else if (block.kind === "mutation") {
      if (!raw || callee.language === "kotlin" && raw.includes("$")) return;
      const statement = raw.replace(/;\s*$/u, "");
      const declaration = new RegExp("^(const|let|val|var)\\s+(" + identifier + ")(?:\\s*:\\s*(?:number|boolean|string|Int|Double|Boolean|String))?\\s*=\\s*([\\s\\S]+)$", "u").exec(statement);
      const assignment = new RegExp("^(" + identifier + ")\\s*([+*/%-]?=)\\s*([\\s\\S]+)$", "u").exec(statement);
      const name = declaration?.[2] ?? assignment?.[1], value = declaration?.[3] ?? assignment?.[3];
      // Parameter/captured/member writes and writes to immutable locals are outside this primitive local contract.
      if (!name || !value || declaration && route.names.has(name) || !declaration && !route.mutable.has(name)
        || readFunctionCallSourceExpression(value, route.names) === undefined) return;
      if (declaration) { route.names.add(name); if (["let", "var"].includes(declaration[1])) route.mutable.add(name); }
      route.steps.push({ key: block.id, kind: "change", source: statement });
    } else if (block.kind === "condition") {
      const predicate = block.condition?.expression;
      if (!predicate || callee.language === "kotlin" && predicate.includes("$")
        || readFunctionCallSourceExpression(predicate, route.names) === undefined || edges.length !== 2
        || !edges.some(edge => edge.kind === "true") || !edges.some(edge => edge.kind === "false")) return;
      for (const edge of edges) queue.push({ current: edge.targetId, visited: new Set(route.visited), names: new Set(route.names),
        mutable: new Set(route.mutable), returned: false, steps: [...route.steps,
          { key: block.id, kind: "condition", source: predicate, outcome: edge.kind as "true" | "false" }] });
      continue;
    } else if (block.kind !== "entry") return;
    if (edges.length !== 1 || !["next", "return"].includes(edges[0].kind)) return;
    queue.push({ ...route, current: edges[0].targetId });
  }
  if (!firstReturn || !paths.length || covered.size !== blocks.size) return;
  return { parameters, parameterTypes: tutor.parameters.map(p => p.typeText!), returnExpression: firstReturn.expression,
    returnSource: firstReturn.source, ...(paths.length === 1 && paths[0].length === 1 ? {} : { bodyPaths: paths }) };
}
