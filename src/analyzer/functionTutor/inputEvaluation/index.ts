/** Public bounded input checking API; expression mechanics stay inside this module. */
export { evaluateFunctionTutorInputs } from "./evaluate";
export { compileFunctionTutorInputDeclaration } from "./pureCalls";
export type { FunctionTutorInputProgramContext } from "./pureCalls";
export type { FunctionTutorDecisionObservation, FunctionTutorInputAssignment, FunctionTutorInputEvaluation } from "./types";
