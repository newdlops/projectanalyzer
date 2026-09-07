/**
 * Browser-only Scenario story occurrence boundary. It exposes evaluator visit
 * order without deriving a new path, edge, value, or loop iteration.
 */

/** Returns the internal occurrence reader used by Scenario playback projection. */
export function getFunctionLogicScenarioPlaybackFrameBrowserSource(): string {
  return /* js */ `
    /** Uses retained evaluator occurrences when available; legacy paths remain ordered by transitions. */
    function readFunctionLogicScenarioPlaybackOccurrences(path) {
      return Array.isArray(path?.occurrences) ? path.occurrences : [];
    }
  `;
}
