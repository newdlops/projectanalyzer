/** Public registration surface for editor-originated function visualization. */

export {
  VISUALIZE_CURRENT_FUNCTION_COMMAND,
  registerCurrentFunctionVisualizationCommand,
  visualizeCurrentFunction
} from "./currentFunctionVisualizationCommand";
export {
  resolveCurrentFunctionGraph,
  type CurrentFunctionGraphResolution
} from "./currentFunctionGraph";
