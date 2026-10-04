/** Public Summary source/style composition; uses Guide callbacks and shared Workspace data only. */
import { getFunctionBehaviorSummaryBrowserSource } from "./functionBehaviorSummaryBrowserSource";
import { getRepresentativeScenarioSummaryBrowserSource } from "./representativeScenarioSummaryBrowserSource";
export { getFunctionSummaryStyles } from "./functionSummaryStyles";
export function getFunctionTutorSummaryBrowserSource(): string {
  return getFunctionBehaviorSummaryBrowserSource() + getRepresentativeScenarioSummaryBrowserSource();
}
