/**
 * Session contract for the dedicated Function Visualizer editor tab. The root
 * token lets browser history detect call cycles without receiving graph IDs.
 */

import type { SourceNodeToken } from "./sourceNavigation";

/** Browser-safe identity and label for one function in the navigation trail. */
export type FunctionVisualizerNavigationTarget = {
  sourceToken: SourceNodeToken;
  label: string;
};

/** Starts a new root visualization and invalidates the panel's old history. */
export type FunctionVisualizerSessionPayload = {
  graphVersion: string;
  root: FunctionVisualizerNavigationTarget;
};
