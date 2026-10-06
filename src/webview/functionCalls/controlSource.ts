/** Embeds the shared route functions so Host grounding and browser choices cannot drift. */
import { traceFunctionCalls, exampleFunctionCallScenarios } from "../../shared/functionCalls";
export function getFunctionCallsControlSource(): string {
  return traceFunctionCalls.toString() + "\n" + exampleFunctionCallScenarios.toString();
}
