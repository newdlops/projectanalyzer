/** Compiles source-resolved, effect-free synchronous helpers into bounded expression summaries. */
import type { FunctionTutorDeclarationAnalysis as Declaration, FunctionTutorExpression as Expression, FunctionTutorProgramBlock } from "../types";

export type FunctionTutorInputProgramContext = {
  declarations: Declaration[];
  links: Array<{ callerProgramId: string; calleeProgramId?: string; callStartLine: number; callStartCharacter: number }>;
};
type Summary = { declaration: Declaration; value: Expression; depth: number };
const compiled = new WeakMap<Declaration, Declaration>();
const unavailable: Expression = { kind: "unsupported", reason: "unsupported-expression", summary: "Unresolved or effectful helper" };

/** Snapshot identity is the cache key; edited source produces a new declaration and summaries. */
export function compileFunctionTutorInputDeclaration(root: Declaration, context?: FunctionTutorInputProgramContext): Declaration {
  if (!context && compiled.has(root)) return compiled.get(root)!;
  const catalog = root.scenarioCatalog;
  const declarations = context?.declarations ?? [root, ...(catalog?.programs.filter((item) => item.invocationRole === "function").map((item) => item.declaration) ?? [])];
  const links = context?.links ?? (catalog?.resolutions.filter((item) => item.invocationRole === "function" && !item.requiresAwait).map((item) => ({
    callerProgramId: item.callerId, calleeProgramId: item.targetId, callStartLine: item.range.startLine, callStartCharacter: item.range.startCharacter
  })) ?? []);
  const targets = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const link of links.slice(0, 96)) {
    const key = callKey(link.callerProgramId, link.callStartLine, link.callStartCharacter);
    if (!link.calleeProgramId || ambiguous.has(key)) continue;
    if (targets.has(key) && targets.get(key) !== link.calleeProgramId) { targets.delete(key); ambiguous.add(key); }
    else targets.set(key, link.calleeProgramId);
  }
  const summaries = new Map<string, Summary>();
  // Bottom-up passes replace recursive dispatch. Cycles cannot acquire a summary;
  // maximum call depth, source blocks and expression frames remain independent budgets.
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const declaration of declarations.slice(0, 12)) {
      const id = declaration.functionNode.id;
      if (id === root.functionNode.id || summaries.has(id)) continue;
      let depth = 1;
      const value = summarize(declaration, (expression, environment) => rewrite(expression, environment, id, summaries, targets,
        (calleeDepth) => { depth = Math.max(depth, calleeDepth + 1); }));
      if (value && depth <= 4) { summaries.set(id, { declaration, value, depth }); changed = true; }
    }
    if (!changed) break;
  }
  const blocks = root.program.blocks.map((block) => rewriteBlock(block, (expression) => rewrite(expression, undefined, root.functionNode.id, summaries, targets)));
  const result = { ...root, program: { ...root.program, blocks } };
  if (!context) compiled.set(root, result);
  return result;
}

