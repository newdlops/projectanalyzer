/** Transient file verification for cached results; only immutable version records survive an action. */
import { createContentHash } from "../../shared/hash";
import { SourceCaptureError, requireSourceActive, type NarrativeSourceGraphValidation, type NarrativeSourceReader, type NarrativeSourceValidation } from "../../shared/narrativeSources";

/** Re-read one bounded file at a time and abort owned checks when the cache is evicted. */
export function createSourceValidation(input: { graph: NarrativeSourceGraphValidation; reader: NarrativeSourceReader;
  versions: ReadonlyArray<{ filePath: string; revision: string; sha256: string }>; maximumFileBytes: number }): NarrativeSourceValidation {
  const graph = input.graph, reader = input.reader, maximum = input.maximumFileBytes;
  const versions = input.versions.map(version => Object.freeze({ ...version })), checks = new Set<AbortController>();
  let disposed = false;
  const active = (signal: AbortSignal) => { if (disposed) throw new SourceCaptureError("disposed", "Cached source validation was disposed"); requireSourceActive(signal); };
  return {
    async assertCurrent(signal) {
      active(signal); const controller = new AbortController(), abort = () => controller.abort();
      checks.add(controller); signal.addEventListener("abort", abort, { once: true });
      try {
        active(controller.signal); graph.assertCurrent();
        for (const previous of versions) {
          const current = await reader.read(previous.filePath, maximum, controller.signal); active(controller.signal);
          if (!current || current.filePath !== previous.filePath || current.revision !== previous.revision || createContentHash(current.text) !== previous.sha256) throw new SourceCaptureError("source-changed", "Cached source file changed");
        }
        graph.assertCurrent(); active(controller.signal);
      } finally { checks.delete(controller); signal.removeEventListener("abort", abort); }
    },
    dispose() { if (!disposed) { disposed = true; for (const check of checks) check.abort(); checks.clear(); versions.length = 0; graph.dispose(); } }
  };
}
