/** OS memory adapter. macOS includes reclaimable memory through memory_pressure; other systems use Node's free-memory observation. */
import { execFile } from "node:child_process";
import { freemem, totalmem } from "node:os";
import { FunctionNarrativeError } from "../../../shared/functionNarratives";
import type { LocalNarrativeMemory } from "./types";

/** One bounded observation per admission, never background polling or application termination. */
export async function readLocalNarrativeMemory(signal: AbortSignal): Promise<LocalNarrativeMemory> {
  if (signal.aborted) throw new FunctionNarrativeError("cancelled");
  const totalBytes = totalmem();
  if (process.platform === "darwin") {
    const percent = await new Promise<number | undefined>(resolve => {
      execFile("/usr/bin/memory_pressure", ["-Q"], { shell: false, timeout: 2000, maxBuffer: 4096, signal }, (error, stdout) => {
        const match = /System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%/u.exec(stdout);
        resolve(!error && match ? Number(match[1]) : undefined);
      });
    });
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    if (percent !== undefined && percent >= 0 && percent <= 100) return { totalBytes, availableBytes: totalBytes * percent / 100 };
  }
  return { totalBytes, availableBytes: freemem() };
}
