/** Public object-field evidence helpers consumed by language adapters. */

export {
  appendObjectFieldLiteralTarget,
  appendObjectFieldTarget,
  isStableObjectFieldOwner,
  isStaticObjectFieldKeyLiteral
} from "./objectFieldTarget";
export { collectPythonDictionaryFieldChanges } from "./pythonDictionaryFieldChanges";
export {
  collectTypeScriptObjectAssignFieldChanges,
  collectTypeScriptObjectLiteralFieldChanges
} from "./typescriptObjectFieldChanges";
