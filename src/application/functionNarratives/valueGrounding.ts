/** Reuses existing Tutor IR and completed checks as bounded named facts, without evaluation, parsing or I/O. */
import type { FunctionTutorExpression, FunctionTutorStaticValue } from "../../analyzer/functionTutor";
import type { FunctionTutorBuildModel } from "../codeFlow/functionTutor";
import type { FunctionNarrativeContext, FunctionNarrativeValueFact, FunctionNarrativeSource, FunctionNarrativeCheckedExample } from "../../shared/functionNarratives";
import { collectFunctionNarrativeScope } from "./currentScope";

/** Copies at most six source operations and three existing primitive checks within a 2,000-character budget. */
export function addFunctionNarrativeValueGrounding(context: FunctionNarrativeContext,
  model: FunctionTutorBuildModel): FunctionNarrativeContext {
  const { declaration, functionLogic: logic } = model;
  const bindings = new Map(declaration.program.bindings.map((binding) => [binding.bindingId, binding.name]));
  const blocks = new Map(logic.blocks.map((block) => [block.id, block]));
  const edges = new Map(logic.edges.map((edge) => [edge.id, edge]));
  const scope = collectFunctionNarrativeScope(logic);
  const facts: FunctionNarrativeValueFact[] = [];
  const examples: FunctionNarrativeCheckedExample[] = [];
  let remaining = 2000;
  let limited = false;
  // Only primitive operands/direct binding names are flattened. Complex or
  // unsupported expressions remain source text; no recursive mini-interpreter.
  const operand = (expression: FunctionTutorExpression): string | undefined => expression.kind === "binding"
    ? bindings.get(expression.bindingId)?.slice(0, 120) : expression.kind === "literal" ? primitive(expression.value) : undefined;
  const predicate = (expression: FunctionTutorExpression): string | undefined => {
    if (expression.kind !== "binary") return operand(expression);
    const operators: Record<string, string> = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "==", neq: "!=", "strict-eq": "===", "strict-neq": "!==" };
    const left = operand(expression.left); const right = operand(expression.right);
    return operators[expression.operator] && left !== undefined && right !== undefined
      ? `${left} ${operators[expression.operator]} ${right}` : undefined;
  };
  /** Requires this exact root-source range to be visible, not merely a matching helper line. */
  const citation = (blockId: string): FunctionNarrativeSource | undefined => {
    const block = blocks.get(blockId);
    if (!scope.has(blockId) || !block || block.filePath !== declaration.functionNode.filePath || block.confidence !== "exact") return undefined;
    const startLine = block.range.startLine + 1;
    const endLine = block.range.endLine + (block.range.endCharacter > 0 || block.range.startLine === block.range.endLine ? 1 : 0);
    const snippet = context.snippets.find((candidate) => candidate.role === "function" && !candidate.truncated
      && candidate.startLine <= startLine && candidate.endLine >= endLine);
    return snippet ? { snippetId: snippet.id, startLine, endLine } : undefined;
  };
  const consume = (item: unknown): boolean => {
    const size = JSON.stringify(item).length;
    if (size > remaining) { limited = true; return false; }
    remaining -= size; return true;
  };
  for (const block of declaration.program.blocks) for (const operation of block.operations) {
    if (operation.kind !== "define") continue;
    const target = bindings.get(operation.bindingId);
    const source = citation(block.blockId);
    if (!target || target.length > 120 || !source) continue;
    const expression = operation.value;
    let fact: FunctionNarrativeValueFact | undefined;
    if (expression.kind === "conditional") {
      const condition = predicate(expression.condition);
      const whenTrue = operand(expression.whenTrue); const whenFalse = operand(expression.whenFalse);
      if (condition && whenTrue !== undefined && whenFalse !== undefined) fact = {
        target, operation: "conditional", operands: [condition, whenTrue, whenFalse], source };
    } else if (expression.kind === "binary" && ["add", "subtract", "multiply", "divide", "modulo"].includes(expression.operator)) {
      const left = operand(expression.left); const right = operand(expression.right);
      if (left !== undefined && right !== undefined) fact = { target, operation: expression.operator as FunctionNarrativeValueFact["operation"], operands: [left, right], source };
    }
    if (!fact) continue;
    if (facts.length >= 6 || !consume(fact)) { limited = true; continue; }
    facts.push(fact);
  }
  const seen = new Set<string>();
  for (const seed of model.seeds) {
    const evaluation = seed.quality?.evaluation;
    // Caller arguments outside the supplied source excerpts are not shared.
    // Symbolic/partial evaluation never supplies checked facts or a guessed terminal.
    if (seed.source === "callsite" || seed.inputs.some((input) => input.evidence.some((evidence) => evidence.kind === "callsite-argument"))
      || !evaluation || evaluation.status !== "verified" || !evaluation.terminal
      || declaration.program.evaluationMode === "symbolic-only"
      || evaluation.blockIds.some((id) => blocks.get(id)?.confidence !== "exact")
      || evaluation.blockIds.some((id) => blocks.get(id)?.kind !== "entry" && !citation(id))
      || evaluation.edgeIds.some((id) => edges.get(id)?.confidence !== "exact")) continue;
    const inputs = seed.inputs.map((input) => ({ name: declaration.parameters.find((parameter) => parameter.id === input.parameterId)?.name,
      value: primitive(input.value), omitted: input.omitted }));
    const terminalValue = evaluation.terminal.value ? primitive(evaluation.terminal.value) : "undefined";
    const terminalSource = citation(evaluation.terminal.blockId);
    const decisions = evaluation.decisions.map((decision) => ({ expression: blocks.get(decision.blockId)?.condition?.expression,
      outcome: decision.outcome, source: citation(decision.blockId) }));
    if (inputs.length > 16 || inputs.some((input) => input.name === undefined || input.name.length > 120 || input.value === undefined)
      || terminalValue === undefined || !terminalSource || decisions.length > 12
      || decisions.some((decision) => !decision.expression || decision.expression.length > 240 || !decision.source)) continue;
    const example: FunctionNarrativeCheckedExample = { basis: "static-evaluation",
      inputs: inputs as FunctionNarrativeCheckedExample["inputs"], decisions: decisions as FunctionNarrativeCheckedExample["decisions"],
      sources: [...new Map(evaluation.blockIds.filter((id) => blocks.get(id)?.kind !== "entry").map((id) => citation(id))
        .filter((source): source is FunctionNarrativeSource => Boolean(source)).map((source) => [JSON.stringify(source), source])).values()],
      terminal: { kind: evaluation.terminal.kind, value: terminalValue, source: terminalSource } };
    const key = JSON.stringify(example);
    if (seen.has(key)) continue;
    seen.add(key);
    if (examples.length >= 3 || !consume(example)) { limited = true; continue; }
    examples.push(example);
  }
  // Avoid asking small models to invert !flag themselves. Only one exact direct
  // predicate on a required Boolean input is normalized; nullable/member/compound
  // conditions retain their source choice without asserting an input value.
  let routeBudget = Math.max(0, 4000 - JSON.stringify(context.sourceFlow ?? {}).length);
  const sourceFlow = context.sourceFlow && { ...context.sourceFlow, paths: context.sourceFlow.paths.map((path) => ({ ...path,
    steps: path.steps.map((step) => {
      if (!step.branch || !["true", "false"].includes(step.branch.outcome)) return step;
      const matches = [...blocks.values()].filter((block) => block.condition?.expression === step.code
        && block.range.startLine + 1 === step.source.startLine);
      if (matches.length !== 1) return step;
      const block = matches[0];
      const constraints = declaration.constraints.filter((constraint) => constraint.blockId === block?.id && constraint.certainty === "exact");
      if (constraints.length !== 1) return step;
      const constraint = constraints[0];
      const parameter = declaration.parameters.find((parameter) => parameter.id === constraint.parameterId);
      if (!parameter || parameter.name.length > 120 || parameter.typeKind !== "boolean" || parameter.optional || parameter.rest || constraint.memberPath.length
        || !directBooleanType(declaration.language, parameter.typeText)
        || !["truthy", "falsy"].includes(constraint.operator)) return step;
      const value = (constraint.operator === "truthy") === (step.branch.outcome === "true");
      const next = { ...step, branch: { ...step.branch, inputCondition: `${parameter.name} = ${value}` } };
      const added = JSON.stringify(next).length - JSON.stringify(step).length;
      if (added > routeBudget) { limited = true; return step; }
      routeBudget -= added;
      return next;
    }) })) };
  return { ...context, ...(sourceFlow ? { sourceFlow } : {}), ...(facts.length ? { valueFacts: facts } : {}),
    ...(examples.length ? { checkedExamples: examples } : {}), ...(limited ? { groundingLimited: true } : {}) };
}

/** Type categories can erase nullability; only an explicit primitive spelling authorizes Boolean inversion. */
function directBooleanType(language: string, typeText: string | undefined): boolean {
  const type = (typeText ?? "").replace(/\s/gu, "");
  if (language === "kotlin") return /^(?:kotlin\.)?Boolean$/u.test(type);
  if (["python", "fsharp", "ocaml"].includes(language)) return type === "bool";
  return type === "boolean";
}

/** Finite primitive spellings avoid internal value brands, object identities and lossy truncation. */
function primitive(value: FunctionTutorStaticValue): string | undefined {
  if (value.kind === "undefined" || value.kind === "null") return value.kind;
  if (value.kind === "boolean" || value.kind === "number" && Number.isFinite(value.value)
    || value.kind === "string" && value.value.length <= 120) return JSON.stringify(value.value);
  return undefined;
}