/** Each explored CFG path owns its bindings and visited set; unknown effects invalidate the helper. */
function summarize(declaration: Declaration, expand: (expression: Expression, environment: Map<string, Expression>) => Expression): Expression | undefined {
  if (declaration.inputSummarySafe === false || declaration.executionKind !== "sync" || !["typescript", "javascript"].includes(declaration.language)
    || declaration.program.blocks.length > 64 || declaration.parameters.some((item) => item.rest || !item.bindingId
      // The adapter retains source evidence when a nonliteral initializer has
      // no static value. Treating that as an absent default would erase effects
      // or certify undefined instead of its derived runtime value.
      || item.declarationEvidence.some((evidence) => evidence.kind === "parameter-default" && evidence.certainty !== "exact"))) return;
  const blocks = new Map(declaration.program.blocks.map((block) => [block.blockId, block]));
  const outgoing = new Map<string, typeof declaration.program.edges>();
  for (const edge of declaration.program.edges) {
    if (["defines", "deferred", "exception"].includes(edge.kind)) continue;
    const list = outgoing.get(edge.sourceBlockId) ?? []; list.push(edge); outgoing.set(edge.sourceBlockId, list);
  }
  const environment = new Map(declaration.parameters.map((parameter) => [parameter.bindingId!, { kind: "binding", bindingId: parameter.bindingId! } as Expression]));
  const pending = [{ id: declaration.program.entryBlockId, environment, predicates: [] as Expression[], checks: [] as Expression[], visited: new Set<string>() }];
  const returns: Array<{ condition: Expression; value: Expression }> = [];
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    if (cursor >= 128 || pending.length > 128) return;
    const path = pending[cursor]; const block = blocks.get(path.id);
    if (!block || path.visited.has(path.id) || path.visited.size >= 24 || ["try", "catch", "finally", "loop", "call", "effect"].includes(block.kind)
      || declaration.gaps.some((gap) => gap.blockId === path.id && gap.kind === "unsupported-expression")) return;
    const visited = new Set([...path.visited, path.id]);
    const bindings = new Map(path.environment); const checks = path.checks.slice();
    for (const operation of block.operations) {
      if (operation.kind === "define") {
        const value = expand(operation.value, bindings); if (!isSupported(value, declaration)) return;
        bindings.set(operation.bindingId, value); checks.push(value);
      } else if ((operation.kind === "assign" || operation.kind === "increment") && operation.target.kind === "binding") {
        const previous = bindings.get(operation.target.bindingId); if (!previous) return;
        const next: Expression = operation.kind === "increment" ? { kind: "binary", operator: "add", left: previous, right: { kind: "literal", value: { kind: "number", value: operation.delta } } }
          : operation.operator === "set" ? expand(operation.value, bindings)
            : { kind: "binary", operator: operation.operator, left: previous, right: expand(operation.value, bindings) };
        if (!isSupported(next, declaration)) return;
        bindings.set(operation.target.bindingId, next); checks.push(next);
      } else return;
      if (checks.length > 24) return;
    }
    if (block.terminal) {
      if (!["return", "exit"].includes(block.terminal.kind) || "continuationId" in block.terminal && block.terminal.continuationId) return;
      const expression = "value" in block.terminal && block.terminal.value ? expand(block.terminal.value, bindings) : { kind: "literal", value: { kind: "undefined" } } as Expression;
      if (!isSupported(expression, declaration) || returns.length >= 16) return;
      // Preserve evaluation of unused local calculations: discarding them could
      // turn an unsupported read/division into an incorrectly verified return.
      const value: Expression = checks.length ? { kind: "conditional", condition: { kind: "array", items: checks }, whenTrue: expression, whenFalse: unavailable } : expression;
      returns.push({ condition: path.predicates.length ? { kind: "logical", operator: "and", members: path.predicates } : { kind: "literal", value: { kind: "boolean", value: true } }, value });
      continue;
    }
    const edges = outgoing.get(path.id) ?? [];
    if (block.decision) {
      if (block.decision.continuationId) return;
      const condition = expand(block.decision.expression, bindings); if (!isSupported(condition, declaration)) return;
      const outcomes = block.decision.outcomes;
      const yes = edges.filter((edge) => outcomes.some((item) => item.edgeId === edge.edgeId && item.matches === "true"));
      const no = edges.filter((edge) => outcomes.some((item) => item.edgeId === edge.edgeId && item.matches === "false"));
      if (yes.length !== 1 || no.length !== 1 || edges.length !== 2) return;
      pending.push({ id: yes[0].targetBlockId, environment: bindings, predicates: [...path.predicates, condition], checks, visited });
      pending.push({ id: no[0].targetBlockId, environment: bindings, predicates: [...path.predicates, { kind: "unary", operator: "not", operand: condition }], checks, visited });
    } else {
      if (edges.length !== 1) return;
      pending.push({ ...path, id: edges[0].targetBlockId, environment: bindings, checks, visited });
    }
  }
  if (!returns.length) return;
  let value = unavailable;
  for (let index = returns.length - 1; index >= 0; index -= 1) value = { kind: "conditional", condition: returns[index].condition, whenTrue: returns[index].value, whenFalse: value };
  return value;
}

/** Substitution uses explicit expression frames, including one separately bounded template pass. */
function rewrite(root: Expression, bindings: ReadonlyMap<string, Expression> | undefined, caller: string, summaries: Map<string, Summary>, targets: Map<string, string>, noteDepth?: (depth: number) => void): Expression {
  return mapExpression(root, (node) => {
    if (node.kind === "binding" && bindings) return bindings.get(node.bindingId) ?? node;
    if (node.kind !== "direct-call" || node.receiver || node.requiresAwait || node.invocationKind && node.invocationKind !== "direct") return node;
    const summary = summaries.get(targets.get(callKey(caller, node.callRange.startLine, node.callRange.startCharacter)) ?? "");
    if (!summary || summary.depth > 4 || node.arguments.length > summary.declaration.parameters.length) return node;
    noteDepth?.(summary.depth);
    const substitutions = new Map<string, Expression>();
    for (const parameter of summary.declaration.parameters) {
      const argument = node.arguments[parameter.index];
      const fallback: Expression = { kind: "literal", value: parameter.defaultValue ?? { kind: "undefined" } };
      substitutions.set(parameter.bindingId!, argument ? parameter.defaultValue ? { kind: "conditional", condition: { kind: "binary", operator: "strict-eq", left: argument, right: { kind: "literal", value: { kind: "undefined" } } }, whenTrue: fallback, whenFalse: argument } : argument : fallback);
    }
    const value = mapExpression(summary.value, (item) => item.kind === "binding" ? substitutions.get(item.bindingId) ?? item : item);
    // Even unused argument expressions must be evaluated before a pure call.
    return { kind: "conditional", condition: { kind: "array", items: node.arguments }, whenTrue: value, whenFalse: unavailable };
  });
}

