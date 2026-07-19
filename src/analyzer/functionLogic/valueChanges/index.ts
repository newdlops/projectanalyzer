/** Public surface for language-specific Function Logic value-change evidence. */

export { collectJavaValueChanges } from "./javaValueChanges";
export { collectPythonValueChanges } from "./pythonValueChanges";
export {
  collectTypeScriptExpressionValueChanges,
  collectTypeScriptValueChanges
} from "./typescriptValueChanges";
export type {
  FunctionLogicValueChange,
  FunctionLogicValueChangeOperation,
  FunctionLogicValueTargetKind
} from "./types";
