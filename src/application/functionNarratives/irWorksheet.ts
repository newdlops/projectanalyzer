/** Snapshot-owned source worksheets reuse the Tutor interpreter for objects and resolved pure helpers; uncertain paths remain model work. */
import { evaluateFunctionTutorInputs } from "../../analyzer/functionTutor";
import type { FunctionTutorExpression, FunctionTutorStaticValue as Value, FunctionTutorBlockObservation } from "../../analyzer/functionTutor";
import type { FunctionTutorBuildModel } from "../codeFlow/functionTutor";
import type { FunctionNarrativeContext, FunctionNarrativeSourceTrace, FunctionNarrativeExample, FunctionNarrativeFlowPath } from "../../shared/functionNarratives";

type Inputs = FunctionNarrativeExample["inputs"];

/** One immutable model owns at most 128 candidate tuples; no source parsing, arbitrary execution, or model work occurs here. */
export function createFunctionNarrativeIRWorksheet(context: FunctionNarrativeContext, model: FunctionTutorBuildModel): FunctionNarrativeContext["sourceWorksheet"] {
  const declaration = model.inputEvaluationDeclaration ?? model.declaration, logic = model.functionLogic;
  if (!["typescript", "javascript"].includes(declaration.language) || declaration.program.evaluationMode === "symbolic-only"
    || context.limited || context.snippets.some(snippet => snippet.truncated) || declaration.parameters.length > 8
    || declaration.parameters.some(parameter => parameter.rest || !parameter.bindingId)) return undefined;
  // The purpose model sees only supplied excerpts. A helper outside that source
  // cannot silently contribute hidden calculations to a complete explanation.
  if (model.scenarioBundle?.declarations.some(helper => helper.functionNode.id !== declaration.functionNode.id
    && (helper.functionNode.filePath !== declaration.functionNode.filePath || helper.program.blocks.some(block => !block.evidence.length
      || block.evidence.some(evidence => evidence.filePath !== declaration.functionNode.filePath
        || !context.snippets.some(snippet => !snippet.truncated && snippet.startLine <= evidence.range.startLine + 1
          && snippet.endLine >= evidence.range.endLine + (evidence.range.endCharacter || evidence.range.startLine === evidence.range.endLine ? 1 : 0))))))) return undefined;
  const blocks = new Map(logic.blocks.map(block => [block.id, block]));
  const program = new Map(declaration.program.blocks.map(block => [block.blockId, block]));
  const sourceProgram = new Map(model.declaration.program.blocks.map(block => [block.blockId, block]));
  const names = new Map(declaration.program.bindings.map(binding => [binding.bindingId, binding.name]));
  // Display rows have names, not lexical binding IDs. A shadowed name cannot
  // faithfully carry state between node tasks through that public contract.
  if (new Set(names.values()).size !== names.size) return undefined;
  const constants = new Set(declaration.program.bindings.filter(binding => binding.kind === "constant").map(binding => binding.bindingId));
  if (declaration.program.blocks.some(block => block.operations.some(operation => "target" in operation
    && operation.target.kind === "binding" && constants.has(operation.target.bindingId)))) return undefined;
  const definitions = new Set<string>(), parameterBindings = new Set(declaration.parameters.map(parameter => parameter.bindingId));
  for (const block of declaration.program.blocks) for (const operation of block.operations) if (operation.kind === "define") {
    // The current adapter can merge shadowed names into one binding identity.
    // Repeated declarations and parameter shadowing must remain model work.
    if (definitions.has(operation.bindingId) || parameterBindings.has(operation.bindingId)) return undefined;
    definitions.add(operation.bindingId);
  }
  const candidates: Inputs[] = [], seen = new Set<string>();
  const add = (inputs: Inputs | undefined) => {
    if (!inputs || candidates.length >= 128 || inputs.length !== declaration.parameters.length) return;
    const key = JSON.stringify(inputs);
    if (!seen.has(key)) { seen.add(key); candidates.push(inputs); }
  };
  for (const seed of model.seeds.slice(0, 16)) {
    if (seed.inputs.some(input => input.omitted)) continue;
    const inputs = seed.inputs.map(input => ({ name: declaration.parameters.find(parameter => parameter.id === input.parameterId)?.name,
      json: staticJSON(input.value) }));
    if (inputs.every(input => input.name && input.json !== undefined)) add(inputs as Inputs);
  }
  const domains = declaration.parameters.map(parameter => {
    const existing = (model.candidatesByParameter.get(parameter.id) ?? []).slice(0, 8).map(candidate => staticJSON(candidate.value))
      .filter((value): value is string => value !== undefined);
    // A type representative can be a singleton (for example number=0). Add
    // a few typed alternatives, then independently interpret the entire route.
    // Literal unions, unknown types and object shapes retain their own domains.
    const extra = parameter.typeText === "number" ? ["10", "1", "-1"] : parameter.typeText === "boolean" ? ["true", "false"]
      : parameter.typeText === "string" ? ['"sample"', '"other"'] : parameter.typeText === "number[]" ? ["[]", "[0]", "[10]"] : [];
    if (parameter.typeKind === "object" && existing.length) {
      for (const member of parameter.memberFacts.slice(0, 8)) {
        if (member.path.length !== 1 || member.optional || member.literalValues.length || !["number", "boolean", "string"].includes(member.typeKind)) continue;
        const base = JSON.parse(existing[0]) as Record<string, unknown>, key = member.path[0];
        if (!base || typeof base !== "object" || Array.isArray(base) || typeof base[key] !== member.typeKind) continue;
        const values = member.typeKind === "number" ? [10, 1, -1] : member.typeKind === "boolean" ? [true, false] : ["sample", "other"];
        for (const value of values) extra.push(JSON.stringify({ ...base, [key]: value }));
      }
    }
    return [...new Set([...existing, ...extra])].slice(0, 8);
  });
  if (domains.every(domain => domain.length)) {
    const positions = domains.map(() => 0);
    for (let count = 0; count < 128; count++) {
      add(declaration.parameters.map((parameter, index) => ({ name: parameter.name, json: domains[index][positions[index]] })));
      let index = positions.length - 1;
      for (; index >= 0; index--) { if (++positions[index] < domains[index].length) break; positions[index] = 0; }
      if (index < 0) break;
    }
  } else if (!declaration.parameters.length) add([]);

  /** Interpreter visits must match every owned source operation and branch in order; partial prefixes never certify a worksheet. */
  const calculate = (path: FunctionNarrativeFlowPath, inputs: Inputs, language: "ko" | "en"): FunctionNarrativeSourceTrace | undefined => {
    if (path.status !== "source-terminal" || path.confidence !== "exact" || !path.steps.length || path.steps.length > 32
      || path.steps.some(step => step.confidence !== "exact") || inputs.length !== declaration.parameters.length) return;
    const assignments = [];
    for (const parameter of declaration.parameters) {
      const matches = inputs.filter(input => input.name === parameter.name), value = matches.length === 1 ? parseInput(matches[0].json) : undefined;
      if (!value) return;
      assignments.push({ parameterId: parameter.id, value });
    }
    const visits: FunctionTutorBlockObservation[] = [];
    const evaluation = evaluateFunctionTutorInputs(declaration, assignments, { maxSteps: 64, maxLoopVisits: 1,
      observeBlock: visit => { if (blocks.get(visit.blockId)?.kind !== "entry") visits.push(visit); } });
    const result = evaluation.terminal?.value && staticJSON(evaluation.terminal.value);
    if (evaluation.status !== "verified" || evaluation.terminal?.kind !== "return" || result === undefined
      || evaluation.edgeIds.some(id => logic.edges.find(edge => edge.id === id)?.confidence !== "exact")
      || visits.length !== path.steps.length) return;
    const steps: FunctionNarrativeSourceTrace["steps"] = [], substitutions: string[] = [], ko = language === "ko";
    for (let index = 0; index < visits.length; index++) {
      const visit = visits[index], block = blocks.get(visit.blockId), ir = program.get(visit.blockId), target = path.steps[index];
      const owned = context.scenarioGraph?.nodes.find(node => node.step && block && node.step.kind === block.kind
        && node.step.source.startLine === block.range.startLine + 1 && node.step.code === target.code)?.step;
      if (!block || !ir || block.confidence !== "exact" || !owned || JSON.stringify(owned.source) !== JSON.stringify(target.source)
        || !["mutation", "condition", "return"].includes(target.kind) || ir.operations.length > 1
        || target.kind !== "mutation" && ir.operations.length) return;
      const decision = evaluation.decisions.find(item => item.blockId === visit.blockId);
      if (target.branch && (target.branch.confidence !== "exact" || target.branch.outcome !== decision?.outcome)) return;
      const operation = ir.operations[0];
      const bindingId = operation?.kind === "define" ? operation.bindingId : operation && "target" in operation ? operation.target.bindingId : undefined;
      const name = target.kind === "condition" ? "condition" : target.kind === "return" ? "result" : bindingId && names.get(bindingId);
      const value: Value | undefined = target.kind === "condition" ? decision ? { kind: "boolean", value: decision.outcome === "true" } : undefined
        : target.kind === "return" ? visit.terminal : bindingId ? visit.after.get(bindingId) : undefined;
      const after = value && staticJSON(value), prior = bindingId && visit.before.get(bindingId);
      const before = target.kind === "condition" || target.kind === "return" ? "—" : operation?.kind === "define"
        ? ko ? "선언 전" : "not declared" : prior && staticJSON(prior);
      if (!name || after === undefined || before === undefined || context.valueNames?.length && !context.valueNames.includes(name)) return;
      const expression = ir.decision?.expression ?? (ir.terminal && "value" in ir.terminal ? ir.terminal.value : undefined)
        ?? (operation && "value" in operation ? operation.value : undefined);
      const operands = expression ? readOperands(expression, visit.before, names) : bindingId && prior ? [`${name}=${staticJSON(prior)}`] : [];
      if (!operands) return;
      // Compound writes consume the old target as well as the right operand.
      if (operation?.kind === "assign" && operation.operator !== "set" && prior) operands.unshift(`${name}=${staticJSON(prior)}`);
      const substituted = `${target.loweredPredicate ?? target.code}${operands.length ? " [" + [...new Set(operands)].join(", ") + "]" : ""}`;
      const next = path.steps[index + 1]?.code;
      const syntax = target.kind === "condition" ? ko ? "조건식의 참·거짓 판단으로 다음 소스 경로를 선택합니다." : "The predicate's truth value selects the next source route."
        : target.kind === "return" ? ko ? "return은 식 전체의 값을 반환하고 현재 함수의 진행을 끝냅니다." : "Return yields the whole expression and ends this function."
          : operation?.kind === "define" ? /^const\b/u.test(target.code)
            ? ko ? "const는 재대입할 수 없는 지역 변수를 선언하고 초기값을 저장합니다." : "Const declares a non-reassignable local binding and stores its initial value."
            : ko ? "지역 변수를 선언하고 초기값을 저장합니다." : "Declare a local binding and store its initial value."
            : ko ? "현재 대상에 대입 연산을 적용하고 결과를 저장합니다." : "Apply the assignment operation to the current target and store the result.";
      const sourceIR = sourceProgram.get(visit.blockId), sourceOperation = sourceIR?.operations[0];
      const sourceExpression = sourceIR?.decision?.expression ?? (sourceIR?.terminal && "value" in sourceIR.terminal ? sourceIR.terminal.value : undefined)
        ?? (sourceOperation && "value" in sourceOperation ? sourceOperation.value : undefined);
      const semantics = describeExpression(sourceExpression, sourceOperation, language);
      if (semantics === undefined) return;
      const step = { code: target.code, source: target.source, syntax: syntax + " " + semantics,
        text: ko ? target.kind === "condition" ? `조건 ${target.code}의 판단은 ${after}입니다.`
          : target.kind === "return" ? `${target.code}에서 ${after} 값을 반환합니다.` : `${target.code} 후 ${name}=${after}입니다.`
          : target.kind === "condition" ? `${target.code} is ${after}.` : target.kind === "return" ? `${target.code} returns ${after}.` : `After ${target.code}, ${name}=${after}.`,
        reason: ko ? `현재 예시의 ${substituted} 계산 결과는 ${after}입니다.` : `For this example, ${substituted} gives ${after}.`,
        effect: target.kind === "return" ? ko ? `${after}를 호출자에게 반환하며 이 함수가 끝납니다.` : `Return ${after} to the caller and end this function.`
          : ko ? `${name}: ${before} → ${after}. 다음 구문은 ${next ?? "없음"}입니다.` : `${name}: ${before} → ${after}; next is ${next ?? "the end"}.`,
        values: [{ name, before, after }] };
      // Preserve every semantic clause within the existing node contract; never
      // trim an operand, syntax meaning or immediate effect to fit a fast path.
      if ([step.syntax, step.text, step.reason, step.effect].some(text => text.length > 600)) return;
      steps.push(step); substitutions.push(substituted);
    }
    return { inputs, steps, result, substitutions };
  };
  const snapshot = JSON.stringify(context.snippets);
  return { owns(candidate) { return !candidate.limited && candidate.language === context.language && candidate.functionName === context.functionName
    && JSON.stringify(candidate.snippets) === snapshot; }, trace(path, inputs, language, exclude) {
    if (inputs) return calculate(path, inputs, language);
    const excluded = exclude && JSON.stringify(exclude);
    for (const candidate of candidates) {
      if (JSON.stringify(candidate) === excluded) continue;
      const trace = calculate(path, candidate, language);
      if (trace) return trace;
    }
    return undefined;
  } };
}

