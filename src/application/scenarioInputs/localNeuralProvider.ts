/** Application adapter for our own network. Static boundary witnesses accompany typed-data proposals. */
import { inferNeuralScenarios, type NeuralScenarioProblem } from "../../analyzer/neuralScenarios";
import { evaluateFunctionTutorInputs, type FunctionTutorDecisionObservation, type FunctionTutorStaticValue as Value } from "../../analyzer/functionTutor";
import type { FunctionTutorBuildModel } from "../codeFlow/functionTutor";
import { ScenarioInputError, type ScenarioInputProvider } from "./scenarioInputSuggestions";

/** Preserves actual call tuples and planner examples without reading files or contacting a service. */
export function createNeuralScenarioProblem(model: FunctionTutorBuildModel): NeuralScenarioProblem {
  return { declaration: model.declaration,
    examples: [...model.callsites.map((tuple) => tuple.arguments), ...model.seeds.map((seed) => seed.inputs)]
      .map((inputs) => inputs.map(({ parameterId, value, omitted }) => ({ parameterId, value, omitted }))),
    domains: [...model.candidatesByParameter].map(([parameterId, candidates]) => ({ parameterId, values: candidates.map((item) => item.value) })) };
}

/** Creation is inert. Only an explicit user request starts bounded CPU training. */
export function createLocalNeuralScenarioProvider(): ScenarioInputProvider {
  return { async suggest(model, language, signal) {
    if (signal.aborted) throw new ScenarioInputError("cancelled");
    let result;
    try { result = await inferNeuralScenarios(createNeuralScenarioProblem(model), { signal }); }
    catch (error) { if (signal.aborted) throw new ScenarioInputError("cancelled"); throw error; }
    if (!result) throw new ScenarioInputError("unavailable");
    const scenarios = result.boundaries.flatMap((boundary) => {
      const label = model.declaration.program.blocks.find((block) => block.blockId === boundary.blockId)?.label.slice(0, 180) ?? "";
      const difference = describeInputDifference(model, boundary.inputs, boundary.neighbor);
      const observations = [boundary.inputs, boundary.neighbor].map((inputs) => {
        let observation: FunctionTutorDecisionObservation | undefined;
        evaluateFunctionTutorInputs(model.declaration, inputs, { observeDecision(value) { if (value.blockId === boundary.blockId && !observation) observation = value; } });
        return observation;
      });
      const outcomes = observations.map((item) => item ? `${formatNumber(item.left)} / ${formatNumber(item.right)} (${language === "ko" ? item.outcome ? "참" : "거짓" : String(item.outcome)})` : "?");
      return [boundary.inputs, boundary.neighbor].map((tuple, index) => {
        const inputs = Object.create(null) as Record<string, unknown>;
        for (const parameter of model.declaration.parameters) {
          const value = tuple.find((input) => input.parameterId === parameter.id)!.value;
          // The codec emits only complete JSON values. This conversion is data serialization, never eval.
          inputs[parameter.name] = JSON.parse(JSON.stringify(value, (_key, item) => {
            if (!item || typeof item !== "object" || !item.kind) return item;
            if (["number", "string", "boolean"].includes(item.kind)) return item.value;
            if (item.kind === "null") return null;
            if (item.kind === "array") return item.items;
            if (item.kind === "object") return Object.fromEntries(item.entries.map((entry: { key: string; value: unknown }) => [entry.key, entry.value]));
            return item;
          }));
        }
        return { title: `${difference.name} = ${difference.values[index]}`.slice(0, 100), inputs,
          reason: language === "ko" ? `신경망이 추정한 경계를 정적으로 확인했습니다. ${difference.name}: ${difference.values.join(" → ")}. 조건 ${label}의 좌변 / 우변: ${outcomes.join(" → ")}.`
            : `A neural boundary confirmed by static checks. ${difference.name}: ${difference.values.join(" → ")}. Left / right operands of ${label}: ${outcomes.join(" → ")}.` };
      });
    });
    return { modelName: "Local MLP · v1", text: JSON.stringify({ scenarios }), boundaries: result.boundaries, training: result.report };
  } };
}

/** Names the single changed leaf so the pair explains an input-to-calculated-value transition. */
function describeInputDifference(model: FunctionTutorBuildModel, left: NeuralScenarioProblem["examples"][number], right: NeuralScenarioProblem["examples"][number]): { name: string; values: string[] } {
  const queue: Array<{ name: string; left: Value; right: Value }> = model.declaration.parameters.map((parameter) => ({ name: parameter.name,
    left: left.find((item) => item.parameterId === parameter.id)!.value, right: right.find((item) => item.parameterId === parameter.id)!.value }));
  const visited = new Set<Value>();
  for (let cursor = 0; cursor < queue.length && cursor < 512; cursor += 1) {
    const item = queue[cursor];
    if (visited.has(item.left)) continue; visited.add(item.left);
    if (JSON.stringify(item.left) === JSON.stringify(item.right)) continue;
    if (item.left.kind === "object" && item.right.kind === "object") {
      const rightValue = item.right;
      queue.push(...item.left.entries.map((entry) => ({ name: item.name + "." + entry.key, left: entry.value, right: rightValue.entries.find((other) => other.key === entry.key)!.value })));
    } else if (item.left.kind === "array" && item.right.kind === "array") {
      const rightValue = item.right;
      queue.push(...item.left.items.map((value, index) => ({ name: `${item.name}[${index}]`, left: value, right: rightValue.items[index] })));
    } else return { name: item.name.slice(0, 64), values: [item.left, item.right].map((value) => value.kind === "number" ? formatNumber(value.value) : JSON.stringify(value).slice(0, 64)) };
  }
  return { name: "input", values: ["1", "2"] };
}
/** Exact round-trippable digits prevent different equality outcomes appearing to have identical values. */
function formatNumber(value: number): string { return Object.is(value, -0) ? "-0" : String(value); }
