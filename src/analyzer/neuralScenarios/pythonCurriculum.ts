/** Bounded teacher-guided Python training corpus. Structural mutations expose later loop decisions without predicting their outcomes. */
import type { FunctionTutorInputAssignment, FunctionTutorInputEvaluation } from "../functionTutor";
import { createPythonRegexRuntime } from "../../shared/pythonScenario";
import type { NeuralScenarioProblem } from "./types";

/** Combines checked nonempty collections into duplicate and multi-line candidates before the train/validation split. */
export function preparePythonCurriculum(problem: NeuralScenarioProblem, check: (inputs: FunctionTutorInputAssignment[]) => FunctionTutorInputEvaluation): NeuralScenarioProblem {
  const program = problem.declaration.program.python;
  const parameter = problem.declaration.parameters[0];
  if (!program || problem.declaration.parameters.length !== 1 || parameter.typeKind !== "string") return problem;
  const accepted = new Map<string, string>();
  for (const candidate of program.stringCandidates.slice(0, 96)) {
    const result = check([{ parameterId: parameter.id, value: { kind: "string", value: candidate } }]);
    const value = result.terminal?.value;
    if (result.status === "verified" && value?.kind === "array" && value.items.length) {
      const key = JSON.stringify(value); if (!accepted.has(key)) accepted.set(key, candidate);
      if (accepted.size >= 4) break;
    }
  }
  const anchors = [...accepted.values()]; const candidates = anchors.slice();
  const regex = createPythonRegexRuntime();
  const labels = [...new Set(program.regexPatterns.flatMap((pattern) => regex.candidates(pattern)).filter((value) => value && !/[0-9]/u.test(value)))].slice(0, 2);
  for (let index = 0; index < anchors.length; index += 1) {
    const value = anchors[index]; const other = anchors[(index + 1) % anchors.length];
    candidates.push(value + "\n" + value, value + "\n" + other);
    for (const label of labels) candidates.push(label + ": " + value, value + "\n" + label + ": " + other,
      label + ": " + value + "\n" + other, value + "\n" + label + ": " + value);
  }
  return { ...problem, declaration: { ...problem.declaration, program: { ...problem.declaration.program, python: {
    ...program, stringCandidates: [...new Set([...candidates, ...program.stringCandidates])].filter((value) => value.length <= 512).slice(0, 320)
  } } } };
}