/** Bounded immutable JSON trees preserve full values and reject truncation, negative zero and prototype-sensitive keys. */
function staticJSON(root: Value): string | undefined {
  const rendered = new Map<Value, string>(), active = new Set<Value>(), pending = [{ value: root, ready: false, depth: 0 }];
  for (let count = 0; pending.length && count < 128; count++) {
    const frame = pending.pop()!, value = frame.value;
    if (rendered.has(value)) continue;
    if (frame.depth > 4 || value.kind === "unknown" || value.kind === "undefined" || value.kind === "enum"
      || value.kind === "number" && (!Number.isFinite(value.value) || Object.is(value.value, -0) || Math.abs(value.value) > Number.MAX_SAFE_INTEGER)) return;
    if (value.kind !== "array" && value.kind !== "object") { rendered.set(value, value.kind === "null" ? "null" : JSON.stringify(value.value)); continue; }
    const children = value.kind === "array" ? value.items : value.entries.map(entry => entry.value);
    if (value.truncated || children.length > 8 || value.kind === "object" && value.entries.some(entry => ["__proto__", "constructor", "prototype"].includes(entry.key))) return;
    if (!frame.ready) {
      if (active.has(value)) return;
      active.add(value); pending.push({ ...frame, ready: true });
      for (const child of children) pending.push({ value: child, ready: false, depth: frame.depth + 1 });
    } else {
      if (children.some(child => !rendered.has(child))) return;
      rendered.set(value, value.kind === "array" ? "[" + value.items.map(item => rendered.get(item)).join(",") + "]"
        : "{" + value.entries.map(entry => JSON.stringify(entry.key) + ":" + rendered.get(entry.value)).join(",") + "}");
      active.delete(value);
    }
  }
  const json = rendered.get(root);
  return json !== undefined && json.length <= 240 ? json : undefined;
}

