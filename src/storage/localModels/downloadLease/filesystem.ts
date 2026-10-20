/** Shared filesystem error and real PID-liveness checks for download-lease coordination. */
export function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}

/** Permission failures cannot prove that another process has exited. */
export function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return !hasCode(error, "ESRCH"); }
}
