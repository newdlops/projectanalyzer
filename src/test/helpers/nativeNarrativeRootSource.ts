/** Explicit source/response fixtures for root construction. No subject program executes; mode/prose fixtures test protocol fidelity, not neural semantic correctness. */
import type { NativeRootSourceContext } from "../../llm/nativeNarrativeCodec";

/** Complete raw source, caller and helper bytes with source-owned occurrence records, syntax-only numeric IR and optional producer aliases. */
export function nativeRootSourceFixture(withLoop = false): NativeRootSourceContext {
  const text = "export function total(input: number): number {\r\n  // 원문 😀 is preserved verbatim.\r\n" + (withLoop ? "  while (input < 0) { input++; }\r\n" : "") + "  const total = input + 2;\r\n  return total;\r\n}\r\n";
  const steps: any[] = [
    { kind: "mutation", code: "const total = input + 2;", confidence: "exact", source: { snippetId: "parent", startLine: withLoop ? 13 : 12, endLine: withLoop ? 13 : 12 }, graphNodeId: "node-write", graphOccurrence: withLoop ? 1 : 0, writeTargets: ["total"] },
    { kind: "return", code: "return total;", confidence: "exact", source: { snippetId: "parent", startLine: withLoop ? 14 : 13, endLine: withLoop ? 14 : 13 }, graphNodeId: "node-return", graphOccurrence: withLoop ? 2 : 1 }
  ];
  if (withLoop) steps.unshift({ kind: "loop", code: "input < 0", confidence: "exact", source: { snippetId: "parent", startLine: 12, endLine: 12 }, graphNodeId: "node-loop", graphOccurrence: 0, branch: { outcome: "iterate", confidence: "exact" } });
  return { functionName: "total", language: "typescript", limited: false, detailLevel: "rich", parameters: [{ name: "input", type: "number" }], returnTypeText: "number", valueNames: ["input", "total", "condition", "result"], scenarioBatch: { offset: 0 },
    snippets: [{ id: "parent", role: "function", startLine: 10, endLine: withLoop ? 16 : 15, text, truncated: false }, { id: "helper", role: "helper", startLine: 1, endLine: 2, text: "function helper(value: number) {\rreturn value; }", truncated: false }, { id: "caller", role: "caller", startLine: 1, endLine: 1, text: "const answer = total(3);", truncated: false }],
    sourceFlow: { basis: "source-control-flow", limited: false, paths: [{ status: "source-terminal", confidence: "exact", steps, graph: { nodeIds: steps.map(step => step.graphNodeId), edgeIds: steps.slice(1).map((_, index) => "edge-" + index) } }] },
    valueFacts: [{ target: "total", operation: "add", operands: ["input", "2"], source: steps[withLoop ? 1 : 0].source }]
  };
}

/** A valid typed union changes from a Boolean literal to a number later. Future numeric IR must not constrain the earlier display field. */
export function nativeRootRetypedSourceFixture(): NativeRootSourceContext {
  const context = nativeRootSourceFixture();
  context.snippets[0].text = "export function total(input: number): number {\r\n  // The original union binding changes type in source order.\r\n  let total: boolean | number = false;\r\n  total = input + 2;\r\n  return total;\r\n}\r\n";
  context.snippets[0].endLine = 16;
  const steps: any[] = [
    { kind: "mutation", code: "let total: boolean | number = false;", confidence: "exact", source: { snippetId: "parent", startLine: 12, endLine: 12 }, graphNodeId: "node-first", graphOccurrence: 0, writeTargets: ["total"] },
    { kind: "mutation", code: "total = input + 2;", confidence: "exact", source: { snippetId: "parent", startLine: 13, endLine: 13 }, graphNodeId: "node-next", graphOccurrence: 1, writeTargets: ["total"] },
    { kind: "return", code: "return total;", confidence: "exact", source: { snippetId: "parent", startLine: 14, endLine: 14 }, graphNodeId: "node-return", graphOccurrence: 2 }
  ];
  context.sourceFlow.paths[0].steps = steps; context.sourceFlow.paths[0].graph = { nodeIds: steps.map(step => step.graphNodeId), edgeIds: ["edge-first", "edge-next"] };
  context.valueFacts = [{ target: "total", operation: "add", operands: ["input", "2"], source: steps[1].source }];
  return context;
}

/** All sentences and numerical examples are authored constants. This helper does not read/evaluate code to create an answer. */
export function nativeRootSourceReading(context: NativeRootSourceContext, locale: "ko" | "en" = "en"): any {
  const sentence = locale === "ko" ? "원래 소스 구문과 주어진 값의 관계를 완전한 문장으로 설명합니다." : "The supplied source operation retains its exact expression and original context.";
  return { summary: sentence, scenarios: [{ title: locale === "ko" ? "완전한 소스 경로입니다." : "Complete source route.", when: context.sourceFlow.paths[0].steps.some(step => step.kind === "loop") ? ["input < 0 => iterate"] : [],
    explanation: sentence, steps: context.sourceFlow.paths[0].steps.map(step => ({ code: step.code, source: step.source, text: sentence, syntax: sentence, reason: sentence, effect: sentence,
      values: step.kind === "loop" ? [{ name: "condition", before: locale === "ko" ? "미평가" : "not evaluated", after: "true" }]
        : [{ name: step.kind === "return" ? "result" : "total", before: step.kind === "return" ? locale === "ko" ? "반환 전" : "not returned" : locale === "ko" ? "선언 전" : "not declared", after: 5 }] })),
    outcome: "return total;", assumptions: [], analysis: { pathReason: sentence, stateChange: sentence, alternative: sentence }, exampleInputs: [{ name: "input", value: 3 }], exampleResult: 5 }], limitations: [] };
}

/** Explicit unavailable fixture conversion follows the provided schema's source markers, never guessed runtime values. */
export function nativeRootUnavailableReading(reading: any, schema: any, sentence: string): any {
  const result = JSON.parse(JSON.stringify(reading)), unavailable = () => ({ kind: "not-evaluated", reason: sentence });
  const properties = schema.properties.scenarios.items[0].properties, scenario = result.scenarios[0];
  for (const input of scenario.exampleInputs) input.value = unavailable(); scenario.exampleResult = unavailable();
  for (const [index, step] of scenario.steps.entries()) {
    const source = properties.steps.items[index].properties.values;
    for (const [valueIndex, value] of step.values.entries()) {
      const before = Object.hasOwn(source, "const") ? { const: source.const[valueIndex].before } : (Array.isArray(source.items) ? source.items[valueIndex] : source.items).properties.before;
      if (!Object.hasOwn(before, "const")) value.before = unavailable(); value.after = unavailable();
    }
  }
  return result;
}