/** Parses only JSON input data, with explicit depth/work budgets and no source evaluation or property accessors. */
function parseInput(json: string): Value | undefined {
  if (json.length > 240) return;
  let root: unknown; try { root = JSON.parse(json); } catch { return; }
  const values = new Map<unknown, Value>(), pending = [{ value: root, ready: false, depth: 0 }];
  for (let count = 0; pending.length && count < 128; count++) {
    const frame = pending.pop()!, value = frame.value;
    if (values.has(value)) continue;
    if (frame.depth > 4) return;
    if (value === null) values.set(value, { kind: "null" });
    else if (typeof value === "number") values.set(value, { kind: "number", value });
    else if (typeof value === "boolean") values.set(value, { kind: "boolean", value });
    else if (typeof value === "string") values.set(value, { kind: "string", value });
    else if (typeof value === "object") {
      const children = Object.values(value), keys = Object.keys(value);
      if (children.length > 8 || keys.some(key => ["__proto__", "constructor", "prototype"].includes(key))) return;
      if (!frame.ready) { pending.push({ ...frame, ready: true }); for (const child of children) pending.push({ value: child, ready: false, depth: frame.depth + 1 }); }
      else { if (children.some(child => !values.has(child))) return;
        values.set(value, Array.isArray(value) ? { kind: "array", items: children.map(child => values.get(child)!), truncated: false }
          : { kind: "object", entries: keys.map((key, index) => ({ key, value: values.get(children[index])! })), truncated: false }); }
    } else return;
  }
  const result = values.get(root);
  return result && staticJSON(result) !== undefined ? result : undefined;
}

