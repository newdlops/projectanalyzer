/** A small constrained JSON grammar guides local generation; Host validation still verifies snippet ownership. */
import type { FunctionNarrativeContext, FunctionNarrativeFlowStep } from "../../shared/functionNarratives";
import { createFunctionCallNarrativeSchema, getFunctionCallFixedReason, getFunctionCallFixedOutput, getFunctionCallFixedEffects } from "../../shared/functionCallNarratives";
import { buildFunctionNarrativeScenarioFrames, getFunctionNarrativeExampleConstraints, hasCompletePrimitiveWorksheet, getPrimitiveWorksheetAnalysis } from "../../application/functionNarratives";

export function createLocalNarrativeSchema(context: FunctionNarrativeContext, language: "ko" | "en" = "en"): Record<string, unknown> {
  if (context.callTask) {
    const schema = createFunctionCallNarrativeSchema(context.callTask, language) as any;
    for (const [index, target] of context.callTask.targets.entries()) {
      const reason = getFunctionCallFixedReason(target, language);
      if (reason) schema.properties.calls.items[index].properties.reason = { const: reason };
      // All lexical returns and exact caller use must fit together. This is
      // syntax evidence, not a computed result or finally-completion proof.
      const output = getFunctionCallFixedOutput(target, language);
      if (output) schema.properties.calls.items[index].properties.output = { const: output };
      const effects = getFunctionCallFixedEffects(target, language);
      if (effects) schema.properties.calls.items[index].properties.effects = { const: effects };
    }
    return schema;
  }
  // Anchored character classes are supported by llama.cpp's JSON grammar. A
  // Korean start guides the decoder's language while source const/enum fields
  // remain untouched. Bounds are in the pattern because pattern takes precedence.
  const description = (limit: number) => ({ type: "string", minLength: 1, maxLength: limit,
    ...(language === "ko" ? { pattern: `^[가-힣][^"\\\\\\x00-\\x1F]{0,${limit - 1}}$` } : {}) });
  // Complete runs may contain many pages. Bound local prose independently from
  // path coverage so a verbose model cannot consume the entire output budget in
  // summary/explanation before completing every fixed scenario slot.
  const batched = context.scenarioBatch !== undefined;
  const rich = context.detailLevel === "rich";
  const closedPrimitive = Boolean(context.summaryTask && (hasCompletePrimitiveWorksheet(context) || isClosedPrimitiveRoute()));
  const groundedAnalysis = context.summaryTask && getPrimitiveWorksheetAnalysis(context, language);
  // Intermediate values belong to ordered node work, after earlier state exists.
  const withValues = Boolean(context.parameters && (!rich || context.nodeTask));
  const prose = description(rich ? 160 : batched ? context.parameters ? 80 : 120 : 600);
  const facts = { type: "array", items: prose, maxItems: batched ? 2 : 4 };
  const source = { type: "object", additionalProperties: false, required: ["snippetId", "startLine", "endLine"], properties: {
    snippetId: { type: "string", enum: context.snippets.map((snippet) => snippet.id) },
    startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 1 }
  } };
  const values = { type: "array", minItems: 1, maxItems: 2, items: { type: "object", additionalProperties: false,
    required: ["name", "before", "after"], properties: {
      name: { type: "string", ...(context.valueNames?.length ? { enum: context.valueNames } : { maxLength: 120 }) },
      before: { type: "string", minLength: 1, maxLength: 120 }, after: { type: "string", minLength: 1, maxLength: 120 }
    } } };
  const step = { type: "object", additionalProperties: false, required: ["text", "reason", "effect", "source", ...(rich ? ["syntax"] : []), ...(withValues ? ["values"] : [])],
    properties: { ...(rich ? { code: { type: "string", minLength: 1, maxLength: 480 }, syntax: description(160) } : {}),
      text: rich ? description(120) : prose, reason: rich ? description(180) : prose, effect: prose,
      source, ...(withValues ? { values } : {}) } };
  const targetedSteps = context.nodeTask ? { type: "array", minItems: context.nodeTask.targets.length, maxItems: context.nodeTask.targets.length,
    items: context.nodeTask.targets.map((target) => ({ ...step, description: operationDescription(target), required: [...step.required, ...(rich ? ["code"] : [])],
      properties: orderedStepProperties({ ...step.properties, ...(rich ? { code: { const: target.code } } : {}), source: { const: target.source },
        ...(withValues ? { values: targetValues(target) } : {}), ...booleanReading(target, 0), ...elvisWriteReading(target, 0), ...literalReturnReading(target) }, target.kind) })) } : undefined;
  // Node generation spends its output on new syntax/causality. The Host retains
  // the original scenario/example; repeating it here wastes tokens and drifts.
  if (rich && targetedSteps) return { type: "object", additionalProperties: false, required: ["steps"], properties: { steps: targetedSteps } };
  const analysis = { type: "object", additionalProperties: false, required: ["pathReason", "stateChange", "alternative"],
    properties: { pathReason: groundedAnalysis ? { const: groundedAnalysis.pathReason } : description(220),
      stateChange: groundedAnalysis ? { const: groundedAnalysis.stateChange } : description(220), alternative: description(220) } };
  const example = context.nodeTask ? { const: context.nodeTask.example } : { type: "object", additionalProperties: false, required: ["inputs", "result"], properties: {
    inputs: { type: "array", minItems: context.parameters?.length ?? 0, maxItems: context.parameters?.length ?? 0,
      ...(context.parameters?.length ? { items: context.parameters.map((parameter) => ({ type: "object", additionalProperties: false, required: ["name", rich ? "value" : "json"],
        properties: { name: { const: parameter.name }, ...(rich ? { value: inputValueSchema(parameter.type) } : { json: { type: "string", minLength: 1, maxLength: 1200 } }) } })) } : { items: { type: "object" } }) },
    result: { type: "string", minLength: 1, maxLength: 1200 }
  } };
  const scenario = { type: "object", additionalProperties: false, required: ["title", "when", "explanation", "steps", "outcome", "assumptions", ...(rich ? ["analysis"] : []), ...(context.parameters ? ["example"] : [])], properties: {
    ...(rich && context.parameters ? { exampleInputs: example.properties!.inputs } : {}),
    title: description(batched ? 64 : 160), when: facts,
    explanation: description(rich ? 600 : batched ? context.parameters ? 280 : 480 : 1800),
    ...(rich ? { analysis } : {}),
    steps: { type: "array", minItems: 1, maxItems: rich ? 2 : batched ? 3 : 5, items: step }, outcome: prose, assumptions: closedPrimitive ? { const: [] } : facts,
    ...(context.parameters && !rich ? { example } : {}),
    ...(rich && context.parameters ? { exampleResult: resultValueSchema() } : {})
  } };
  if (rich && context.parameters) scenario.required = scenario.required.filter((field) => field !== "example").concat("exampleInputs", "exampleResult");
  const frames = buildFunctionNarrativeScenarioFrames(context);
  // llama.cpp supports tuple items. Each fixed slot keeps its own conditions,
  // terminal and source citations; free prose cannot substitute another route.
  const scenarios = frames.length ? { type: "array", minItems: frames.length, maxItems: frames.length, items: frames.map((frame, index) => ({
    ...scenario, properties: orderedProperties({ ...scenario.properties, when: { const: frame.when }, outcome: { const: frame.outcome },
      // The Host replaces this model title with the source frame's title after validation.
      ...(context.summaryTask ? { title: { const: language === "ko" ? "소스 시나리오" : "Source scenario" } } : {}),
      ...(context.nodePreparation ? { title: { const: language === "ko" ? "노드 해설 준비" : "Preparing node readings" },
        explanation: { const: language === "ko" ? "소스 노드를 순서대로 읽고 있습니다." : "Source nodes are being read in order." },
        analysis: { const: { pathReason: language === "ko" ? "소스 노드 해설을 준비합니다." : "Preparing source node readings.",
          stateChange: language === "ko" ? "소스 노드 해설을 준비합니다." : "Preparing source node readings.",
          alternative: language === "ko" ? "소스 노드 해설을 준비합니다." : "Preparing source node readings." } }, assumptions: { const: [] } } : {}),
      ...(rich && context.parameters ? { exampleInputs: context.summaryTask ? { const: context.summaryTask.inputs.map(input => ({ name: input.name, value: JSON.parse(input.json) })) }
        : constrainedExample(index).properties.inputs,
        exampleResult: context.nodePreparation ? { const: null } : context.summaryTask?.resultJson !== undefined ? { const: JSON.parse(context.summaryTask.resultJson) }
          : getFunctionNarrativeExampleConstraints(context, index).partial ? { const: null } : resultValueSchema() } : {}),
      steps: context.summaryTask ? { const: context.summaryTask.steps } : targetedSteps ?? (rich && context.sourceFlow?.paths[index]?.steps.length ? prefixEvidence(index) :
        { ...scenario.properties.steps, items: { ...step, properties: {
          ...(!rich || !context.sourceFlow?.paths[index] ? step.properties : sourceStepProperties(index)),
          source: { enum: frame.sources } } } }) })
  })) } : { type: "array", minItems: 1, maxItems: 3, items: scenario };
  return { type: "object", additionalProperties: false, required: ["summary", "scenarios", "limitations"], properties: {
    scenarios, summary: context.nodePreparation ? { const: language === "ko" ? "소스 노드를 순서대로 읽고 있습니다." : "Source nodes are being read in order." }
      : context.summaryTask?.knownFunctionSummary ? { const: context.summaryTask.knownFunctionSummary }
        : description(rich ? 240 : batched ? context.parameters ? 160 : 240 : 1200),
    limitations: context.nodePreparation || closedPrimitive ? { const: [] } : { ...facts, maxItems: batched ? 2 : 6 }
  } };

  /** Calculate source operations/result before summarizing them; legacy property order remains unchanged. */
  function orderedProperties(properties: Record<string, unknown>): Record<string, unknown> {
    if (!rich) return properties;
    const ordered: Record<string, unknown> = {};
    for (const key of ["exampleInputs", "when", "steps", "outcome", "exampleResult", "title", "explanation", "analysis", "assumptions"]) {
      if (Object.hasOwn(properties, key)) ordered[key] = properties[key];
    }
    return { ...ordered, ...properties };
  }

  /** An explicit primitive annotation forbids calculation prose in numeric results; unknown types retain bounded JSON. */
  function resultValueSchema(): Record<string, unknown> {
    const primitive = inputValueSchema(context.returnTypeText);
    if (primitive.anyOf) return primitive;
    if (primitive.type) return { anyOf: [primitive, { type: "null" }] };
    return { anyOf: [{ type: "number" }, { type: "boolean" }, { type: "null" }, { type: "string", maxLength: 1200 },
      { type: "array", maxItems: 24, items: {} }, { type: "object", additionalProperties: true }] };
  }

  /** Empty partial/implicit routes cite the owned declaration without inventing an executable code step. */
  function sourceStepProperties(index: number) {
    const operations = context.sourceFlow!.paths[index].steps;
    const { code: _freeCode, ...properties } = step.properties;
    // llama.cpp rejects enum: [] before loading the model. Omitting code for
    // a step-less route also preserves the Host's
    // existing rejection of fabricated statements on that route.
    return operations.length ? { ...properties, code: { enum: operations.map(operation => operation.code) } } : properties;
  }

  /** Emit fixed entry choices before prose so generation anchors on the correct scenario. */
  function constrainedExample(index: number) {
    const constraints = getFunctionNarrativeExampleConstraints(context, index);
    return { ...example, properties: { ...example.properties,
      inputs: { type: "array", minItems: context.parameters!.length, maxItems: context.parameters!.length,
        // Decoding a JSON value directly prevents Python/Kotlin literals from
        // masquerading as JSON text. The adapter encodes it for portable inputs.
        items: context.parameters!.length ? context.parameters!.map((parameter) => ({ type: "object", additionalProperties: false, required: ["name", "value"], properties: {
          name: { const: parameter.name }, value: constraints.booleans.some((input) => input.name === parameter.name)
            ? { const: constraints.booleans.find((input) => input.name === parameter.name)!.json === "true" }
            : constraints.nullInputs.includes(parameter.name) ? { const: null }
              : inputValueSchema(parameter.type, constraints.nonNullInputs.includes(parameter.name))
        } })) : { type: "object" } }, ...(constraints.partial ? { result: { const: "null" } } : {}) } };
  }

  /** One primary request reads the first two operations in order, before its final result is written. */
  function prefixEvidence(index: number) {
    const targets = context.sourceFlow!.paths[index].steps.slice(0, 2);
    return { type: "array", minItems: targets.length, maxItems: targets.length, items: targets.map(target => ({ ...step, description: operationDescription(target),
      required: [...step.required, "code", ...(context.parameters ? ["values"] : [])],
      properties: orderedStepProperties({ ...step.properties, code: { const: target.code }, source: { const: target.source },
        ...(context.parameters ? { values: targetValues(target) } : {}), ...booleanReading(target, index), ...elvisWriteReading(target, index), ...literalReturnReading(target) }, target.kind)
    })) };
  }

  /** Name the exact write before its prose so a guard cannot masquerade as a later assignment. */
  function targetValues(target: FunctionNarrativeFlowStep) {
    const name = target.kind === "return" ? "result" : target.writeTargets?.length === 1 ? target.writeTargets[0] : undefined;
    if (!name || context.valueNames?.length && !context.valueNames.includes(name)) return values;
    const literal = target.kind === "mutation" && target.confidence === "exact" ? primitiveLiteral(target.code) : undefined;
    const after = target.kind === "return" ? resultValueSchema() : literal ? { const: literal.value }
      : numericWrite(name, target) ? { anyOf: [{ type: "number" }, { type: "null" }] } : values.items.properties.after;
    const declares = (code: string) => /^(?:val|var|let|const)\s+([\p{L}_$][\p{L}\p{N}_$]*)\b/u.exec(code)?.[1] === name;
    // Kotlin Elvis lowering separates the decision/declaration and selected
    // operand write while retaining the same owned statement source range.
    const declared = declares(target.code) || context.sourceFlow?.paths.some(path => path.steps.some(step => step.loweredPredicate
      && step.source.snippetId === target.source.snippetId && step.source.startLine === target.source.startLine
      && step.source.endLine === target.source.endLine && declares(step.code)));
    const first = { ...values.items, properties: { ...values.items.properties, name: { const: name },
      ...(target.kind === "return" ? { before: { const: language === "ko" ? "반환 전" : "not returned" } }
        : declared ? { before: { const: language === "ko" ? "선언 전" : "not declared" } } : {}), after } };
    // A return computes one result. Unchanged inputs in extra rows tempt small
    // models to copy an operand instead of calculating the return expression.
    // One exact write has one changed target. Extra unchanged input/condition
    // rows create unsupported state changes that can contaminate later nodes.
    return { ...values, maxItems: 1, items: [first] };
  }
  /** Type-only propagation over existing primitive IR facts; this neither computes values nor executes source. */
  function numericWrite(name: string, target: FunctionNarrativeFlowStep): boolean {
    const numeric = new Set((context.parameters ?? []).filter(parameter => {
      const schema = inputValueSchema(parameter.type);
      return schema.type === "number" || schema.type === "integer" || (schema.anyOf as Array<Record<string, unknown>> | undefined)?.some(type => type.type === "number" || type.type === "integer");
    }).map(parameter => parameter.name));
    const numberOperand = (operand: string) => {
      if (numeric.has(operand)) return true;
      try { const value = JSON.parse(operand); return typeof value === "number" && Number.isFinite(value); } catch { return false; }
    };
    for (const fact of context.valueFacts ?? []) {
      const operands = fact.operation === "conditional" ? fact.operands.slice(1) : fact.operands;
      if (operands.length && operands.every(numberOperand)) numeric.add(fact.target); else numeric.delete(fact.target);
    }
    // A lowered write may consist only of the selected primitive input/literal
    // (amount or 5), with no evaluator IR fact for its destination binding.
    return numeric.has(name) || numberOperand(target.code.trim());
  }
  function orderedStepProperties(properties: Record<string, unknown>, kind: FunctionNarrativeFlowStep["kind"]): Record<string, unknown> {
    const ordered: Record<string, unknown> = {};
    // Calculation prose precedes a return value so an input/local is not copied
    // before the model has applied the operators in the return expression.
    const keys = kind === "return" ? ["code", "syntax", "reason", "values", "text", "effect", "source"]
      : ["code", "values", "syntax", "text", "reason", "effect", "source"];
    for (const key of keys) if (Object.hasOwn(properties, key)) ordered[key] = properties[key];
    return { ...ordered, ...properties };
  }

  /** A parser-proven unchanged Boolean input owns its truth/transfer facts, like owned when/outcome metadata. */
  function booleanReading(target: FunctionNarrativeFlowStep, pathIndex: number): Record<string, unknown> {
    const nullable = context.language === "kotlin" && target.loweredPredicate?.match(/^([\p{L}_][\p{L}\p{N}_]*) != null$/u);
    if (nullable && target.kind === "condition" && target.code.includes("?:") && target.branch?.confidence === "exact") {
      const constraints = getFunctionNarrativeExampleConstraints(context, pathIndex);
      const nonNull = constraints.nonNullInputs.includes(nullable[1]), isNull = constraints.nullInputs.includes(nullable[1]);
      if (nonNull || isNull) {
        const ko = language === "ko", outcome = nonNull ? "true" : "false";
        // Kotlin's immutable direct input already constrains this example.
        // This lowered node chooses an operand; the following write stores it.
        return boundedReading({ syntax: { const: ko ? "Elvis 연산자는 왼쪽 값이 null인지 판단한 뒤 사용할 피연산자 하나를 선택합니다."
          : "Elvis tests whether the left value is null, then selects exactly one operand." },
          text: { const: ko ? `${nullable[1]}의 null 여부를 판단해 ${nonNull ? "왼쪽 입력값" : "오른쪽 기본값"}을 선택합니다.`
            : `Test ${nullable[1]} for null and select the ${nonNull ? "left input" : "right fallback"}.` },
          reason: { const: ko ? `이 예시의 ${nullable[1]} 값은 ${nonNull ? "null이 아니므로 왼쪽" : "null이므로 오른쪽"} 값을 사용합니다.`
            : `${nullable[1]} is ${nonNull ? "non-null, so use the left value" : "null, so use the right value"}.` },
          effect: { const: ko ? "피연산자 선택만 완료됐고 저장은 다음 대입 노드에서 처리합니다."
            : "Only operand selection is complete; the next write stores the value." },
          ...(!context.valueNames?.length || context.valueNames.includes("condition") ? {
            values: { const: [{ name: "condition", before: ko ? "미평가" : "not evaluated", after: outcome }] }
          } : {}) });
      }
    }
    const match = /^(.+) = (true|false)$/u.exec(target.branch?.inputCondition ?? "");
    if (!match || !context.parameters?.some(parameter => parameter.name === match[1])) return {};
    const code = target.code.replace(/\s/gu, ""), negated = code === "!" + match[1] || code === "not" + match[1];
    if (!negated && code !== match[1]) return {};
    const outcome = String(negated ? match[2] !== "true" : match[2] === "true");
    if (outcome !== target.branch?.outcome) return {};
    const path = context.sourceFlow?.paths[pathIndex];
    const position = path?.steps.findIndex(step => step.code === target.code && step.source.startLine === target.source.startLine
      && step.source.snippetId === target.source.snippetId && step.graphOccurrence === target.graphOccurrence) ?? -1;
    const next = position < 0 ? undefined : path?.steps[position + 1]?.code;
    const ko = language === "ko", truth = ko ? outcome === "true" ? "참" : "거짓" : outcome;
    const syntax = ko ? negated ? "Boolean 부정 연산자는 입력의 참과 거짓을 반전합니다." : "Boolean 입력 자체를 조건으로 읽습니다."
      : negated ? "Boolean negation reverses the input's truth value." : "The Boolean input itself supplies the predicate.";
    return boundedReading({ syntax: { const: syntax }, text: { const: ko ? `선택한 소스 경로에서 ${target.code}는 ${truth}입니다.` : `On this source route ${target.code} is ${truth}.` },
      reason: { const: ko ? `입력 ${match[1]} = ${match[2]}에서 ${target.code}는 ${truth}입니다.` : `With ${match[1]} = ${match[2]}, ${target.code} is ${truth}.` },
      effect: { const: next ? ko ? `다음 도달 구문은 ${next}입니다.` : `The next reached operation is ${next}.`
        : ko ? "선택한 소스 경로는 여기까지입니다." : "This selected source route ends here." },
      ...(!context.valueNames?.length || context.valueNames.includes("condition") ? { values: { const: [{ name: "condition", before: ko ? "미평가" : "not evaluated", after: outcome }] } } : {}) });
  }

  /** Long source identifiers keep their exact code/value anchors; prose that exceeds its own cap remains model-owned. */
  function boundedReading(reading: Record<string, { const: unknown }>): Record<string, unknown> {
    const caps: Record<string, number> = { syntax: 160, text: 120, reason: 180, effect: 160 };
    return Object.fromEntries(Object.entries(reading).filter(([key, field]) => !rich || typeof field.const !== "string" || field.const.length <= (caps[key] ?? Infinity)));
  }

  /** A lowered primitive Elvis write stores its already selected operand; no arithmetic or external result is inferred here. */
  function elvisWriteReading(target: FunctionNarrativeFlowStep, index: number): Record<string, unknown> {
    if (!rich || context.language !== "kotlin" || target.kind !== "mutation" || target.confidence !== "exact" || target.writeTargets?.length !== 1) return {};
    const guard = context.sourceFlow?.paths[index]?.steps.find(step => step.kind === "condition" && step.loweredPredicate && step.code.includes("?:")
      && step.branch?.confidence === "exact" && step.source.snippetId === target.source.snippetId
      && step.source.startLine === target.source.startLine && step.source.endLine === target.source.endLine);
    const input = guard?.loweredPredicate?.match(/^([\p{L}_][\p{L}\p{N}_]*) != null$/u)?.[1];
    if (!input || !context.parameters?.some(parameter => parameter.name === input)) return {};
    const constraints = getFunctionNarrativeExampleConstraints(context, index), literal = primitiveLiteral(target.code);
    const copy = constraints.nonNullInputs.includes(input) && target.code.trim() === input;
    const fallback = constraints.nullInputs.includes(input) && literal;
    if (!copy && !fallback) return {};
    const name = target.writeTargets[0], ko = language === "ko", operand = copy ? input : literal!.json;
    return boundedReading({ syntax: { const: ko ? "이 대입은 선택된 피연산자 값을 지역 변수에 저장합니다." : "This write stores the selected operand in a local variable." },
      text: { const: ko ? `선택된 ${operand} 값을 ${name}에 저장합니다.` : `Store the selected ${operand} value in ${name}.` },
      reason: { const: ko ? `${input} 값이 ${copy ? "null이 아니므로 원래 입력값" : "null이므로 오른쪽 기본값"}을 사용합니다.`
        : `${input} is ${copy ? "non-null, so use the original input" : "null, so use the right fallback"}.` },
      effect: { const: ko ? `${name}에 선택된 값이 저장됩니다.` : `${name} holds the selected value.` } });
  }

  /** An exact literal return owns its stated value, not the preceding guard's truth or an inferred calculation. */
  function literalReturnReading(target: FunctionNarrativeFlowStep): Record<string, unknown> {
    if (!rich || target.kind !== "return" || target.confidence !== "exact") return {};
    const match = /^return\b\s*(.*?)\s*;?$/u.exec(target.code);
    const parsed = match && primitiveLiteral(match[1]);
    if (!parsed) return {};
    const literal = parsed.json, ko = language === "ko";
    return { syntax: { const: ko ? `return은 리터럴 ${literal} 값을 반환하고 함수를 종료합니다.` : `return sends the literal ${literal} to the caller and ends the function.` },
      text: { const: ko ? `도달한 구문의 반환값은 ${literal}입니다.` : `This reached statement returns ${literal}.` },
      reason: { const: ko ? `선택한 소스 경로가 이 반환문에 도달했고 반환식은 리터럴 ${literal}입니다.` : `The selected source route reaches this return, whose expression is the literal ${literal}.` },
      effect: { const: ko ? `함수가 종료되고 호출자가 받는 값은 ${literal}입니다.` : `The function ends and passes ${literal} to the caller.` },
      ...(context.parameters && (!context.valueNames?.length || context.valueNames.includes("result")) ? {
        values: { const: [{ name: "result", before: ko ? "반환 전" : "not returned", after: literal }] }
      } : {}) };
  }

  /** Literal syntax is source data; expressions, accesses, strings and language-specific numeric suffixes stay model-owned. */
  function primitiveLiteral(code: string): { value: unknown; json: string } | undefined {
    if (!/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/u.test(code.trim())) return undefined;
    const value: unknown = JSON.parse(code);
    return typeof value === "number" && !Number.isFinite(value) ? undefined : { value, json: JSON.stringify(value) };
  }

  /** Only complete, exact primitive expressions without calls/accesses can rule out unknown external prerequisites. */
  function isClosedPrimitiveRoute(): boolean {
    if (context.limited || context.groundingLimited || context.snippets.some(snippet => snippet.truncated || snippet.role === "helper")) return false;
    const paths = context.sourceFlow?.paths;
    if (!paths?.length || !context.parameters || context.parameters.some(parameter => {
      const schema = inputValueSchema(parameter.type);
      const kinds = schema.anyOf as Array<Record<string, unknown>> | undefined;
      return !["integer", "number", "boolean"].includes(String(schema.type))
        && (!kinds || kinds.some(kind => !["integer", "number", "boolean", "null"].includes(String(kind.type))));
    })) return false;
    const names = new Set([...(context.valueNames ?? []), ...context.parameters.map(parameter => parameter.name),
      "return", "val", "var", "let", "const", "true", "false", "null", "not"]);
    return paths.every(path => path.status === "source-terminal" && path.confidence === "exact" && path.steps.length > 0
      && path.steps.every(target => target.confidence === "exact" && ["condition", "mutation", "return"].includes(target.kind)
        && !target.code.includes("=>")
        && !/[^\p{L}\p{N}_$\s+*/%<>=!?:;()\-]/u.test(target.code)
        && !/[\p{L}_$][\p{L}\p{N}_$]*\s*\(/u.test(target.code)
        && [...target.code.matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)].every(match => names.has(match[0]))));
  }

  /** Fixed identity is omitted from decoding, so each tuple slot still names the exact operation in its prompt schema. */
  function operationDescription(target: FunctionNarrativeFlowStep): string {
    const operation = JSON.stringify({ kind: target.kind, code: target.code, ...(target.branch ? { predicateResult: target.branch.outcome } : {}) });
    const timing = target.kind === "mutation"
      ? language === "ko" ? "현재 대입의 계산과 저장을 구체적 값으로 설명합니다. 앞 조건의 해설을 반복하지 않습니다."
        : "Explain this write's calculation and assignment with concrete values, rather than copying the earlier guard explanation."
      : target.kind === "condition"
        ? language === "ko" ? "현재 조건식의 판단만 설명합니다. 다음 대입이나 반환은 아직 일어나지 않았습니다."
          : "Explain this predicate decision only; the next assignment or return has not occurred yet."
        : target.kind === "return"
          ? language === "ko" ? "return 뒤의 식 전체에 최신 값을 대입해 계산합니다. reason에 계산식을 쓰고 values의 result.after에 그 계산 결과를 넣습니다. 조건식의 결과나 연산 전 입력값을 반환값으로 복사하지 마세요."
            : "Substitute the latest values into the ENTIRE return expression. Write its calculation in reason, then put that result in result.after. Never copy the guard result or an operand before applying the return operators."
          : language === "ko" ? "현재 구문이 앞 상태를 어떻게 사용하는지 설명합니다."
            : "Explain how this current operation uses the preceding state.";
    return (language === "ko" ? "이 steps 슬롯의 소스 데이터: " : "Source data for this steps slot: ") + operation + ". " + timing;
  }

  /** Only explicit primitive type spellings constrain values; aliases and compound types stay unknown. */
  function inputValueSchema(type: string | undefined, nonNull = false): Record<string, unknown> {
    const text = (type ?? "").replace(/\s/gu, "");
    const nullable = context.language === "kotlin" && text.endsWith("?");
    const primitive = nullable ? text.slice(0, -1) : text;
    let value: Record<string, unknown> = {};
    if (context.language === "kotlin") {
      if (/^(?:kotlin\.)?(?:Int|Long|Short|Byte)$/u.test(primitive)) value = { type: "integer" };
      else if (/^(?:kotlin\.)?(?:Double|Float)$/u.test(primitive)) value = { type: "number" };
      else if (/^(?:kotlin\.)?Boolean$/u.test(primitive)) value = { type: "boolean" };
      else if (/^(?:kotlin\.)?String$/u.test(primitive)) value = { type: "string", maxLength: 1200 };
    } else if (["typescript", "javascript"].includes(context.language)) {
      if (primitive === "number" || primitive === "boolean") value = { type: primitive };
      else if (primitive === "string") value = { type: "string", maxLength: 1200 };
    } else if (context.language === "python") {
      if (primitive === "int") value = { type: "integer" };
      else if (primitive === "float") value = { type: "number" };
      else if (primitive === "bool") value = { type: "boolean" };
      else if (primitive === "str") value = { type: "string", maxLength: 1200 };
    }
    if (nullable && value.type && !nonNull) return { anyOf: [value, { type: "null" }] };
    if (!value.type && nonNull) return { anyOf: [
      { type: "string", maxLength: 1200 }, { type: "number" }, { type: "boolean" },
      { type: "array", items: {} }, { type: "object", additionalProperties: true }
    ] };
    return value;
  }
}