/** Rejects captured bindings, receivers and unresolved calls before trusting a helper summary. */
function isSupported(root: Expression, declaration: Declaration): boolean {
  const parameters = new Set(declaration.parameters.map((item) => item.bindingId));
  const pending = [root]; const visited = new Set<Expression>();
  while (pending.length) {
    if (visited.size >= 256) return false;
    const node = pending.pop()!; if (visited.has(node)) continue; visited.add(node);
    // The sentinel in a conditional's impossible else branch deliberately remains unknown.
    if (node === unavailable) continue;
    if (["direct-call", "construct", "await", "owner-reference", "unsupported"].includes(node.kind) || node.kind === "binding" && !parameters.has(node.bindingId)) return false;
    pending.push(...children(node));
  }
  return true;
}

function mapExpression(root: Expression, transform: (node: Expression) => Expression): Expression {
  const values = new Map<Expression, Expression>(); const active = new Set<Expression>();
  const stack = [{ node: root, ready: false, depth: 0 }]; let steps = 0;
  while (stack.length) {
    if (++steps > 512) return unavailable;
    const frame = stack.pop()!; if (values.has(frame.node)) continue;
    if (frame.depth > 32) return unavailable;
    if (!frame.ready) {
      if (active.has(frame.node)) return unavailable;
      active.add(frame.node); stack.push({ ...frame, ready: true });
      for (const node of children(frame.node)) stack.push({ node, ready: false, depth: frame.depth + 1 });
    } else {
      active.delete(frame.node);
      const read = (node: Expression) => values.get(node) ?? unavailable; const node = frame.node;
      const copy: Expression = node.kind === "binary" ? { ...node, left: read(node.left), right: read(node.right) }
        : node.kind === "member" ? { ...node, object: read(node.object) }
          : node.kind === "unary" || node.kind === "await" ? { ...node, operand: read(node.operand) }
            : node.kind === "logical" ? { ...node, members: node.members.map(read) }
              : node.kind === "conditional" ? { ...node, condition: read(node.condition), whenTrue: read(node.whenTrue), whenFalse: read(node.whenFalse) }
                : node.kind === "array" ? { ...node, items: node.items.map(read) }
                  : node.kind === "object" ? { ...node, entries: node.entries.map((entry) => ({ ...entry, value: read(entry.value) })) }
                    : node.kind === "direct-call" || node.kind === "construct" ? { ...node, arguments: node.arguments.map(read) } : node;
      values.set(node, transform(copy));
    }
  }
  return values.get(root) ?? unavailable;
}

function children(node: Expression): Expression[] {
  switch (node.kind) {
    case "binary": return [node.left, node.right]; case "member": return [node.object];
    case "unary": case "await": return [node.operand]; case "logical": return node.members;
    case "conditional": return [node.condition, node.whenTrue, node.whenFalse];
    case "array": return node.items; case "object": return node.entries.map((entry) => entry.value);
    case "direct-call": case "construct": return [...node.arguments, ...(node.kind === "direct-call" && node.receiver ? [node.receiver] : [])];
    default: return [];
  }
}

function rewriteBlock(block: FunctionTutorProgramBlock, expand: (expression: Expression) => Expression): FunctionTutorProgramBlock {
  return { ...block, operations: block.operations.map((operation) => operation.kind === "define" || operation.kind === "assign" ? { ...operation, value: expand(operation.value) } : operation),
    decision: block.decision ? { ...block.decision, expression: expand(block.decision.expression) } : undefined,
    terminal: block.terminal && "value" in block.terminal && block.terminal.value ? { ...block.terminal, value: expand(block.terminal.value) } : block.terminal };
}
function callKey(caller: string, line: number, character: number): string { return `${caller}:${line}:${character}`; }