/** Retains every referenced entry binding; compiled helpers only reference the root's supplied arguments. */
function readOperands(root: FunctionTutorExpression, values: ReadonlyMap<string, Value>, names: Map<string, string>): string[] | undefined {
  const pending = [root], visited = new Set<FunctionTutorExpression>(), result = new Map<string, string>();
  while (pending.length) {
    if (visited.size >= 128) return;
    const expression = pending.pop()!; if (visited.has(expression)) continue; visited.add(expression);
    if (expression.kind === "binding") {
      const name = names.get(expression.bindingId), value = values.get(expression.bindingId), json = value && staticJSON(value);
      if (!name || json === undefined) return;
      result.set(name, `${name}=${json}`);
    }
    if (expression.kind === "member") pending.push(expression.object);
    else if (expression.kind === "unary" || expression.kind === "await") pending.push(expression.operand);
    else if (expression.kind === "binary") pending.push(expression.right, expression.left);
    else if (expression.kind === "logical") pending.push(...expression.members.slice().reverse());
    else if (expression.kind === "conditional") pending.push(expression.whenFalse, expression.whenTrue, expression.condition);
    else if (expression.kind === "array") pending.push(...expression.items.slice().reverse());
    else if (expression.kind === "object") pending.push(...expression.entries.map(entry => entry.value).reverse());
    else if (expression.kind === "direct-call" || expression.kind === "construct") pending.push(...expression.arguments.slice().reverse());
  }
  return [...result.values()];
}

/** Source tokens describe only syntax that occurs in this operation; pure-call results still come exclusively from the interpreter. */
function describeExpression(expression: FunctionTutorExpression | undefined, operation: import("../../analyzer/functionTutor").FunctionTutorOperation | undefined,
  language: "ko" | "en"): string | undefined {
  const ko = language === "ko", parts = new Set<string>(), pending = expression ? [expression] : [], visited = new Set<FunctionTutorExpression>();
  const labels: Record<string, [string, string]> = { add: ["+는 수치 덧셈 또는 문자열 연결입니다.", "+ adds numbers or concatenates strings."],
    subtract: ["-는 뺄셈입니다.", "- subtracts."], multiply: ["*는 곱셈입니다.", "* multiplies."], divide: ["/는 나눗셈입니다.", "/ divides."], modulo: ["%는 나머지입니다.", "% gives the remainder."],
    gt: [">는 초과 비교입니다.", "> compares greater than."], gte: [">=는 이상 비교입니다.", ">= compares inclusively."], lt: ["<는 미만 비교입니다.", "< compares less than."], lte: ["<=는 이하 비교입니다.", "<= compares inclusively."],
    "strict-eq": ["===는 엄격한 동등 비교입니다.", "=== tests strict equality."], "strict-neq": ["!==는 엄격한 다름 비교입니다.", "!== tests strict inequality."] };
  const member = () => parts.add(ko ? "속성·인덱스로 대상의 값을 읽거나 지정합니다." : "Property/index access reads or targets a value.");
  if (operation && "target" in operation && operation.target.kind === "member") member();
  if (operation?.kind === "assign" && labels[operation.operator]) parts.add(labels[operation.operator][ko ? 0 : 1]);
  while (pending.length) {
    if (visited.size >= 128) return;
    const node = pending.pop()!; if (visited.has(node)) continue; visited.add(node);
    if (node.kind === "member") { member(); pending.push(node.object); }
    else if (node.kind === "binary") { if (labels[node.operator]) parts.add(labels[node.operator][ko ? 0 : 1]); pending.push(node.left, node.right); }
    else if (node.kind === "unary") { if (node.operator === "not") parts.add(ko ? "!는 참·거짓 판단을 반전합니다." : "! negates truthiness."); pending.push(node.operand); }
    else if (node.kind === "direct-call") { parts.add(ko ? "함수 호출은 인수를 전달하고 반환값을 사용합니다." : "A function call passes arguments and uses its return value."); pending.push(...node.arguments); }
    else if (node.kind === "logical") { parts.add(ko ? "논리 연산은 단락 평가로 필요한 피연산자를 선택합니다." : "Logical operators select operands by short-circuit evaluation."); pending.push(...node.members); }
    else if (node.kind === "conditional") { parts.add(ko ? "조건에 따라 두 식 중 하나의 값을 선택합니다." : "The condition selects one of two expression values."); pending.push(node.condition, node.whenTrue, node.whenFalse); }
    else if (node.kind === "array") pending.push(...node.items);
    else if (node.kind === "object") pending.push(...node.entries.map(entry => entry.value));
  }
  return [...parts].join(" ");
}
